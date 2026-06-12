/// <reference lib="webworker" />

/**
 * Kernel-side Worker bootstrap (ADR-0011 phase 1, ADR-0039).
 *
 * Loaded by `kernel.spawn` (phase 2 wires this entry into a `new Worker(...)`
 * via a bundler `?worker&url` import). For each spawned child, the bootstrap:
 *   1. Waits for a single `init` message carrying {@link WorkerSpawnSpec}.
 *   2. Builds a {@link SabRing} over `spec.syncRing`, backing a
 *      {@link SyncRpcClient} for the parent-bound sync-call shim.
 *   3. Publishes the sync-call shim via {@link publishKernelSyncApi}.
 *   4. Publishes a typed {@link KernelProcessSpec} via
 *      {@link publishKernelProcessSpec} (ADR-0039) — a runtime-agnostic
 *      snapshot of `{pid, ppid, argv, env, cwd, stdio}`. Kernel does NOT
 *      install a Node-shape `globalThis.process`; that lives in
 *      `@riftydev/runtime-js`.
 *   5. Invokes the optional pre-entry hook ({@link setKernelPreEntryHook}).
 *      Node-style hosts use it to install the Node `process` global from
 *      runtime-js before user code runs.
 *   6. Runs the entry (eval'd source or a dynamic `import(url)`).
 *   7. Posts `{ type: 'exit', code }` and closes the stdio ports.
 *
 * The exit code follows Node:
 *   - normal completion / promise resolution → 0
 *   - any throw / unhandled rejection → 1
 *   - higher layer signals exit (by throwing an `Error` with
 *     `code === 'RIFTY_PROCESS_EXIT'` and a numeric `exitCode`) → that code.
 *
 * Out of scope:
 *   - Node-API installation — runtime-js owns it (ADR-0039).
 *   - Sync syscall servicing — registered by higher layers via
 *     `dispatcher.register('method', handler)`.
 *   - Stdin support — `spec.stdio.stdin` is reserved for ADR-0011 phase 2
 *     follow-ups.
 */

import { DEFAULT_PAYLOAD_CAPACITY, SabRing } from './ipc/sab-ring.ts';
import { SyncRpcClient } from './ipc/sync-client.ts';
import {
  KERNEL_SYNC_CALL_KEY,
  type KernelProcessSpec,
  type KernelSyncCall,
  publishKernelProcessSpec,
  publishKernelSyncApi,
} from './shared-globals.ts';

// Legacy re-exports: historical consumers (runtime-js, tests) imported these
// from here. Canonical home is now `shared-globals.ts`; new code SHOULD prefer
// the shared-globals publish/read helpers.
export { KERNEL_SYNC_CALL_KEY, type KernelSyncCall };

/**
 * Stdio + IPC channels passed to the worker. Each is a transferred
 * MessagePort.
 *
 * `ipc` carries the fork-mode IPC channel (ADR-0045) — structured-cloned
 * `{ kind: 'ipc:message', payload }` and `{ kind: 'ipc:disconnect' }`
 * frames between the parent's `WorkerProcessHandle.send` and the child
 * realm's `process.send` / `process.on('message', …)`. The name `stdio`
 * is preserved for ABI continuity; conceptually it's now the wider
 * "kernel-owned ports" struct.
 */
export interface WorkerStdioPorts {
  readonly stdout: MessagePort;
  readonly stderr: MessagePort;
  readonly stdin: MessagePort;
  readonly ipc: MessagePort;
}

/** Entry script descriptor. Either inlined source or a URL to `import()`. */
export type WorkerEntryDescriptor =
  | { readonly kind: 'source'; readonly code: string; readonly sourceUrl: string }
  | { readonly kind: 'url'; readonly url: string };

/**
 * Bootstrap payload sent from `kernel.spawn` to a fresh kernel Worker.
 * Transferable fields (`syncRing`, the three `stdio` ports) MUST appear in
 * the parent's `postMessage` transfer list.
 */
