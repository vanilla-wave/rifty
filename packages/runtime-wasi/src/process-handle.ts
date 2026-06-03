/**
 * Kernel-side adapter that turns a WASI run into a kernel `ProcessHandle`
 * (ADR 0038). Funnels through `globalProcessManager.spawnWorker` so a
 * WASI guest gets the same PID space, stdio `MessagePort` shape, exit
 * lifecycle, and `kill()` semantics as a `node`-backed worker child —
 * which is what the M8 `child_process.spawn('esbuild.wasm', ...)` site
 * will eventually rely on.
 *
 * No replacement for `Wasi` / `runWasi`. Those stay as the same-realm
 * unit-test surface for the WASI syscall layer; this adapter is what the
 * kernel reaches for when it wants the Worker realm + binary-stdio
 * lifecycle.
 *
 * Dispatch wiring (`child_process.spawn(argv[0])` choosing this adapter
 * for `.wasm` argv0s) is out of scope here — see ADR 0038 "Out of
 * scope". Today the only caller is the test in this directory.
 */

import { type ProcessHandle, type SpawnWorkerSpec, globalProcessManager } from '@riftydev/kernel';
import { WASI_PREOPENS_ENV, WASI_WASM_URL_ENV } from './worker-entry.ts';

let wasiWorkerUrl: string | URL | null = null;

/**
 * Host-side setter: tell the adapter where to find the runtime-wasi worker
 * entry chunk. This is a different URL from the kernel worker URL
 * (`setKernelWorkerUrl`): the kernel worker bundle imports
 * `@riftydev/kernel/worker-entry` (init handler only), and the wasi worker
 * bundle imports `@riftydev/runtime-wasi/worker-entry` whose top-level
 * await runs the WASI guest. The two URLs MUST be distinct chunks —
 * sharing one bundle would fire `runtime-wasi/worker-entry`'s top-level
 * await at module load (before `init` arrives) and crash on a missing
 * `globalThis.process`.
 *
 * Call once at host boot, idempotent.
 */
export function setWasiWorkerUrl(url: string | URL): void {
  wasiWorkerUrl = url;
}

/**
 * Read the configured wasi-worker chunk URL. Returns `null` if the host
 * hasn't wired it yet.
 */
export function getWasiWorkerUrl(): string | URL | null {
  return wasiWorkerUrl;
}

/** Test-only: forget the configured URL. Not exported from `./index.ts`. */
export function __clearWasiWorkerUrlForTests(): void {
  wasiWorkerUrl = null;
}

/**
 * Spawn input for {@link createWasiProcess}. Mirrors the runtime-side
 * `WasiOptions` from `./wasi.ts` plus a `wasm` source descriptor.
 */
export interface WasiProcessOpts {
  /**
   * WASM module source. `ArrayBuffer` (or any `BufferSource`) is wrapped in
   * a Blob URL so the spawned Worker can fetch it; `URL` / `string` is
   * forwarded verbatim, which is what M8 toolchains will use to point at
   * a vendored `esbuild.wasm` asset URL.
   */
  readonly wasm: BufferSource | URL | string;
  /** Arguments after the implicit `argv[0]` ('wasi-guest'). */
  readonly args?: readonly string[];
  /** Environment variables visible to the guest. */
  readonly env?: Readonly<Record<string, string>>;
  /** Preopens (`Record<guestPath, hostPath>`) — forwarded to {@link Wasi}. */
  readonly preopens?: Readonly<Record<string, string>>;
  /** Working directory for the spawned process (ADR-0019). */
  readonly cwd?: string;
  /** Parent PID for the spawned process. Defaults to 1 (main worker). */
  readonly ppid?: number;
}

/**
 * Internal `Spawner` shape so tests can substitute a stub without leaning
 * on `@riftydev/kernel`'s test hooks (which are intentionally not part of
 * the kernel's public surface).
 */
type Spawner = (command: string, spec: SpawnWorkerSpec, ppid: number) => ProcessHandle;

let spawnerForTests: Spawner | null = null;

