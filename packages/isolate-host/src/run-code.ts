/**
 * `runCode` (ADR-0557 §1, pool ADR): a fresh rifty isolate per call inside a
 * shared long-lived worker process of a lazy pool. The consumer process never
 * loads isolated-vm and needs no flag.
 */
import { Pool } from './pool.ts';

/** Options for one `runCode` call; omitted fields take the documented defaults. */
export interface RunCodeOptions {
  /** Whether this guest may obtain shared buffers. Default true. */
  readonly allowSharedArrayBuffer?: boolean;
  /** Wall-clock deadline from the call, ms. Default 30 000. */
  readonly timeoutMs?: number;
  /** isolated-vm heap limit, MiB (min 8). Default 256. Adds 3 × this to its worker's RSS ceiling. */
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

/** One pool per consumer process, created by the first call. */
let pool: Pool | undefined;

export function runCode(code: string, options: RunCodeOptions = {}): Promise<RunCodeResult> {
  if (typeof code !== 'string') {
    return Promise.reject(
      Object.assign(new TypeError('The "code" argument must be of type string'), {
        code: 'ERR_INVALID_ARG_TYPE',
      }),
    );
  }
  try {
    const { allowSharedArrayBuffer = true } = options;
    if (typeof allowSharedArrayBuffer !== 'boolean') {
      throw Object.assign(new TypeError('options.allowSharedArrayBuffer must be a boolean'), {
        code: 'ERR_INVALID_ARG_TYPE',
      });
    }
    const spec = {
      allowSharedArrayBuffer,
      code,
      timeoutMs: limit('timeoutMs', options.timeoutMs, 30_000, 1, MAX_TIMER_MS),
      memoryLimitMb: limit('memoryLimitMb', options.memoryLimitMb, 256, 8),
      maxOutputBytes: Math.floor(limit('maxOutputBytes', options.maxOutputBytes, 1 << 20, 0)),
    };
    pool ??= new Pool();
    return pool.run(spec);
  } catch (error) {
    return Promise.reject(error);
  }
}
