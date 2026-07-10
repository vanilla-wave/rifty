/**
 * Node-shape `process` install for kernel-spawned Workers (ADR-0039, ADR-0157).
 *
 * Builds the unified {@link NodeProcess} (`../builtins/process.ts`) from the
 * kernel's {@link KernelProcessSpec} — identity, capabilities, and stdio ports —
 * and installs it on `globalThis.process`. Runtime IPC is capability-gated;
 * internal Worker control never becomes public `process.send` (ADR-0217).
 * `installNodeRuntime` is the pre-entry hook: it builds the process AND, gated
 * to Node workers, runs the rich extras (`patchPromiseForNextTick` for nextTick
 * ordering + `globalThis.Buffer` + `globalThis.global`). WASI workers skip
 * those (no over-Node).
 *
 * Registers itself as the kernel's pre-entry hook at module load — host bundles
 * wire it in by importing this BEFORE `@riftydev/kernel/worker-entry`:
 *
 * ```ts
 * import '@riftydev/runtime-js/install-process';
 * import '@riftydev/kernel/worker-entry';
 * ```
 *
 * The kernel runs the hook after publishing the `KernelProcessSpec` and before
 * the user entry, so `kind: 'source'` scripts see a shaped `globalThis.process`.
 *
 * Before ADR-0039 the kernel installed this shim itself; the audit flagged that
 * as a Node-API leak, so runtime-js now owns it. Before ADR-0157 the pre-entry
 * installed a MINIMAL shim and `node-entry-bootstrap` re-swapped to the rich
 * `riftyProcess` — orphaning argv/cwd/stdin. Now there is ONE seeded process.
 */

import {
  type KernelProcessSpec,
  type WorkerSpawnSpec,
  setKernelPreEntryHook,
} from '@riftydev/kernel';
import { Buffer } from '../builtins/buffer.ts';
import { NodeProcess, patchPromiseForNextTick } from '../builtins/process.ts';
import { installWebGlobals } from '../builtins/web-globals.ts';
import { installGlobalAlias, installWorkerRealmCompat } from './worker-realm-compat.ts';

/**
 * The `process` shim installed for kernel-spawned children. Alias of the unified
 * {@link NodeProcess} (ADR-0157) — kept as a named export for the public
 * `./install-process` subpath. `@riftydev/runtime-wasi`'s worker entry expects
 * the structural identity/stdio/exit contract; runtime IPC is optional.
 */
export type NodeProcessShim = NodeProcess;

/**
 * Build a Node-shape `process` from `spec` and install it on `globalThis` as a
 * non-enumerable, configurable value. Idempotent — re-installing overwrites.
 *
 * `exit(N)` throws an Error tagged `code === 'RIFTY_PROCESS_EXIT'` with a numeric
 * `exitCode`; the kernel's worker bootstrap detects this shape and maps it to the
 * worker's exit code (see `@riftydev/kernel/src/worker-entry.ts`).
 */
export function installNodeProcessShim(
  spec: KernelProcessSpec,
  opts: { readonly installGlobalAlias?: boolean } = {},
): NodeProcess {
  const shim = new NodeProcess(spec);
  const withGlobalAlias = opts.installGlobalAlias ?? true;
  // Non-enumerable so user code can still shadow `process` if it wants.
  Object.defineProperty(globalThis, 'process', {
    value: shim,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  // `global === globalThis` via the single helper (Node's `global` descriptor:
  // writable+enumerable+configurable — NOT a private non-enumerable alias).
  if (withGlobalAlias) installGlobalAlias();
  return shim;
}

/**
 * Pre-entry hook: install the seeded process, then — only for Node workers —
 * the rich extras. Gate: a WASI worker self-identifies via `__RIFTY_WASI_WASM_URL`
 * and gets NEITHER the Promise.then nextTick patch NOR `globalThis.Buffer` NOR
 * `globalThis.global` (no Node over-implementation where it shouldn't be).
 * Every other kernel worker (.bin / execSync / node-serve / dev-server / owner)
 * is a Node worker and gets them — closing the latent gap where `.bin`/execSync
 * children lacked them.
 * Timers + keepalive stay universal at `kernel-worker-entry.ts` module top-level.
 */
export function installNodeRuntime(spec: WorkerSpawnSpec): void {
  const isNode = spec.env.__RIFTY_WASI_WASM_URL === undefined;
  installNodeProcessShim(
    {
      pid: spec.pid,
      ppid: spec.ppid,
      argv: spec.argv,
      env: spec.env,
      cwd: spec.cwd,
      capabilities: spec.capabilities,
      stdio: spec.stdio,
    },
    {
      installGlobalAlias: isNode,
    },
  );
  if (isNode) {
    patchPromiseForNextTick();
    (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
    installWebGlobals();
    // Node-CJS realm-compat globals (`global`/writable `self`/shared-memory
    // `TextDecoder`) that Rolldown's emnapi pthread worker needs — see
    // `worker-realm-compat.ts`. Node workers only (a WASI guest runs raw WASI,
    // no JS realm-compat); folded here so the host pre-entry hook needs no change.
    installWorkerRealmCompat();
  }
}

// Module-load side effect: register the rich gated installer as the kernel's
// pre-entry hook, so importing this BEFORE `@riftydev/kernel/worker-entry` wires
// it up. Hosts that need tree-shake-safe explicit bindings (the playground
// kernel-worker-entry chunk) import `installNodeRuntime` and re-register it.
setKernelPreEntryHook(installNodeRuntime);
