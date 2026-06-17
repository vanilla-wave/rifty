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
  /**
   * Server-process flag (ADR-0144). When `true`, a worker whose entry finishes
   * setup WITHOUT throwing is NOT reaped: the kernel skips the exit message,
   * port close, and `self.close()`, leaving the realm alive (its open ports /
   * timers keep it live) until the parent terminates it. A run-to-completion
   * process (`serve` absent/false) reaps the instant its entry settles, as
   * before. Replaces the `await new Promise<never>(() => {})` keep-alive hack
   * (the ADR-0077 follow-up; the serve-worker gate for ADR-0143 single-store-owner).
   */
  readonly serve?: boolean;
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
 * Optional drain hook (child-realm-async-lifecycle). For a run-to-completion
 * child (`serve` absent/false) that finished its entry top-level WITHOUT
 * throwing, the kernel `await`s this BEFORE reaping — letting the realm drain
 * its event loop (pending timers/immediates/imports) the way real Node exits on
 * "loop empty", not "top-level resolved". Opaque to the kernel: runtime-js
 * registers a refcount-backed implementation. Resolve = drained cleanly; reject
 * = a recorded unhandledrejection or a drain-cap timeout → treated like any
 * entry failure (stderr + exit 1), preserving "no silent stub".
 *
 * NOT awaited for `serve === true` (servers are kept alive by their own
 * ports, never drain-reaped).
 */
export type KernelDrainHook = (spec: WorkerSpawnSpec) => Promise<void>;

let drainHook: KernelDrainHook | null = null;

/** Register the drain hook (idempotent replace; `null` unregisters). */
export function setKernelDrainHook(hook: KernelDrainHook | null): void {
  drainHook = hook;
}

/** Test-only accessor — current drain hook value. */
export function getKernelDrainHook(): KernelDrainHook | null {
  return drainHook;
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
    // Import via an indirectly-eval'd importer so NO bundler's static dynamic-
    // import analysis sees a literal `import(<var>)` here. The kernel is layer-0
    // and bundler-agnostic: a literal variable import() lets a bundler/dev-server
    // inject its OWN client/helper module into this realm (e.g. an HMR ping that
    // never clears) — but this realm must stay a faithful, infra-free process
    // realm: it runs run-to-completion children that drain their event loop, and
    // a stray infra timer would pin the loop forever. The indirect eval is
    // invisible to static import lexers; behaviour is an identical dynamic import.
    // (CSP: this realm already permits eval — see the new AsyncFunction below.)
    // biome-ignore lint/security/noGlobalEval: indirect eval hides the import() literal from bundler static analysis — intentional, see comment above
    // biome-ignore lint/style/noCommaOperator: (0, eval) is the standard idiom for indirect eval — avoids direct `eval` name which some bundlers still detect
    const indirectImport = (0, eval)('u => import(u)') as (u: string) => Promise<unknown>;
    await indirectImport(entry.url);
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

/** Outcome of running a worker entry: did it throw, and the resolved exit code. */
export interface WorkerEntryOutcome {
  readonly threw: boolean;
  readonly code: number;
}

/**
 * Post-entry teardown decision (ADR-0144 — kernel server-process model). A
 * `serve` process that finished its entry WITHOUT throwing stays ALIVE — the
 * realm is kept live by its own open MessagePorts / timers until the parent
 * terminates it — so we skip the exit message, the port close, and
 * `self.close()`. Everything else (a run-to-completion process, or a `serve`
 * entry that THREW during setup — including `process.exit` →
 * `RIFTY_PROCESS_EXIT`) posts the exit message, closes the stdio ports, and
 * closes the realm, exactly as before.
 *
 * Pure + exported so the serve/reap decision is unit-testable without a Worker
 * realm (the full SAB `onMessage` path still needs COI). Replaces the
 * `await new Promise<never>(() => {})` keep-alive hack (ADR-0077 follow-up).
 */
export function finalizeWorkerEntry(
  target: { postMessage(message: unknown): void; close(): void },
  spec: WorkerSpawnSpec,
  outcome: WorkerEntryOutcome,
): void {
  if (spec.serve === true && !outcome.threw) return;
  const exitMessage: WorkerExitMessage = { type: 'exit', code: outcome.code };
  target.postMessage(exitMessage);
  closePorts(spec.stdio);
  target.close();
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
    let threw = false;
    try {
      const hook = preEntryHook;
      if (hook !== null) hook(spec);
      await runEntry(spec.entry);
      // child-realm-async-lifecycle: a run-to-completion child drains its event
      // loop before reaping (Node "exit on loop empty"). serve workers are kept
      // alive by their ports — never drained here. A drain rejection (recorded
      // unhandledrejection / cap timeout) falls through to the catch below →
      // stderr + exit 1 (no silent stub).
      if (spec.serve !== true && drainHook !== null) {
        await drainHook(spec);
      }
    } catch (err) {
      threw = true;
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

    // ADR-0144: a `serve` worker that finished setup cleanly stays alive; every
    // other case posts exit + closes the realm. (Lets the parent observe exit
    // before the realm dies.)
    finalizeWorkerEntry(target, spec, { threw, code });
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
