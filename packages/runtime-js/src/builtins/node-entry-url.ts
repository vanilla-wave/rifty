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
  type NodeEntryHostRuntime,
  configureNodeEntryWorkerRuntime,
  getConfiguredNodeEntryWorkerUrl,
  resetNodeEntryWorkerRuntime,
  setNodeEntryWorkerUrlOnly,
} from './node-entry-runtime-config.ts';

export {
  NODE_ENTRY_BOOTSTRAP_PROTOCOL,
  buildNodeEntryWorkerEntry,
  readNodeEntryBootstrap,
  type NodeEntryBootstrapPayload,
  type NodeEntryHostRuntime,
  type NodeEntryLaunch,
  type NodeEntryProgramLaunch,
  type NodeEntryTerminalBootstrap,
  type NodeEntryWorkerThreadLaunch,
} from './node-entry-runtime-config.ts';

/** Inject only the URL; invalidates any older host bootstrap snapshot. */
export function setNodeEntryWorkerUrl(url: string | URL): void {
  setNodeEntryWorkerUrlOnly(url);
}

/** Atomically inject the URL plus host-owned out-of-band bootstrap values. */
export function configureNodeEntryWorker(
  url: string | URL,
  runtimeConfig: NodeEntryHostRuntime,
): void {
  configureNodeEntryWorkerRuntime(url, runtimeConfig);
}

/** The configured node-entry bootstrap worker URL, or `null` if unset. */
export function getNodeEntryWorkerUrl(): string | URL | null {
  return getConfiguredNodeEntryWorkerUrl();
}

/** Test-only: clear the injected URL. */
export function resetNodeEntryWorkerUrl(): void {
  resetNodeEntryWorkerRuntime();
}
