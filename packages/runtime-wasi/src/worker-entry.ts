/// <reference lib="webworker" />

/**
 * Runtime-side worker entry for {@link createWasiProcess} (ADR 0038).
 *
 * Loaded by the kernel-side bootstrap (`@rifty/kernel/worker-entry`) via
 * the `WorkerEntryDescriptor.kind === 'url'` path: the kernel spawns a
 * Worker at `kernelWorkerUrl` (host-registered via `setKernelWorkerUrl`),
 * that Worker's `'init'` handler installs the `process` shim plus stdio
 * ports, then `await import(spec.entry.url)` evaluates THIS module. The
 * entry-URL bundle MUST be different from the kernel-worker boot bundle —
 * the module's auto-install side-effect uses `globalThis.process` and
 * would crash if loaded before the kernel installs the shim. The host
 * registers the wasi-entry chunk via {@link setWasiWorkerUrl}; the
 * adapter ({@link createWasiProcess}) puts that URL in `spec.entry.url`.
 *
 * The module's top-level `await` blocks until the WASM guest has
 * finished, so the kernel observes "entry script done" and posts the
 * standard `{type:'exit', code}` exactly when the guest exits — no new
 * wire protocol.
 *
 * Inputs travel through the kernel's existing init surface:
 *   - `process.env.__RIFTY_WASI_WASM_URL` — fetchable URL of the WASM
 *     module. For `createWasiProcess({ wasm: ArrayBuffer })` callers,
 *     the adapter turns the bytes into a `blob:` URL with
 *     `URL.createObjectURL`. For `createWasiProcess({ wasm: URL })`,
 *     the URL is passed through verbatim.
 *   - `process.env.__RIFTY_WASI_PREOPENS` — JSON-encoded preopens map
 *     (`Record<guestPath, hostPath>`), forwarded to `Wasi`'s constructor.
 *   - `process.argv` — `['wasi-guest', ...userArgs]`. WASI's `args_get`
 *     consumes this directly via the {@link Wasi} ctor's `args` option.
 *   - `process.env` — full env minus the two `__RIFTY_WASI_*` channel
 *     keys, forwarded to the guest.
 *
 * Stdout / stderr from the guest go through `process.stdout.write` /
 * `process.stderr.write` — the kernel's `installProcessShim` already
 * pipes those into the parent's stdio `MessagePort`s as binary
 * `Uint8Array`s.
 *
 * Exit semantics:
 *   - guest calls `proc_exit(N)` → `Wasi.start()` returns `N` → if
 *     `N !== 0`, we call `process.exit(N)` so the kernel reports the
 *     right code; if `N === 0`, we let the module finish and the kernel
 *     reports 0.
 *   - guest throws an unrelated error → re-thrown at module top level;
 *     the kernel catches and writes the stack to stderr, then reports
 *     exit 1.
 */

import { Wasi, WasiExit } from './wasi.ts';

/** Env-key carrying the URL of the WASM module to fetch. */
export const WASI_WASM_URL_ENV = '__RIFTY_WASI_WASM_URL' as const;

/**
 * Env-key carrying the JSON-encoded preopens map. Optional; when absent the
 * guest gets no preopens (a typical M8 toolchain spawn would set it to
 * `{ '/': '/' }` so the guest's `/` aliases the host VFS root).
 */
export const WASI_PREOPENS_ENV = '__RIFTY_WASI_PREOPENS' as const;

/**
 * Subset of the kernel-installed `process` shim we read inside the worker.
 * Mirrors the structural contract from `@rifty/kernel/src/worker-entry.ts`'s
 * `installProcessShim`; we redeclare the shape here so this module doesn't
 * have to reach back into the kernel for a type.
 */
interface WasiProcess {
  argv: readonly string[];
  env: Record<string, string>;
  cwd(): string;
  stdout: { write(chunk: string | Uint8Array): boolean };
  stderr: { write(chunk: string | Uint8Array): boolean };
  exit(code?: number): never;
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
      // Surface the guest-side trap to the parent through stderr + non-zero
      // exit, matching what a native WASI runtime would do.
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
    // Malformed env value: prefer running the guest with no preopens over
    // failing the whole process. The guest will see an empty preopen set.
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

/**
 * Detection: are we in a `DedicatedWorkerGlobalScope`? Mirrors the heuristic
 * from `@rifty/kernel/src/worker-entry.ts`. When true, the kernel bootstrap
 * has already installed `globalThis.process` by the time this module's
 * top-level evaluation runs (the kernel does `installProcessShim(...)`
 * before `await import(entry.url)`).
 */
declare const WorkerGlobalScope: { prototype: object } | undefined;
const isWorkerRealm =
  typeof WorkerGlobalScope !== 'undefined' &&
  typeof (globalThis as unknown as { postMessage?: unknown }).postMessage === 'function' &&
  typeof (globalThis as unknown as { window?: unknown }).window === 'undefined';

// Top-level await: when loaded as a Worker entry by the kernel's
// `await import(entry.url)`, we block here until the WASI guest exits. The
// kernel's bootstrap awaits THIS module, sees it resolve, and posts the
// standard `{type:'exit', code}` to the parent. When imported in a
// non-worker realm (tests), we skip the side-effect; callers exercise
// `runWasiInWorker` directly.
if (isWorkerRealm) {
  const proc = (globalThis as unknown as { process?: WasiProcess }).process;
  if (proc === undefined) {
    throw new Error(
      'runtime-wasi/worker-entry: globalThis.process is missing — this module must be loaded ' +
        'by the kernel-side worker bootstrap (which installs the process shim).',
    );
  }
  await runWasiInWorker(proc);
}
