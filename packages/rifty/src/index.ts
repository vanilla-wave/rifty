/**
 * rifty — the one-install front door (EPIC B, DD-2).
 *
 * `npm i rifty` pulls the whole runtime. From the root you get the
 * framework-free façade ({@link createSandbox}, {@link checkCapabilities}); each
 * individual layer is a subpath that re-exports the matching `@rifty/*` package
 * verbatim:
 *
 *   rifty/vfs · rifty/io · rifty/kernel · rifty/runtime · rifty/wasi · rifty/net
 *   rifty/npm-client · rifty/shell · rifty/terminal · rifty/service-worker
 *
 * Boot a sandbox:
 * ```ts
 * import { checkCapabilities, createSandbox } from 'rifty';
 * if (!checkCapabilities().sufficient) showUnsupportedNotice();
 * const sandbox = await createSandbox({
 *   workerUrl: new URL('@rifty/runtime-js/worker', import.meta.url),
 * });
 * await sandbox.runtime.eval('console.log(1 + 2)');
 * ```
 */
export { COI_REQUIRED_MESSAGE, createSandbox } from './sandbox.ts';
export type {
  CreateSandboxOptions,
  Sandbox,
  SandboxDeps,
  VfsBackend,
  VfsBootInfo,
} from './sandbox.ts';
export { checkCapabilities } from './capabilities.ts';
export type { Capabilities, CapabilityCheck } from './capabilities.ts';
// Re-exported so `Sandbox.runtime` is fully typed from the umbrella alone,
// without a deep `@rifty/runtime-js` import.
export type {
  EvalOptions,
  EvalResult,
  RuntimeController,
  RuntimeEvent,
} from '@rifty/runtime-js';
