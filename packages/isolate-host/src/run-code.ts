/**
 * `runCode` (ADR-0557): one disposable child process + one rifty isolate per
 * call. The consumer process never loads isolated-vm and needs no flag.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ChildMessage, RunRequest } from './protocol.ts';

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

const MAX_ERROR_MESSAGE = 4096;

const MESSAGE_KEYS: Readonly<Record<string, readonly string[]>> = {
  ready: ['type'],
  output: ['type', 'chunks', 'truncated'],
  exit: ['type', 'exitCode', 'truncated'],
  memory: ['type', 'truncated'],
  error: ['type', 'message'],
};

/** Accepted output, copied into one growable buffer: never a view into an IPC message. */
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

/** What the consumer has accepted so far: the protocol state a message is judged against. */
interface ProtocolState {
  ready: boolean;
  kept: number;
  truncated: boolean;
}

/**
 * A child message the consumer accepts; anything else is a protocol violation.
 * Every accepted message advances the state (one `ready`; output carries new
 * bytes or the one truncation flip), so a child can make the consumer hold at
 * most `cap` bytes in at most `cap + 2` messages.
 */
function violation(message: unknown, cap: number, state: ProtocolState): string | null {
  if (typeof message !== 'object' || message === null) return 'non-object message';
  const m = message as Record<string, unknown>;
  // Exact keys: an extra key is unvalidated padding riding on an accepted message.
  const keys =
    typeof m.type === 'string' && Object.hasOwn(MESSAGE_KEYS, m.type)
      ? MESSAGE_KEYS[m.type]
      : undefined;
  if (keys === undefined) return 'message type';
  if (Object.keys(m).length !== keys.length || !keys.every((k) => Object.hasOwn(m, k)))
    return `${String(m.type)} message keys`;
  if (m.type !== 'ready' && !state.ready) return 'message before ready';
  switch (m.type) {
    case 'ready':
      return state.ready ? 'repeated ready' : null;
    case 'output': {
      if (!Array.isArray(m.chunks) || m.chunks.length > 2) return 'output chunks';
      // Exact shape below the top level too: no named property rides on an array.
      if (Object.keys(m.chunks).length !== m.chunks.length) return 'output chunks keys';
      if (typeof m.truncated !== 'boolean') return 'output truncated flag';
      let bytes = 0;
      for (const chunk of m.chunks as unknown[]) {
        if (!Array.isArray(chunk) || chunk.length !== 2 || Object.keys(chunk).length !== 2)
          return 'output chunk shape';
        if (chunk[0] !== 1 && chunk[0] !== 2) return 'output fd';
        if (!(chunk[1] instanceof Uint8Array)) return 'output bytes';
        if (chunk[1].byteLength === 0) return 'empty output chunk';
        bytes += chunk[1].byteLength;
      }
      if (state.kept + bytes > cap) return 'output past the cap';
      if (bytes === 0 && !(m.truncated && !state.truncated)) return 'output without new bytes';
      if (state.truncated && !m.truncated) return 'output truncation reverted';
      return null;
    }
    case 'exit': {
      const code = m.exitCode;
      if (typeof code !== 'number' || !Number.isInteger(code) || code < 0 || code > 255)
        return 'exit code';
      return typeof m.truncated === 'boolean' ? null : 'exit truncated flag';
    }
    case 'memory':
      return typeof m.truncated === 'boolean' ? null : 'memory truncated flag';
    case 'error':
      // Bounded before acceptance: a kept slice of a huge string would pin all of it.
      return typeof m.message === 'string' && m.message.length <= MAX_ERROR_MESSAGE
        ? null
        : 'error message';
    default:
      return 'message type';
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
      type: 'run',
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
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced',
    });
    const out = new FdBytes();
    const err = new FdBytes();
    const state: ProtocolState = { ready: false, kept: 0, truncated: false };
    let stderrTail = '';
    child.stderr?.on('data', (data: Buffer) => {
      stderrTail = (stderrTail + data.toString('utf8')).slice(-STDERR_TAIL_BYTES);
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
    // The child may be compromised (isolate escape): validate every message; a bad one
    // kills it with a distinct rejection, never a throw inside this listener.
    child.on('message', (message: unknown) => {
      if (outcome !== undefined) return;
      const bad = violation(message, request.maxOutputBytes, state);
      if (bad !== null) {
        end({ error: new Error(`isolate-host child protocol violation: ${bad}`) });
        return;
      }
      const m = message as ChildMessage;
      switch (m.type) {
        case 'ready':
          state.ready = true;
          // A child that died meanwhile surfaces through 'exit' (code/signal), not an EPIPE.
          child.send(request, () => {});
          return;
        case 'output':
          state.truncated ||= m.truncated;
          for (const [fd, bytes] of m.chunks) {
            state.kept += bytes.byteLength;
            (fd === 2 ? err : out).append(bytes);
          }
          return;
        case 'exit':
          state.truncated ||= m.truncated;
          end({ result: result(m.exitCode) });
          return;
        case 'memory':
          state.truncated ||= m.truncated;
          end({ result: result(null, 'memory') });
          return;
        case 'error':
          end({ error: new Error(`isolate-host child failed: ${m.message}`) });
          return;
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
            stderrTail ? `: ${stderrTail}` : ''
          }`,
        ),
      });
      // Settle only once the child is gone: no child outlives its result.
      if (outcome !== undefined && 'result' in outcome) resolve(outcome.result);
      else reject((outcome as { error: Error }).error);
    });
  });
}
