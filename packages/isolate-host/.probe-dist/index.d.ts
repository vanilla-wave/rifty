/** Limits for one `runCode` call; omitted fields take the documented defaults. */
interface RunCodeOptions {
    /** Wall-clock deadline from the call, ms. Default 30 000. */
    readonly timeoutMs?: number;
    /** isolated-vm heap limit, MiB (min 8). Default 256. Adds 3 × this to its worker's RSS ceiling. */
    readonly memoryLimitMb?: number;
    /** stdout + stderr bytes kept; the rest is discarded. Default 1 MiB. */
    readonly maxOutputBytes?: number;
}
/** Why a run was killed. */
type RunCodeTermination = 'timeout' | 'memory';
interface RunCodeResult {
    readonly stdout: string;
    readonly stderr: string;
    /** Node's status; `null` when the run was killed (`termination` says why). */
    readonly exitCode: number | null;
    readonly termination?: RunCodeTermination;
    /** Output passed `maxOutputBytes`; the excess was discarded. */
    readonly truncated?: true;
}
declare function runCode(code: string, options?: RunCodeOptions): Promise<RunCodeResult>;

export { type RunCodeOptions, type RunCodeResult, type RunCodeTermination, runCode };
