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

// Top-level await: under the kernel's `await import(entry.url)`, block until
// the guest exits so the kernel's bootstrap posts `{type:'exit', code}` when
// the module resolves. In a non-worker realm (tests), skip the side-effect;
// callers drive `runWasiInWorker` directly.
if (isWorkerRealm) {
  const proc = buildWasiProcess();
  await runWasiInWorker(proc);
}
