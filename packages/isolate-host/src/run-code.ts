/**
 * `runCode` (ADR-0557): one disposable child process + one rifty isolate per
 * call. The consumer process never loads isolated-vm and needs no flag.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  type ChildFrame,
  FRAME_CHANNEL_FD,
  FrameReader,
  KIND,
  MAX_ERROR_TEXT,
  type RunRequest,
} from './protocol.ts';

/** Limits for one `runCode` call; omitted fields take the documented defaults. */
export interface RunCodeOptions {
  /** Wall-clock deadline from the call, ms. Default 30 000. */
  readonly timeoutMs?: number;
  /** isolated-vm heap limit, MiB (min 8). Default 256. The child RSS ceiling is 256 + 3 × this. */
  readonly memoryLimitMb?: number;
  /** stdout + stderr bytes kept; the rest is discarded. Default 1 MiB. */
  readonly maxOutputBytes?: number;
}

/** Why a run was killed. */
export type RunCodeTermination = 'timeout' | 'memory';

export interface RunCodeResult {
  readonly stdout: string;
  readonly stderr: string;
  /** Node's status; `null` when the run was killed (`termination` says why). */
  readonly exitCode: number | null;
  readonly termination?: RunCodeTermination;
  /** Output passed `maxOutputBytes`; the excess was discarded. */
  readonly truncated?: true;
}

// `src/` in the workspace and `dist/` when packed are both one level under the package root.
const CHILD_ENTRY = fileURLToPath(new URL('../dist/child.js', import.meta.url));
const STDERR_TAIL_BYTES = 4096;

const MAX_TIMER_MS = 2 ** 31 - 1;

function limit(
  name: string,
  value: number | undefined,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw Object.assign(
      new RangeError(
        `The "options.${name}" must be a finite number in ${min}..${max}. Received ${String(value)}`,
      ),
      { code: 'ERR_OUT_OF_RANGE' },
    );
  }
  return value;
}

