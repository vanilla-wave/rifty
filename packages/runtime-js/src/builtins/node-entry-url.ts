/**
 * Injection seam for the node-entry bootstrap worker URL (Opt-Y, ADR-0137).
 *
 * Kept separate from `node-entry.ts` (which imports the module loader) so the
 * in-package consumers — `child_process` / `execSync` — can read the URL
 * WITHOUT pulling the loader into the `builtins → module-loader → builtins`
 * import graph (madge cycle). The host sets it at startup; mirrors the kernel's
 * `setKernelWorkerUrl`.
 */

import {
  resetNodeEntryWorkerRuntimeEnv,
  setNodeEntryWorkerRuntimeEnv,
} from './node-entry-runtime-config.ts';

let nodeEntryWorkerUrl: string | URL | null = null;

/** Inject the node-entry bootstrap worker URL (host startup). */
export function setNodeEntryWorkerUrl(url: string | URL): void {
  nodeEntryWorkerUrl = url;
}

/** Inject URL plus host-only bootstrap env inherited by every recursive node worker. */
export function configureNodeEntryWorker(
  url: string | URL,
  runtimeEnv: Readonly<Record<string, string>>,
): void {
  nodeEntryWorkerUrl = url;
  setNodeEntryWorkerRuntimeEnv(runtimeEnv);
}

/** The configured node-entry bootstrap worker URL, or `null` if unset. */
export function getNodeEntryWorkerUrl(): string | URL | null {
  return nodeEntryWorkerUrl;
}

/** Test-only: clear the injected URL. */
export function resetNodeEntryWorkerUrl(): void {
  nodeEntryWorkerUrl = null;
  resetNodeEntryWorkerRuntimeEnv();
}
