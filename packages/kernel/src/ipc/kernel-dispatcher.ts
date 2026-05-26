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
 * ADR-0039: the singleton ships with **no** pre-registered handlers and
 * **no** recursive-spawn wiring. Both belonged to the Node-API surface
 * (`'execSync'` + the recursive Worker runner) and have moved to
 * `@rifty/runtime-js`. Higher layers register methods via
 * `getKernelDispatcher().register(method, handler)` at boot.
 */

import { SyncRpcDispatcher } from './sync-dispatch.ts';

let kernelDispatcher: SyncRpcDispatcher | null = null;

/**
 * Returns the shared dispatcher, lazily constructing it on first call.
 * The dispatcher is a thin generic registry — no methods are registered
 * by the kernel itself. Higher layers (e.g. `@rifty/runtime-js`'s
 * `installRuntimeJsExecSyncHandler`) install their handlers explicitly.
 */
export function getKernelDispatcher(): SyncRpcDispatcher {
  if (kernelDispatcher !== null) return kernelDispatcher;
  kernelDispatcher = new SyncRpcDispatcher();
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
