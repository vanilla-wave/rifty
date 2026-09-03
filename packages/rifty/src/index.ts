/**
 * rifty — the one-install front door (EPIC B, DD-2).
 *
 * `npm i @riftydev/sdk` pulls the whole runtime. From the root you get the
 * framework-free façade ({@link createSandbox}, {@link checkCapabilities}); each
 * individual layer is a subpath that re-exports the matching `@riftydev/*` package
 * verbatim:
 *
 *   @riftydev/sdk/vfs · @riftydev/sdk/io · @riftydev/sdk/kernel · @riftydev/sdk/runtime · @riftydev/sdk/wasi · @riftydev/sdk/net
 *   @riftydev/sdk/npm-client · @riftydev/sdk/shell · @riftydev/sdk/terminal · @riftydev/sdk/service-worker
 *
 * Boot a sandbox:
 * ```ts
 * import { checkCapabilities, createSandbox } from '@riftydev/sdk';
 * async function boot(workerUrl: string | URL): Promise<void> {
 *   const caps = checkCapabilities();
 *   if (!caps.sufficient || !caps.capabilities.crossOriginIsolated) {
 *     throw new Error(caps.summary);
 *   }
 *   const sandbox = await createSandbox({ workerUrl });
 *   try {
 *     await sandbox.runtime.eval('console.log(1 + 2)');
 *   } finally {
 *     sandbox.dispose();
 *   }
 * }
 * ```
 */
export { COI_REQUIRED_MESSAGE, createSandbox } from './sandbox.ts';
export type {
  CreateSandboxOptions,
  GenericCreateSandboxOptions,
  Sandbox,
  SandboxCapabilityFeature,
  SandboxCapabilityReport,
  SandboxDeps,
  SandboxToolchain,
  ToolchainCreateSandboxOptions,
  ToolchainSandbox,
  VfsBackend,
  VfsBootInfo,
} from './sandbox.ts';
export { checkCapabilities } from './capabilities.ts';
export type { Capabilities, CapabilityCheck } from './capabilities.ts';
// Re-exported so `Sandbox.runtime` is fully typed from the umbrella alone,
// without a deep `@riftydev/runtime-js` import.
export type {
  EvalOptions,
  EvalResult,
  RuntimeController,
  RuntimeEvent,
  RuntimeFs,
  // Payload of the `diagnostic` RuntimeEvent — SDK consumers type it without a deep import.
  TelemetryEntry,
  TelemetryKind,
  TelemetrySnapshot,
} from '@riftydev/runtime-js';
