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

function limit(name: string, value: number | undefined, fallback: number, min: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw Object.assign(
      new RangeError(
        `The "options.${name}" must be a finite number >= ${min}. Received ${String(value)}`,
      ),
      { code: 'ERR_OUT_OF_RANGE' },
    );
  }
  return value;
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
    timeoutMs = limit('timeoutMs', options.timeoutMs, 30_000, 1);
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
    const out: Uint8Array[] = [];
    const err: Uint8Array[] = [];
    let stderrTail = '';
    child.stderr?.on('data', (data: Buffer) => {
      stderrTail = (stderrTail + data.toString('utf8')).slice(-STDERR_TAIL_BYTES);
    });
    let outcome: { readonly result: RunCodeResult } | { readonly error: Error } | undefined;
    const text = (chunks: Uint8Array[]): string => Buffer.concat(chunks).toString('utf8');
    const end = (next: typeof outcome): void => {
      if (outcome !== undefined) return;
      outcome = next;
      clearTimeout(deadline);
      child.kill('SIGKILL');
    };
    const killed = (termination: RunCodeTermination, truncated: boolean): RunCodeResult => ({
      stdout: text(out),
      stderr: text(err),
      exitCode: null,
      termination,
      ...(truncated ? { truncated: true as const } : {}),
    });
    let truncatedSoFar = false;
    const deadline = setTimeout(
      () => end({ result: killed('timeout', truncatedSoFar) }),
      timeoutMs,
    );
    child.on('message', (message: ChildMessage) => {
      switch (message.type) {
        case 'ready':
          child.send(request);
          return;
        case 'output':
          for (const [fd, bytes] of message.chunks) (fd === 2 ? err : out).push(bytes);
          return;
        case 'exit':
          end({
            result: {
              stdout: text(out),
              stderr: text(err),
              exitCode: message.exitCode,
              ...(message.truncated ? { truncated: true as const } : {}),
            },
          });
          return;
        case 'memory':
          truncatedSoFar ||= message.truncated;
          end({ result: killed('memory', truncatedSoFar) });
          return;
        case 'error':
          end({ error: new Error(`isolate-host child failed: ${message.message}`) });
          return;
      }
    });
    child.on('error', (error) => end({ error }));
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
