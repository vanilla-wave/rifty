/**
 * Recursive Worker runner used by the runtime-js `'execSync'` sync RPC
 * handler (ADR-0011 phase 3, ADR-0039).
 *
 * The handler runs in the parent realm. When it fires it needs to spawn a
 * fresh `Worker` for the child script, capture the child's stdout into a
 * buffer, and resolve once the child exits — all without blocking the
 * parent realm (the calling Worker is blocked via `Atomics.wait`, but the
 * parent must keep pumping the dispatcher).
 *
 * Lives in `@riftydev/runtime-js` (post-ADR-0039) so the kernel no longer
 * carries Node-API knowledge. The import flows top-down (`runtime-js` →
 * `@riftydev/kernel`), so no late-binding handshake is needed: the runner
 * statically imports `spawnKernelWorker`.
 */

import { type WorkerEntryDescriptor, spawnKernelWorker } from '@riftydev/kernel';

/**
 * Subset of `SpawnWorkerSpec` the recursive runner emits. The shape
 * matches `@riftydev/kernel`'s `SpawnWorkerSpec` exactly — declared locally
 * so the handler/runner contract is documented without re-exporting
 * kernel types we don't need to re-export.
 */
export interface RecursiveSpawnSpec {
  readonly entry: WorkerEntryDescriptor;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

/**
 * Result a recursive runner resolves with: captured stdout bytes and the
 * child's exit code. Matches the `RecursiveWorkerRunner` shape that the
 * runtime-js execSync handler consumes.
 */
export interface RecursiveRunResult {
  readonly stdout: Uint8Array;
  readonly exitCode: number;
}

/**
 * Recursive Worker runner: spawns a fresh kernel Worker, captures its
 * stdout, and resolves with the captured bytes once it exits.
 *
 * PIDs of recursive workers are allocated from a dedicated counter
 * starting at `0xC0000000` to avoid colliding with the main
 * `ProcessManager`'s PID space — recursive children are an internal
 * implementation detail of `execSync` blocking and aren't tracked in the
 * public process table.
 */
export function makeRecursiveRunner(): (spec: RecursiveSpawnSpec) => Promise<RecursiveRunResult> {
  let nextNestedPid = 0xc0000000;
  return (spec) => {
    const nestedPid = nextNestedPid++;
    const nested = spawnKernelWorker(spec, { pid: nestedPid, ppid: 1 });
    const chunks: Uint8Array[] = [];
    nested.ports.stdout.onmessage = (ev) => {
      const data = ev.data;
      if (data instanceof Uint8Array) chunks.push(data);
    };
    nested.ports.stdout.start();
    // Don't drain stderr into the parent reply — match Node's `execSync`
    // which defaults `stdio[2]` to `'pipe'` and surfaces stderr only on
    // failure via the error object. Closing-side semantics covered when
    // the runtime-js execSync layer extends the request schema.
    return new Promise((resolve) => {
      nested.onExit((code) => {
        let total = 0;
        for (const c of chunks) total += c.byteLength;
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          out.set(c, off);
          off += c.byteLength;
        }
        resolve({ stdout: out, exitCode: code });
      });
    });
  };
}
