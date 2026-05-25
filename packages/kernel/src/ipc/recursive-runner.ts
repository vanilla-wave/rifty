/**
 * Recursive Worker runner used by the default `execSync` sync RPC handler
 * (ADR-0011 phase 3).
 *
 * The kernel's `execSync` handler runs in the parent realm. When it fires
 * it needs to spawn a fresh `Worker` for the child script, capture the
 * child's stdout into a buffer, and resolve once the child exits — all
 * without blocking the parent realm (the calling Worker is blocked via
 * `Atomics.wait`, but the parent must keep pumping the dispatcher).
 *
 * Lives in its own module so the resulting cycle stays at the protocol
 * boundary (`ipc/*` → `spawn-worker.ts` → `ipc/*` would loop), and so
 * `spawn-worker.ts` can stay under the 300-line file budget.
 */

import type { RecursiveWorkerRunner } from './default-handlers.ts';

/**
 * The recursive runner needs the spawn primitive but cannot statically
 * import it (that would create the same cycle the default-handlers split
 * already broke). The caller hands in `spawnFn` instead — `spawnWorker.ts`
 * passes its own `spawnKernelWorker` reference.
 *
 * `spawnFn` is typed structurally — we only need the bits the runner
 * actually touches (the parent-side stdout port + an `onExit` subscriber).
 */
export type RecursiveSpawnFn = (
  spec: Parameters<RecursiveWorkerRunner>[0] & {
    readonly stdio?: unknown;
    readonly syncRing?: unknown;
  },
  identity: { pid: number; ppid: number },
) => {
  readonly ports: { readonly stdout: MessagePort };
  onExit(cb: (code: number) => void): () => void;
};

/**
 * Build a {@link RecursiveWorkerRunner} that spawns a fresh kernel Worker
 * via `spawnFn`, captures its stdout, and resolves with the captured
 * bytes once it exits. PIDs of recursive workers are allocated from a
 * dedicated counter starting at 0xC0000000 to avoid colliding with the
 * main `ProcessManager`'s PID space — recursive children are an internal
 * implementation detail of `execSync` blocking and aren't tracked in the
 * public process table.
 */
export function makeRecursiveRunner(spawnFn: RecursiveSpawnFn): RecursiveWorkerRunner {
  let nextNestedPid = 0xc0000000;
  return (spec) => {
    const nestedPid = nextNestedPid++;
    const nested = spawnFn(spec, { pid: nestedPid, ppid: 1 });
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