export interface WorkerSpawnSpec {
  readonly entry: WorkerEntryDescriptor;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly stdio: WorkerStdioPorts;
  readonly syncRing: SharedArrayBuffer;
  /**
   * Per-direction SAB ring payload capacity (ADR-0084 #19). The parent picks
   * it when allocating `syncRing`; the child attaches with the SAME value so
   * both peers compute identical REQ/REP offsets. Defaults to
   * {@link DEFAULT_PAYLOAD_CAPACITY} for backward compatibility when absent.
   * `SabRing.attach` rejects a value inconsistent with `syncRing.byteLength`,
   * so a desynced capacity fails loudly instead of reading the wrong slot.
   */
  readonly payloadCapacity?: number;
  readonly pid: number;
  readonly ppid: number;
}

/** Init wire message. The parent posts exactly one of these per worker. */
export interface WorkerInitMessage {
  readonly type: 'init';
  readonly spec: WorkerSpawnSpec;
}

/** Exit wire message. The worker posts exactly one of these before close. */
export interface WorkerExitMessage {
  readonly type: 'exit';
  readonly code: number;
}

/**
 * Optional pre-entry hook signature. The kernel calls the hook (when
 * registered) right after publishing the {@link KernelProcessSpec} and
 * right before running the user's entry. Hosts that spawn Node-style
 * children register `installNodeProcessShim` from `@riftydev/runtime-js` so
 * the user script sees a fully-shaped `globalThis.process`.
 *
 * The hook MAY throw — a throw is treated like any other entry failure:
 * the worker exits with code 1 and the stack lands on stderr.
 */
export type KernelPreEntryHook = (spec: WorkerSpawnSpec) => void;

let preEntryHook: KernelPreEntryHook | null = null;

/**
 * Register the pre-entry hook (ADR-0039). Idempotent — re-registering
 * replaces the previous hook. Pass `null` to unregister (test teardown).
 *
 * The hook MUST be registered before the `'init'` message arrives;
 * runtime-js's `install-process` module side-effects this at module load,
 * and the host's kernel-worker chunk imports `install-process` before
 * `@riftydev/kernel/worker-entry`.
 */
export function setKernelPreEntryHook(hook: KernelPreEntryHook | null): void {
  preEntryHook = hook;
}

/** Test-only accessor — current pre-entry hook value. */
export function getKernelPreEntryHook(): KernelPreEntryHook | null {
  return preEntryHook;
}

/**
 * Higher-layer exit signal: a thrown `Error` with `code === 'RIFTY_PROCESS_EXIT'`
 * and a numeric `exitCode` field maps to the worker's exit code. This is how
 * `runtime-js`'s `installNodeProcessShim` makes `process.exit(N)` propagate
 * out of the entry function — kernel itself stays Node-API-agnostic and
 * just looks for the shape.
 */
const RIFTY_PROCESS_EXIT_CODE = 'RIFTY_PROCESS_EXIT';
interface RiftyProcessExitShape {
  code: typeof RIFTY_PROCESS_EXIT_CODE;
  exitCode: number;
}
function isRiftyProcessExit(err: unknown): err is RiftyProcessExitShape {
  if (typeof err !== 'object' || err === null) return false;
  const candidate = err as { code?: unknown; exitCode?: unknown };
  return candidate.code === RIFTY_PROCESS_EXIT_CODE && typeof candidate.exitCode === 'number';
}

const STDIO_ENCODER = new TextEncoder();

function publishSyncCallShim(ring: SabRing): void {
  const client = new SyncRpcClient(ring);
  const shim: KernelSyncCall = (method, payload) => client.call(method, payload);
  publishKernelSyncApi({ call: shim });
}

function publishProcessSpec(spec: WorkerSpawnSpec): void {
  const out: KernelProcessSpec = {
    pid: spec.pid,
    ppid: spec.ppid,
    argv: spec.argv,
    env: spec.env,
    cwd: spec.cwd,
    stdio: spec.stdio,
  };
  publishKernelProcessSpec(out);
}

