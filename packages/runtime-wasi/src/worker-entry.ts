/// <reference lib="webworker" />

/**
 * Runtime-side worker entry for {@link createWasiProcess} (ADR 0038, ADR 0039).
 *
 * Loaded by the kernel-side bootstrap (`@riftydev/kernel/worker-entry`) via the
 * `WorkerEntryDescriptor.kind === 'url'` path. The kernel-worker's `'init'`
 * handler publishes a typed {@link KernelProcessSpec} on `globalThis` (ADR-0039
 * — the kernel no longer installs a Node-shape `process` global), then
 * `await import(spec.entry.url)` evaluates THIS module. Gotcha: the entry-URL
 * bundle MUST differ from the kernel-worker boot bundle — the top-level await
 * reads the published spec and would crash if loaded before it's published. The
 * host registers the wasi-entry chunk via {@link setWasiWorkerUrl}; the adapter
 * ({@link createWasiProcess}) puts that URL in `spec.entry.url`.
 *
 * The top-level `await` blocks until the guest exits, so the kernel posts the
 * standard `{type:'exit', code}` exactly when the guest exits — no new wire
 * protocol.
 *
 * Inputs travel through the kernel's existing init surface:
 *   - `env.__RIFTY_WASI_WASM_URL` — fetchable URL of the WASM module. For
 *     `createWasiProcess({ wasm: ArrayBuffer })` the adapter makes a `blob:`
 *     URL; for `{ wasm: URL }` it passes through verbatim.
 *   - `env.__RIFTY_WASI_PREOPENS` — JSON-encoded preopens map
 *     (`Record<guestPath, hostPath>`), forwarded to {@link Wasi}.
 *   - `argv` — `['wasi-guest', ...userArgs]`, consumed by WASI's `args_get`.
 *   - `env` — full env minus the two `__RIFTY_WASI_*` channel keys.
 *
 * Guest stdout/stderr are posted as binary `Uint8Array`s on the spec's stdio
 * `MessagePort`s; the kernel-side parent forwards to the host's `ChildProcess`
 * streams.
 *
 * Exit semantics:
 *   - `proc_exit(N)` → `Wasi.start()` returns N → if N !== 0 we throw a
 *     `RIFTY_PROCESS_EXIT`-shaped error so the kernel reports the code; N === 0
 *     lets the module finish and the kernel reports 0.
 *   - guest throws otherwise → re-thrown at module top level; the kernel writes
 *     the stack to stderr and reports exit 1.
 */

import { readKernelProcessSpec } from '@riftydev/kernel';
import { WASI_PREOPENS_ENV, WASI_WASM_URL_ENV } from './wasi-channel-env.ts';
import { Wasi, WasiExit } from './wasi.ts';

// Channel env keys live in their own side-effect-free module so the parent-side
// `process-handle` can read them WITHOUT pulling this side-effectful entry in.
// Re-exported here for the subpath consumers (the wasi worker bundle + tests).
export { WASI_PREOPENS_ENV, WASI_WASM_URL_ENV };

/**
 * Minimal process surface the WASI runner reads inside the worker. Built
 * locally from the kernel's {@link KernelProcessSpec} (ADR-0039), since the
 * kernel no longer installs a Node-shape `process` global.
 */
interface WasiProcess {
  argv: readonly string[];
  env: Record<string, string>;
  cwd(): string;
  stdout: { write(chunk: string | Uint8Array): boolean };
  stderr: { write(chunk: string | Uint8Array): boolean };
  exit(code?: number): never;
}

const STDIO_ENCODER = new TextEncoder();