/**
 * Test-only: substitute the underlying `globalProcessManager.spawnWorker`
 * call. Tests use this to assert the spawn spec without spinning up a real
 * Worker realm. Not exported from `./index.ts`; only `process-handle.test.ts`
 * reaches in via the relative path.
 */
export function __setSpawnerForTests(spawn: Spawner | null): void {
  spawnerForTests = spawn;
}

/**
 * Spawn a WASI guest as a kernel process. Returns a `WorkerProcessHandle`
 * (i.e. `handle.kind === 'worker'`, with binary stdio `MessagePort`s on
 * `handle.ports`). Callers wire stdio through any kernel-aware adapter —
 * notably `wireWorkerStdio` from
 * `@riftydev/runtime-js/src/builtins/child_process-worker.ts`.
 */
export function createWasiProcess(opts: WasiProcessOpts): ProcessHandle {
  const wasmUrl = resolveWasmUrl(opts.wasm);
  const channelEnv: Record<string, string> = {
    [WASI_WASM_URL_ENV]: wasmUrl,
  };
  if (opts.preopens !== undefined) {
    channelEnv[WASI_PREOPENS_ENV] = JSON.stringify(opts.preopens);
  }
  const env: Record<string, string> = {
    ...(opts.env ?? {}),
    ...channelEnv,
  };
  const userArgs = opts.args ?? [];
  const argv: readonly string[] = ['wasi-guest', ...userArgs];

  // `entry.url` is the wasi-worker chunk URL. The kernel-side bootstrap
  // (boot Worker = `kernelWorkerUrl`) does `await import(entry.url)` after
  // installing the process shim; THIS module's top-level await then runs
  // the WASI guest using that shim. The two URLs must be distinct chunks
  // (see {@link setWasiWorkerUrl} doc) — otherwise the wasi-entry's
  // auto-install fires at boot, before `globalThis.process` exists.
  const spec: SpawnWorkerSpec = {
    entry: { kind: 'url', url: getWasiWorkerEntryUrl() },
    argv,
    env,
    cwd: opts.cwd ?? '/workspace',
  };

  const command = userArgs[0] ?? 'wasi-guest';
  const ppid = opts.ppid ?? 1;
  const spawn: Spawner =
    spawnerForTests ?? ((cmd, s, p) => globalProcessManager.spawnWorker(cmd, s, p, { cwd: s.cwd }));
  return spawn(command, spec, ppid);
}

/**
 * Resolve any `wasm` input to a fetchable URL string. `BufferSource` becomes
 * a `blob:` URL (Node 19+ and every browser support `URL.createObjectURL`
 * + `fetch(blob:)`). `URL` / `string` is normalised to its string form.
 */
function resolveWasmUrl(wasm: WasiProcessOpts['wasm']): string {
  if (typeof wasm === 'string') return wasm;
  if (wasm instanceof URL) return wasm.toString();
  // BufferSource = ArrayBuffer | ArrayBufferView. `Blob` accepts both via
  // the `BlobPart` union. The created URL's lifetime is the lifetime of
  // the spawning realm; revoke is the caller's job if they care about
  // memory churn (M8 toolchains do one spawn per build, so noise is
  // bounded).
  const blob = new Blob([wasm as BufferSource], { type: 'application/wasm' });
  return URL.createObjectURL(blob);
}

/**
 * Read the wasi-worker chunk URL configured via {@link setWasiWorkerUrl}.
 * Throws if unset — mirrors the kernel's loud-failure behaviour from
 * `spawnKernelWorker`.
 */
function getWasiWorkerEntryUrl(): string {
  if (wasiWorkerUrl === null) {
    throw new Error(
      'runtime-wasi.createWasiProcess: wasi worker URL is not set — call setWasiWorkerUrl(url) at host boot (and a distinct setKernelWorkerUrl(url) for the kernel boot chunk).',
    );
  }
  return typeof wasiWorkerUrl === 'string' ? wasiWorkerUrl : wasiWorkerUrl.toString();
}
