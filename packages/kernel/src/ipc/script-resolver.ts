/**
 * Host-side registration of the script resolver used by the default
 * `execSync` sync RPC handler (ADR-0011 phase 3).
 *
 * The kernel does not own the VFS — `vfs → kernel` layering allows the
 * dependency in principle, but we keep the kernel filesystem-agnostic so
 * alternative backings (OPFS, in-memory, remote) can plug in without
 * touching the kernel. The runtime-js layer wires this at boot, passing
 * a function that reads from its `syncMirror()`.
 *
 * When no resolver is registered, the `execSync` handler rejects every
 * script with `ENOENT` — keeps the failure loud rather than silently
 * returning empty output.
 */

import type { ScriptResolver } from './default-handlers.ts';

let scriptResolver: ScriptResolver | null = null;

/**
 * Install the script resolver. Idempotent — calling twice replaces the
 * previous resolver. Pass `null` to unregister (e.g. test teardown).
 */
export function setExecSyncScriptResolver(resolver: ScriptResolver | null): void {
  scriptResolver = resolver;
}

/** Test-only accessor. */
export function getExecSyncScriptResolver(): ScriptResolver | null {
  return scriptResolver;
}