function makeStdioWriter(port: MessagePort): { write(chunk: string | Uint8Array): boolean } {
  return {
    write(chunk) {
      const bytes = typeof chunk === 'string' ? STDIO_ENCODER.encode(chunk) : chunk;
      // Transfer only the buffer we own (from TextEncoder). A pre-existing
      // Uint8Array may share its backing buffer with the caller — copy instead.
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

/**
 * Build the worker-local {@link WasiProcess} from the kernel-published
 * {@link KernelProcessSpec}. `exit(N)` throws a `RIFTY_PROCESS_EXIT`-shaped
 * error that the kernel's worker bootstrap maps to the worker exit code.
 */
function buildWasiProcess(): WasiProcess {
  const spec = readKernelProcessSpec();
  if (spec === null) {
    throw new Error(
      'runtime-wasi/worker-entry: KernelProcessSpec is missing — this module must be loaded by the kernel-side worker bootstrap (which publishes the spec on init).',
    );
  }
  // Copy: spec.env is `Readonly`, but the WASI run needs a mutable record
  // detached from the kernel's snapshot.
  const env: Record<string, string> = { ...spec.env };
  return {
    argv: spec.argv,
    env,
    cwd: () => spec.cwd,
    stdout: makeStdioWriter(spec.stdio.stdout),
    stderr: makeStdioWriter(spec.stdio.stderr),
    exit: (code = 0): never => {
      throw Object.assign(new Error(`process.exit(${code})`), {
        code: 'RIFTY_PROCESS_EXIT',
        exitCode: code,
      });
    },
  };
}

/**
 * Run a single WASI guest end-to-end on the given `process` shim. Reads the
 * WASM URL + preopens from `proc.env`, fetches and instantiates the module,
 * pipes stdio through `proc.stdout` / `proc.stderr`, and propagates the
 * guest's exit code via `proc.exit(code)` when non-zero.
 *
 * Exported so tests can drive the WASI run independently of a real Worker
 * realm — see `process-handle.test.ts`.
 */
export async function runWasiInWorker(proc: WasiProcess): Promise<void> {
  const wasmUrl = proc.env[WASI_WASM_URL_ENV];
  if (typeof wasmUrl !== 'string' || wasmUrl.length === 0) {
    throw new Error(
      `runtime-wasi/worker-entry: ${WASI_WASM_URL_ENV} is missing — createWasiProcess must thread the WASM URL through env.`,
    );
  }

  const preopens = parsePreopens(proc.env[WASI_PREOPENS_ENV]);
  const guestEnv = stripChannelKeys(proc.env);
  const guestArgs = proc.argv.slice();

  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(
      `runtime-wasi/worker-entry: fetch(${wasmUrl}) → ${response.status} ${response.statusText}`,
    );
  }
  const wasmBytes = await response.arrayBuffer();

  const wasi = new Wasi({
    args: guestArgs,
    env: guestEnv,
    preopens,
    stdout: (chunk: string) => {
      proc.stdout.write(chunk);
    },
    stderr: (chunk: string) => {
      proc.stderr.write(chunk);
    },
  });

  const { instance } = await WebAssembly.instantiate(wasmBytes, wasi.imports);

  let exitCode: number;
  try {
    exitCode = wasi.start(instance);
  } catch (err) {
    if (err instanceof WasiExit) {
      exitCode = err.exitCode;
    } else {
      // Surface the guest-side trap via stderr + non-zero exit, as a native
      // WASI runtime would.
      const message = err instanceof Error ? `${err.stack ?? err.message}\n` : `${String(err)}\n`;
      proc.stderr.write(message);
      exitCode = 1;
    }
  }

  if (exitCode !== 0) proc.exit(exitCode);
}

function parsePreopens(raw: string | undefined): Record<string, string> {
  if (raw === undefined || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    // Malformed env value: prefer an empty preopen set over failing the
    // whole process.
    return {};
  }
}

function stripChannelKeys(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === WASI_WASM_URL_ENV) continue;
    if (k === WASI_PREOPENS_ENV) continue;
    out[k] = v;
  }
  return out;
}

// In a `DedicatedWorkerGlobalScope`? Mirrors the heuristic in
// `@riftydev/kernel/src/worker-entry.ts`. When true, the kernel has already
// published {@link KernelProcessSpec} (before its `await import(entry.url)`).
declare const WorkerGlobalScope: { prototype: object } | undefined;
const isWorkerRealm =
  typeof WorkerGlobalScope !== 'undefined' &&
  typeof (globalThis as unknown as { postMessage?: unknown }).postMessage === 'function' &&
  typeof (globalThis as unknown as { window?: unknown }).window === 'undefined';

/**
 * Run the WASI guest IFF the kernel published a wasi-guest spec — one that
 * carries the {@link WASI_WASM_URL_ENV} channel key. Returns whether it ran.
 *
 * The gate is the WASM-URL signature, NOT merely "are we in a worker". This
 * module is re-exported from the package index (for the env-key constants +
 * {@link runWasiInWorker}), so `@riftydev/runtime-js`'s `node:wasi` builtin pulls
 * it into EVERY runtime-js worker's static import graph (owner shell, dev-server
 * child, the worker_threads pthread children Rolldown's WASI binding spawns, …).
 * Those graphs eval BEFORE the kernel `'init'` publishes any spec, so
 * `readKernelProcessSpec()` is null there; an unguarded `buildWasiProcess()`
 * threw "KernelProcessSpec is missing" and crashed the host worker on boot. The
 * genuine wasi-guest entry is the only realm where the spec is BOTH published
 * (the kernel `await import(entry.url)`s after publishing) AND carries the WASM
 * URL key. Exported so the gate is unit-testable without a real worker realm.
 */
export async function runWasiGuestEntryIfActive(): Promise<boolean> {
  const spec = readKernelProcessSpec();
  if (spec === null || typeof spec.env[WASI_WASM_URL_ENV] !== 'string') return false;
  await runWasiInWorker(buildWasiProcess());
  return true;
}

// Top-level await: in a worker realm, block until the guest exits so the kernel's
// bootstrap posts `{type:'exit', code}` when the module resolves. In a non-worker
// realm (tests) the side-effect is skipped; callers drive `runWasiInWorker`
// directly.
if (isWorkerRealm) {
  await runWasiGuestEntryIfActive();
}
