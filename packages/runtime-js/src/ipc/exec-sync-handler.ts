/**
 * Public subpath surface (`@riftydev/runtime-js/ipc/exec-sync-handler`) for the
 * runtime-js `'execSync'` sync RPC handler.
 *
 * Why a public seam: the handler must be registered on the dispatcher owned by
 * the realm that calls `spawnKernelWorker` (the page realm), because that realm
 * services the guest's SAB ring (ADR-0011 phase 3 / sync-dispatch.ts §"runs in
 * the realm that owns the kernel"). In the playground the page realm never
 * `require`s `child_process`, so the lazy first-require install in
 * `builtins/child_process.ts` never fires there. A host that wants kernel-spawned
 * guests to run `execSync` end-to-end (e.g. the COI-Worker e2e harness) wires it
 * explicitly via this entry. Flagged for an ADR — promotes an existing internal
 * (`ipc/handlers.ts`) to the public cross-package surface.
 */
export {
  type ExecSyncPayload,
  type InstallRuntimeJsExecSyncOptions,
  type ScriptResolver,
  installRuntimeJsExecSyncHandler,
} from './handlers.ts';