/** Accepted output, copied into one growable buffer: never a view into a received chunk. */
class FdBytes {
  #buf = new Uint8Array(0);
  #len = 0;
  append(bytes: Uint8Array): void {
    if (this.#len + bytes.byteLength > this.#buf.byteLength) {
      const grown = new Uint8Array(
        Math.max(this.#len + bytes.byteLength, this.#buf.byteLength * 2, 4096),
      );
      grown.set(this.#buf.subarray(0, this.#len));
      this.#buf = grown;
    }
    this.#buf.set(bytes, this.#len);
    this.#len += bytes.byteLength;
  }
  text(): string {
    return Buffer.from(this.#buf.buffer, 0, this.#len).toString('utf8');
  }
}

/** What the consumer has accepted so far: the state each frame is judged against. */
interface ProtocolState {
  kept: number;
  truncated: boolean;
}

/** Largest payload a frame of `kind` may carry now; -1 for an unknown kind. */
function maxPayload(kind: number, cap: number, state: ProtocolState): number {
  switch (kind) {
    case KIND.output:
      return 2 + (cap - state.kept);
    case KIND.exit:
      return 2;
    case KIND.memory:
      return 1;
    case KIND.error:
      return MAX_ERROR_TEXT;
    default:
      return -1;
  }
}

/**
 * One raw frame from a possibly escaped child, judged against the protocol
 * state: output only with new non-empty bytes or the one truncation flip, total
 * ≤ cap; exact payload sizes for exit/memory. A string is the violation.
 */
function decode(
  kind: number,
  p: Uint8Array,
  cap: number,
  state: ProtocolState,
): ChildFrame | string {
  const flag = (v: number | undefined): boolean | null => (v === 0 ? false : v === 1 ? true : null);
  switch (kind) {
    case KIND.output: {
      const fd = p[0];
      const truncated = flag(p[1]);
      if (p.byteLength < 2 || (fd !== 1 && fd !== 2) || truncated === null) return 'output header';
      const bytes = p.subarray(2);
      if (state.kept + bytes.byteLength > cap) return 'output past the cap';
      if (state.truncated && !truncated) return 'output truncation reverted';
      if (bytes.byteLength === 0 && !(truncated && !state.truncated))
        return 'output without new bytes';
      return { kind: 'output', fd, truncated, bytes };
    }
    case KIND.exit: {
      const truncated = flag(p[1]);
      if (p.byteLength !== 2 || truncated === null) return 'exit payload';
      return { kind: 'exit', exitCode: p[0] as number, truncated };
    }
    case KIND.memory: {
      const truncated = flag(p[0]);
      if (p.byteLength !== 1 || truncated === null) return 'memory payload';
      return { kind: 'memory', truncated };
    }
    case KIND.error:
      return { kind: 'error', message: new TextDecoder().decode(p) };
    default:
      return `frame kind ${kind}`;
  }
}

export function runCode(code: string, options: RunCodeOptions = {}): Promise<RunCodeResult> {
  if (typeof code !== 'string') {
    return Promise.reject(
      Object.assign(new TypeError('The "code" argument must be of type string'), {
        code: 'ERR_INVALID_ARG_TYPE',
      }),
    );
  }
  let timeoutMs: number;
  let request: RunRequest;
  try {
    timeoutMs = limit('timeoutMs', options.timeoutMs, 30_000, 1, MAX_TIMER_MS);
    const memoryLimitMb = limit('memoryLimitMb', options.memoryLimitMb, 256, 8);
    request = {
      code,
      memoryLimitMb,
      maxRssBytes: (256 + 3 * memoryLimitMb) * 1024 * 1024,
      maxOutputBytes: Math.floor(limit('maxOutputBytes', options.maxOutputBytes, 1 << 20, 0)),
    };
  } catch (error) {
    return Promise.reject(error);
  }
  return new Promise<RunCodeResult>((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-node-snapshot', CHILD_ENTRY], {
      env: {},
      stdio: ['pipe', 'ignore', 'pipe', 'pipe'],
    });
    const out = new FdBytes();
    const err = new FdBytes();
    const cap = request.maxOutputBytes;
    const state: ProtocolState = { kept: 0, truncated: false };
    let stderrTail = Buffer.alloc(0);
    child.stderr?.on('data', (data: Buffer) => {
      // Last STDERR_TAIL_BYTES bytes, decoded once at the end (no per-chunk split code points).
      stderrTail = Buffer.concat([stderrTail, data]).subarray(-STDERR_TAIL_BYTES);
    });
    let outcome: { readonly result: RunCodeResult } | { readonly error: Error } | undefined;
    const result = (exitCode: number | null, termination?: RunCodeTermination): RunCodeResult => ({
      stdout: out.text(),
      stderr: err.text(),
      exitCode,
      ...(termination === undefined ? {} : { termination }),
      ...(state.truncated ? { truncated: true as const } : {}),
    });
    const end = (next: typeof outcome): void => {
      if (outcome !== undefined) return;
      outcome = next;
      clearTimeout(deadline);
      child.kill('SIGKILL');
    };
    const deadline = setTimeout(() => end({ result: result(null, 'timeout') }), timeoutMs);
    const violated = (what: string): void =>
      end({ error: new Error(`isolate-host child protocol violation: ${what}`) });
    // A child that died meanwhile surfaces through 'exit' (code/signal), not an EPIPE.
    child.stdin?.on('error', () => {});
    // stdin stays open: its end tells the child its consumer is gone.
    child.stdin?.write(`${JSON.stringify(request)}\n`);
    // The child may be compromised (isolate escape): the consumer parses its frames
    // itself — bounded, never a throw in this listener — and judges each one.
    const reader = new FrameReader((kind) => maxPayload(kind, cap, state));
    const frames = child.stdio[FRAME_CHANNEL_FD] as NodeJS.ReadableStream | null;
    frames?.on('error', () => {});
    frames?.on('data', (chunk: Buffer) => {
      if (outcome !== undefined) return;
      const parsed = reader.push(chunk);
      if ('violation' in parsed) return violated(parsed.violation);
      for (const raw of parsed.frames) {
        if (outcome !== undefined) return;
        const f = decode(raw.kind, raw.payload, cap, state);
        if (typeof f === 'string') return violated(f);
        switch (f.kind) {
          case 'output':
            state.truncated ||= f.truncated;
            state.kept += f.bytes.byteLength;
            (f.fd === 2 ? err : out).append(f.bytes);
            break;
          case 'exit':
            state.truncated ||= f.truncated;
            end({ result: result(f.exitCode) });
            break;
          case 'memory':
            state.truncated ||= f.truncated;
            end({ result: result(null, 'memory') });
            break;
          case 'error':
            end({ error: new Error(`isolate-host child failed: ${f.message}`) });
            break;
        }
      }
    });
    // Only a failed spawn ends here; a live child's failure arrives as 'exit'.
    child.on('error', (error) => {
      if (child.pid === undefined) {
        end({ error });
        reject(error);
      }
    });
    child.on('exit', (exitCode, signal) => {
      end({
        error: new Error(
          `isolate-host child exited unexpectedly (code ${String(exitCode)}, signal ${String(signal)})${
            stderrTail.byteLength > 0 ? `: ${stderrTail.toString('utf8')}` : ''
          }`,
        ),
      });
      // Settle only once the child is gone: no child outlives its result.
      if (outcome !== undefined && 'result' in outcome) resolve(outcome.result);
      else reject((outcome as { error: Error }).error);
    });
  });
}
