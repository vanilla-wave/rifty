/**
 * Recursive Worker runner for the runtime-js `'execSync'` sync RPC handler
 * (ADR-0011 phase 3, ADR-0039).
 *
 * Runs in the parent realm: spawns a fresh `Worker` for the child script,
 * buffers its stdout, and resolves on exit — without blocking the parent
 * (the calling Worker is blocked via `Atomics.wait`, but the parent must
 * keep pumping the dispatcher).
 *
 * Lives in `@riftydev/runtime-js` (post-ADR-0039) so the kernel stays free
 * of Node-API knowledge. Imports flow top-down (`runtime-js` →
 * `@riftydev/kernel`), so the runner statically imports `spawnKernelWorker`
 * — no late-binding handshake needed.
 */

import { type WorkerEntryDescriptor, spawnKernelWorker } from '@riftydev/kernel';

/**
 * Subset of `@riftydev/kernel`'s `SpawnWorkerSpec` the recursive runner
 * emits. Declared locally to document the handler/runner contract without
 * re-exporting kernel types.
 */
export interface RecursiveSpawnSpec {
  readonly entry: WorkerEntryDescriptor;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

/** Captured stdout bytes and child exit code the runner resolves with. */
export interface RecursiveRunResult {
  readonly stdout: Uint8Array;
  readonly exitCode: number;
}

/**
 * Spawns a fresh kernel Worker, captures its stdout, and resolves with the
 * captured bytes once it exits.
 *
 * PIDs start at `0xC0000000`, a dedicated counter that avoids colliding
 * with the main `ProcessManager`'s PID space — recursive children are an
 * internal `execSync`-blocking detail, not tracked in the public process
 * table.
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
    // Don't drain stderr into the reply — Node's `execSync` defaults
    // `stdio[2]` to `'pipe'` and surfaces stderr only on failure via the
    // error object. Closing-side semantics covered when the runtime-js
    // execSync layer extends the request schema.
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