async function runEntry(entry: WorkerEntryDescriptor): Promise<void> {
  if (entry.kind === 'url') {
    await import(/* @vite-ignore */ entry.url);
    return;
  }
  // Compile via `new AsyncFunction(code)` so top-level await works; append a
  // sourceURL pragma for correct stack traces. Kernel does NOT thread
  // runtime-js's require/module here — higher layer's job via the pre-entry
  // hook (ADR-0039).
  const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor as new (
    body: string,
  ) => () => Promise<void>;
  const body = `${entry.code}\n//# sourceURL=${entry.sourceUrl}`;
  const fn = new AsyncFunction(body);
  await fn();
}

function closePorts(ports: WorkerStdioPorts): void {
  // Closing stdout/stderr lets the parent's consumer observe EOF. stdin is
  // closed here for symmetry. `ipc` (ADR-0045) is closed last so any
  // disconnect frame the runtime-js installer posted during teardown has
  // already left the realm.
  try {
    ports.stdout.close();
  } catch {
    /* port already closed by parent */
  }
  try {
    ports.stderr.close();
  } catch {
    /* port already closed by parent */
  }
  try {
    ports.stdin.close();
  } catch {
    /* port already closed by parent */
  }
  try {
    ports.ipc.close();
  } catch {
    /* port already closed by parent */
  }
}

/**
 * Internal bootstrap entry. Exported (instead of running on import) so the
 * conformance test can drive a stub host without spinning up a full Worker.
 * Phase 2's `kernel.spawn` is responsible for invoking
 * {@link installWorkerEntry} from the actual worker module that Vite emits.
 */
const installedTargets = new WeakSet<DedicatedWorkerGlobalScope>();

export function installWorkerEntry(
  target: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope,
): void {
  if (installedTargets.has(target)) return;
  installedTargets.add(target);

  const onMessage = async (ev: MessageEvent): Promise<void> => {
    const msg = ev.data as WorkerInitMessage | undefined;
    if (!msg || msg.type !== 'init') return;
    // Init is one-shot: detach so a stray second message doesn't double-execute.
    target.removeEventListener('message', onMessage as unknown as EventListener);

    const spec = msg.spec;
    // ADR-0084 #19: attach with the parent-chosen capacity so both peers
    // compute identical offsets. Absent (legacy specs) → default.
    const ring = SabRing.attach(spec.syncRing, spec.payloadCapacity ?? DEFAULT_PAYLOAD_CAPACITY);
    // Expose the sync-call shim so runtime-js can route `execSync`,
    // `readFileSync`, etc. through the parent dispatcher without each builtin
    // re-implementing the SAB ring framing.
    publishSyncCallShim(ring);
    // ADR-0039: typed process spec only, no Node-shape shim. The pre-entry hook
    // reads it to install whatever process surface its runtime needs.
    publishProcessSpec(spec);

    let code = 0;
    try {
      const hook = preEntryHook;
      if (hook !== null) hook(spec);
      await runEntry(spec.entry);
    } catch (err) {
      if (isRiftyProcessExit(err)) {
        code = err.exitCode;
      } else {
        code = 1;
        const message = err instanceof Error ? `${err.stack ?? err.message}\n` : `${String(err)}\n`;
        try {
          spec.stdio.stderr.postMessage(STDIO_ENCODER.encode(message));
        } catch {
          /* stderr may already be closed */
        }
      }
    }

    const exitMessage: WorkerExitMessage = { type: 'exit', code };
    target.postMessage(exitMessage);
    closePorts(spec.stdio);
    // Let the parent observe exit before the realm dies.
    target.close();
  };

  target.addEventListener('message', onMessage as unknown as EventListener);
}

// Auto-install when loaded as a real Worker: `self` is a
// DedicatedWorkerGlobalScope (has `postMessage`, lacks `window`).
declare const WorkerGlobalScope: { prototype: object } | undefined;
const isWorkerRealm =
  typeof WorkerGlobalScope !== 'undefined' &&
  typeof (globalThis as unknown as { postMessage?: unknown }).postMessage === 'function' &&
  typeof (globalThis as unknown as { window?: unknown }).window === 'undefined';

if (isWorkerRealm) {
  installWorkerEntry();
}
