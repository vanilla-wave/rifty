/**
 * Kernel-side adapter that turns a WASI run into a kernel `ProcessHandle`
 * (ADR 0038). Funnels through `globalProcessManager.spawnWorker` so a WASI
 * guest gets the same PID space, stdio `MessagePort` shape, exit lifecycle,
 * and `kill()` semantics as a `node`-backed worker child — what the M8
 * `child_process.spawn('esbuild.wasm', ...)` site will rely on.
 *
 * Not a replacement for `Wasi` / `runWasi`: those stay the same-realm
 * unit-test surface for the WASI syscall layer; this adapter is for when the
 * kernel wants the Worker realm + binary-stdio lifecycle.
 *
 * Dispatch wiring (`child_process.spawn(argv[0])` choosing this adapter for
 * `.wasm` argv0s) is out of scope — see ADR 0038 "Out of scope".
 */

import { type ProcessHandle, type SpawnWorkerSpec, globalProcessManager } from '@riftydev/kernel';
// Channel keys only — NOT from `./worker-entry.ts`, whose top-level await runs
// the WASI guest. This keeps the index (which re-exports `process-handle`) off
// the side-effectful entry, so `node:wasi` never drags it into a worker graph.
import { WASI_PREOPENS_ENV, WASI_WASM_URL_ENV } from './wasi-channel-env.ts';

let wasiWorkerUrl: string | URL | null = null;

/**
 * Host-side setter for the runtime-wasi worker entry chunk URL. Must be a
 * different URL from `setKernelWorkerUrl`: the kernel worker bundle imports
 * `@riftydev/kernel/worker-entry` (init handler only), while the wasi worker
 * bundle imports `@riftydev/runtime-wasi/worker-entry` whose top-level await
 * runs the WASI guest. Sharing one bundle would fire that top-level await at
 * module load (before `init` arrives) and crash on a missing
 * `globalThis.process`. Call once at host boot, idempotent.
 */
export function setWasiWorkerUrl(url: string | URL): void {
  wasiWorkerUrl = url;
}

/** Read the configured wasi-worker chunk URL, or `null` if unwired. */
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
   * WASM module source. `BufferSource` is wrapped in a Blob URL so the
   * spawned Worker can fetch it; `URL` / `string` is forwarded verbatim
   * (what M8 toolchains use to point at a vendored `esbuild.wasm` asset URL).
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
 * Internal `Spawner` shape so tests can substitute a stub without leaning on
 * `@riftydev/kernel`'s test hooks (intentionally not part of its public API).
 */
type Spawner = (command: string, spec: SpawnWorkerSpec, ppid: number) => ProcessHandle;

let spawnerForTests: Spawner | null = null;

/**
 * Test-only: substitute the underlying `globalProcessManager.spawnWorker`
 * call, to assert the spawn spec without a real Worker realm. Not exported
 * from `./index.ts`; only `process-handle.test.ts` reaches in via relative path.
 */
export function __setSpawnerForTests(spawn: Spawner | null): void {
  spawnerForTests = spawn;
}

/**
 * Spawn a WASI guest as a kernel process. Returns a `WorkerProcessHandle`
 * (i.e. `handle.kind === 'worker'`, with binary stdio `MessagePort`s on
 * `handle.ports`). Callers read stdio through the kernel handle's
 * `stdout()` / `stderr()` accessors.
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

  // The kernel boot Worker (`kernelWorkerUrl`) does `await import(entry.url)`
  // after installing the process shim; the wasi-entry's top-level await then
  // runs the guest using that shim. The two URLs must be distinct chunks (see
  // setWasiWorkerUrl) or auto-install fires before `globalThis.process` exists.
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
 * a `blob:` URL (Node 19+ and every browser support `URL.createObjectURL` +
 * `fetch(blob:)`). `URL` / `string` is normalised to its string form.
 */
function resolveWasmUrl(wasm: WasiProcessOpts['wasm']): string {
  if (typeof wasm === 'string') return wasm;
  if (wasm instanceof URL) return wasm.toString();
  // Blob URL lifetime = the spawning realm's; revoke is the caller's job if
  // they care about memory churn (M8 toolchains do one spawn per build).
  const blob = new Blob([wasm as BufferSource], { type: 'application/wasm' });
  return URL.createObjectURL(blob);
}

/**
 * Read the URL configured via {@link setWasiWorkerUrl}. Throws if unset —
 * mirrors the kernel's loud-failure behaviour from `spawnKernelWorker`.
 */
function getWasiWorkerEntryUrl(): string {
  if (wasiWorkerUrl === null) {
    throw new Error(
      'runtime-wasi.createWasiProcess: wasi worker URL is not set — call setWasiWorkerUrl(url) at host boot (and a distinct setKernelWorkerUrl(url) for the kernel boot chunk).',
    );
  }
  return typeof wasiWorkerUrl === 'string' ? wasiWorkerUrl : wasiWorkerUrl.toString();
}
