/**
 * Module-level singleton {@link SyncRpcDispatcher} that backs every
 * kernel-spawned Worker.
 *
 * Review fix for ADR-0011 phase 3: the previous implementation
 * constructed a fresh dispatcher per child, which meant N busy-poll
 * `setInterval(1ms)` timers for N children on the main realm. The
 * dispatcher's docstring promised "the same instance can serve many
 * rings" — this module makes that contract real.
 *
 * Lives in its own file (rather than inside `spawn-worker.ts`) so the
 * kernel's spawn module stays under the ADR-0024 file-size budget and
 * so tests can `clearKernelDispatcher()` without reaching deep into
 * spawn-worker internals.
 */

import { type ScriptResolver, registerDefaultHandlers } from './default-handlers.ts';
import { type RecursiveSpawnFn, makeRecursiveRunner } from './recursive-runner.ts';
import { getExecSyncScriptResolver } from './script-resolver.ts';
import { SyncRpcDispatcher } from './sync-dispatch.ts';

let kernelDispatcher: SyncRpcDispatcher | null = null;
let recursiveSpawn: RecursiveSpawnFn | null = null;

/**
 * One-time wiring: `spawn-worker.ts` calls this with its own
 * `spawnKernelWorker` so the singleton can construct a recursive runner
 * without taking a static dependency on `spawn-worker.ts` (which would
 * be a module cycle).
 */
export function setKernelRecursiveSpawn(fn: RecursiveSpawnFn): void {
  recursiveSpawn = fn;
}

/**
 * Returns the shared dispatcher, lazily constructing it on first call.
 * The default handler set (`'execSync'`) is registered exactly once at
 * construction; subsequent spawns just `attach` their ring.
 *
 * Throws if {@link setKernelRecursiveSpawn} has not been called yet —
 * that wiring is the responsibility of `spawn-worker.ts` and must
 * happen before any code reaches this getter.
 */
export function getKernelDispatcher(): SyncRpcDispatcher {
  if (kernelDispatcher !== null) return kernelDispatcher;
  if (recursiveSpawn === null) {
    throw new Error(
      'kernel.getKernelDispatcher: recursive spawn not wired — spawn-worker.ts must call setKernelRecursiveSpawn() at module load',
    );
  }
  const dispatcher = new SyncRpcDispatcher();
  const runner = makeRecursiveRunner(recursiveSpawn);
  const resolver: ScriptResolver = (path) => {
    const r = getExecSyncScriptResolver();
    return r === null ? null : r(path);
  };
  registerDefaultHandlers(dispatcher, {
    // `callerPid` is unused by `execSync` today; pass 1 (the kernel
    // root) so handlers that grow PID-sensitive behaviour later have a
    // sane default. The per-child PID still flows through the ring's
    // request frame, not through the registration.
    callerPid: 1,
    resolveScript: resolver,
    runWorker: runner,
  });
  kernelDispatcher = dispatcher;
  return kernelDispatcher;
}

/**
 * Test-only: drop the singleton so the next call recreates it. Detaches
 * every ring still attached to the previous instance so the timer dies
 * with it.
 */
export function clearKernelDispatcher(): void {
  if (kernelDispatcher === null) return;
  kernelDispatcher.detachAll();
  kernelDispatcher = null;
}
