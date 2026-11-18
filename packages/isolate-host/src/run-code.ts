/** Limits for one `runCode` call; omitted fields take the documented defaults. */
export interface RunCodeOptions {
  /** Wall-clock deadline from the call, ms. Default 30 000. */
  readonly timeoutMs?: number;
  /** isolated-vm heap limit, MiB. Default 256. */
  readonly memoryLimitMb?: number;
  /** Child process RSS ceiling, MiB. Default 1024. */
  readonly maxRssMb?: number;
  /** stdout + stderr bytes kept; the rest is discarded. Default 1 MiB. */
  readonly maxOutputBytes?: number;
}

/** Why a run was killed. */
export type RunCodeTermination = 'timeout' | 'memory' | 'catastrophic-oom' | 'rss';

export interface RunCodeResult {
  readonly stdout: string;
  readonly stderr: string;
  /** Node's status; `null` when the run was killed (`termination` says why). */
  readonly exitCode: number | null;
  readonly termination?: RunCodeTermination;
  /** Output passed `maxOutputBytes`; the excess was discarded. */
  readonly truncated?: true;
}

export async function runCode(
  _code: string,
  _options: RunCodeOptions = {},
): Promise<RunCodeResult> {
  throw new Error('isolate-host: runCode is not implemented yet');
}
