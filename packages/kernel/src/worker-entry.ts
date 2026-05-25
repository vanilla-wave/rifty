/// <reference lib="webworker" />

/**
 * Kernel-side Worker bootstrap (ADR-0011 phase 1).
 *
 * Loaded by `kernel.spawn` (phase 2 — wires this entry into a `new Worker(...)`
 * call via a bundler `?worker&url` import). For each spawned child, the
 * bootstrap:
 *   1. Waits for a single `init` message carrying {@link WorkerSpawnSpec}.
 *   2. Installs a minimal Node-style `process` shim on `globalThis` (pid,
 *      ppid, argv, env, cwd(), stdout/stderr.write, exit).
 *   3. Constructs a {@link SabRing} over `spec.syncRing` and exposes it via
 *      a non-enumerable global hook for the runtime layer (phase 2 reads
 *      this when implementing sync syscalls).
 *   4. Executes the entry (either eval'd source or a dynamic `import(url)`).
 *   5. Posts `{ type: 'exit', code }` back to the parent and closes the
 *      stdio ports.
 *
 * The exit code follows Node:
 *   - normal completion / promise resolution → 0
 *   - any throw / unhandled rejection → 1
 *   - `process.exit(N)` → N
 *
 * Out of scope for phase 1:
 *   - Wiring `runtime-js`'s module loader (the entry runs the script as a
 *     standalone unit; CommonJS / built-in resolution lands when phase 2
 *     pulls runtime-js into the entry).
 *   - Sync syscall servicing — phase 2/3 install handlers around `syncRing`.
 *   - Stdin support — `spec.stdio.stdin` is reserved for phase 2.
 */

import { SabRing } from './ipc/sab-ring.ts';

/** Stdio channels passed to the worker. Each is a transferred MessagePort. */
export interface WorkerStdioPorts {
  readonly stdout: MessagePort;
  readonly stderr: MessagePort;
  readonly stdin: MessagePort;
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

/** Internal: the `process` shim we install on the Worker's globalThis. */
interface ProcessShim {
  pid: number;
  ppid: number;
  argv: readonly string[];
  env: Readonly<Record<string, string>>;
  cwd(): string;
  stdout: { write(chunk: string | Uint8Array): boolean };
  stderr: { write(chunk: string | Uint8Array): boolean };
  exit(code?: number): never;
}

/**
 * Thrown internally by `process.exit(N)` to unwind back to the bootstrap
 * loop. Carries the requested exit code.
 */
class ProcessExitError extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.name = 'ProcessExitError';
    this.code = code;
  }
}

const STDIO_ENCODER = new TextEncoder();

function encodeChunk(chunk: string | Uint8Array): Uint8Array {
  return typeof chunk === 'string' ? STDIO_ENCODER.encode(chunk) : chunk;
}

function makeStdioWriter(port: MessagePort): { write(chunk: string | Uint8Array): boolean } {
  return {
    write(chunk) {
      const bytes = encodeChunk(chunk);
      // Transfer the buffer when we own it (i.e. created by TextEncoder).
      // Pre-existing Uint8Arrays may share their backing buffer with the
      // caller, so transferring is unsafe — copy in that case.
      if (typeof chunk === 'string') {
        port.postMessage(bytes, [bytes.buffer]);
      } else {
        const copy = new Uint8Array(bytes);
        port.postMessage(copy, [copy.buffer]);
      }
      return true;
    },
  };
}

function installProcessShim(spec: WorkerSpawnSpec, ports: WorkerStdioPorts): ProcessShim {
  const shim: ProcessShim = {
    pid: spec.pid,
    ppid: spec.ppid,
    argv: spec.argv,
    env: spec.env,
    cwd: () => spec.cwd,
    stdout: makeStdioWriter(ports.stdout),
    stderr: makeStdioWriter(ports.stderr),
    exit: (code = 0): never => {
      throw new ProcessExitError(code);
    },
  };
  // Non-enumerable so the entry script can still create its own `process`
  // shadow if it wants — but `globalThis.process` is what most code reaches
  // for. Phase 2's runtime-js layer will replace this with the full builtin.
  Object.defineProperty(globalThis, 'process', {
    value: shim,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return shim;
}

/**
 * Internal hook key used to publish the {@link SabRing} for the spawned
 * realm. Phase 2 (sync syscalls inside runtime-js) reads this to thread the
 * ring through to `execSync`, `readFileSync`, etc.
 */
export const KERNEL_SAB_RING_KEY = '__riftyKernelSyncRing__';

function publishSyncRing(ring: SabRing): void {
  Object.defineProperty(globalThis, KERNEL_SAB_RING_KEY, {
    value: ring,
    writable: false,
    configurable: true,
    enumerable: false,
  });
}

async function runEntry(entry: WorkerEntryDescriptor): Promise<void> {
  if (entry.kind === 'url') {
    await import(/* @vite-ignore */ entry.url);
    return;
  }
  // Source kind: compile via `new AsyncFunction(code)` so top-level await
  // works, and append a sourceURL pragma so dev-tools and stack traces
  // show the right file. We deliberately do NOT thread runtime-js's
  // require/module here — that's phase 2's job.
  const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor as new (
    body: string,
  ) => () => Promise<void>;
  const body = `${entry.code}\n//# sourceURL=${entry.sourceUrl}`;
  const fn = new AsyncFunction(body);
  await fn();
}

function closePorts(ports: WorkerStdioPorts): void {
  // Closing stdout/stderr lets the parent's consumer observe EOF. stdin is
  // reserved for phase 2 but closed here for symmetry.
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
}

/**
 * Internal bootstrap entry. Exported (instead of running on import) so the
 * conformance test can drive a stub host without spinning up a full Worker.
 * Phase 2's `kernel.spawn` is responsible for invoking
 * {@link installWorkerEntry} from the actual worker module that Vite emits.
 */
export function installWorkerEntry(
  target: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope,
): void {
  const onMessage = async (ev: MessageEvent): Promise<void> => {
    const msg = ev.data as WorkerInitMessage | undefined;
    if (!msg || msg.type !== 'init') return;
    // Init is one-shot. Detach the listener so a stray second message
    // doesn't double-execute.
    target.removeEventListener('message', onMessage as unknown as EventListener);

    const spec = msg.spec;
    const ring = SabRing.attach(spec.syncRing);
    publishSyncRing(ring);
    installProcessShim(spec, spec.stdio);

    let code = 0;
    try {
      await runEntry(spec.entry);
    } catch (err) {
      if (err instanceof ProcessExitError) {
        code = err.code;
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

// Auto-install when loaded as a real Worker. Detection: `self` is a
// DedicatedWorkerGlobalScope (has `postMessage` and lacks `window`).
declare const WorkerGlobalScope: { prototype: object } | undefined;
const isWorkerRealm =
  typeof WorkerGlobalScope !== 'undefined' &&
  typeof (globalThis as unknown as { postMessage?: unknown }).postMessage === 'function' &&
  typeof (globalThis as unknown as { window?: unknown }).window === 'undefined';

if (isWorkerRealm) {
  installWorkerEntry();
}
