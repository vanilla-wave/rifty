/**
 * Module-level singleton {@link SyncRpcDispatcher} backing every
 * kernel-spawned Worker.
 *
 * Singleton (not per-child) to avoid N busy-poll `setInterval(1ms)` timers
 * on the main realm — one instance serves many rings (ADR-0011 phase 3).
 *
 * ADR-0039: ships with no pre-registered handlers and no recursive-spawn
 * wiring; both moved to `@riftydev/runtime-js`. Higher layers register
 * methods via `getKernelDispatcher().register(method, handler)` at boot.
 */

import { SyncRpcDispatcher } from './sync-dispatch.ts';

let kernelDispatcher: SyncRpcDispatcher | null = null;

/**
 * Returns the shared dispatcher, lazily constructing it on first call.
 * Thin generic registry — the kernel registers no methods itself; higher
 * layers install their handlers explicitly.
 */
export function getKernelDispatcher(): SyncRpcDispatcher {
  if (kernelDispatcher !== null) return kernelDispatcher;
  kernelDispatcher = new SyncRpcDispatcher();
  return kernelDispatcher;
}

/**
 * Test-only: drop the singleton so the next call recreates it. Detaches
 * every still-attached ring so the previous instance's timer dies with it.
 */
export function clearKernelDispatcher(): void {
  if (kernelDispatcher === null) return;
  kernelDispatcher.detachAll();
  kernelDispatcher = null;
}
