import {
  type RuntimeController,
  type RuntimeFs,
  type RuntimeOptions,
  spawnRuntime,
} from '@riftydev/runtime-js';
import { detectCapabilities } from '@riftydev/runtime-js/env/capabilities';
import { registerServiceWorker } from '@riftydev/service-worker';
import { initBackend } from '@riftydev/vfs';
import type { CapabilityCheck } from './capabilities.ts';

/** Which VFS backend booted. */
export type VfsBackend = 'opfs' | 'memory';

export interface VfsBootInfo {
  readonly backend: VfsBackend;
  /** Set only when OPFS init failed and the sandbox fell back to memory. */
  readonly reason?: string;
}

export interface CreateSandboxOptions {
  /**
   * URL of the `@riftydev/runtime-js` worker entry, resolved by YOUR bundler — the
   * one host-specific bit the façade cannot hide (EPIC E owns the template that
   * produces it). With Vite/webpack:
   * `new URL('@riftydev/runtime-js/worker', import.meta.url)`.
   */
  readonly workerUrl: string | URL;
  /**
   * Service-worker script URL used for preview/HMR routing. Default `/sw.js`.
   * Must be same-origin and registrable at a scope covering the preview routes.
   */
  readonly serviceWorkerUrl?: string;
  /** Skip service-worker registration (eval-only / headless use). Default false. */
  readonly skipServiceWorker?: boolean;
  /**
   * Throw when the realm is not cross-origin isolated (no SAB/Atomics, so no
   * sync IPC). Default true — the runtime cannot function without it (ADR-0002,
   * D-001). Set false to boot anyway (e.g. to inspect {@link Sandbox.capabilities}).
   */
  readonly requireCrossOriginIsolation?: boolean;
  /** Sink for the non-fatal fallback warnings. Default `console`. */
  readonly logger?: Pick<Console, 'warn' | 'error'>;
}

export interface Sandbox {
  /** Framework-agnostic JS runtime controller (`eval` / `reset` / `on` / …). */
  readonly runtime: RuntimeController;
  /** Worker-owned filesystem RPC surface for AI-agent style file IO. */
  readonly fs: RuntimeFs;
  /** Which VFS backend booted, and why if it fell back to memory. */
  readonly vfs: VfsBootInfo;
  /** Capability probe taken at boot. */
  readonly capabilities: CapabilityCheck;
  /** Set only when service-worker registration failed (preview unavailable, rest works). */
  readonly swError?: string;
  /**
   * Tear down the runtime worker. Realm-global state (the VFS backend and the
   * registered service worker) is intentionally left in place — see the
   * realm-scoped note on {@link createSandbox}.
   */
  dispose(): void;
}

/**
 * Test injection seam — mirrors the playground `boot.ts` pattern so the boot
 * pipeline is unit-testable without a DOM, Worker, or OPFS. Every field defaults
 * to the real implementation.
 */
export interface SandboxDeps {
  readonly detect?: () => CapabilityCheck;
  readonly initVfs?: () => Promise<VfsBackend>;
  readonly registerSw?: (url: string) => Promise<unknown>;
  readonly spawn?: (opts: RuntimeOptions) => RuntimeController;
  readonly logger?: Pick<Console, 'warn' | 'error'>;
}

export const COI_REQUIRED_MESSAGE =
  'rifty: cross-origin isolation is not active — SharedArrayBuffer and Atomics ' +
  'are unavailable, so sync IPC cannot start. Serve with COOP/COEP headers ' +
  '(Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: ' +
  'require-corp or credentialless), or pass requireCrossOriginIsolation: false ' +
  'to bypass this guard.';

/**
 * Boot a rifty sandbox in one call (EPIC B / B2): probe capabilities →
 * (optionally) assert cross-origin isolation → bring up the VFS backend (OPFS,
 * falling back to memory) → (optionally) register the preview service worker →
 * spawn the JS runtime worker. Framework-free: no DOM, no Solid — it returns a
 * live {@link RuntimeController}, the same one the playground drives.
 *
 * Boot order is load-bearing and matches the playground: COI must hold before
 * any SAB-backed IPC, and the VFS surface must exist before the first `fs.*`.
 * Degradations are non-fatal and surfaced on the result — VFS init failure
 * falls back to memory (`vfs.reason`), SW registration failure sets `swError`.
 *
 * **Realm-scoped (v0.1).** The VFS backend and the service worker are
 * realm-global singletons (ADR-0070 D4), so call this **once per page / worker
 * realm**. A second `createSandbox()` in the same realm spawns a fresh runtime
 * worker but shares the same filesystem and SW registration — the two `Sandbox`
 * objects are not isolated at the VFS layer, and {@link Sandbox.dispose} tears
 * down only the runtime worker (the VFS and SW persist). Register your
 * `sandbox.runtime.on(...)` handler immediately after this resolves so you don't
 * miss early `ready` / `stdout` events (the controller does not replay them).
 *
 * @param options - sandbox configuration; `workerUrl` is required.
 * @param deps - test-only injection seam; leave empty in production.
 */
export async function createSandbox(
  options: CreateSandboxOptions,
  deps: SandboxDeps = {},
): Promise<Sandbox> {
  const logger = deps.logger ?? options.logger ?? console;
  const detect = deps.detect ?? detectCapabilities;
  const capabilities = detect();

  if (
    (options.requireCrossOriginIsolation ?? true) &&
    !capabilities.capabilities.crossOriginIsolated
  ) {
    throw new Error(COI_REQUIRED_MESSAGE);
  }

  const vfs = await bootVfs(deps.initVfs ?? initBackend, logger);

  let swError: string | undefined;
  if (!options.skipServiceWorker) {
    const registerSw = deps.registerSw ?? ((url: string) => registerServiceWorker(url));
    try {
      await registerSw(options.serviceWorkerUrl ?? '/sw.js');
    } catch (err) {
      swError = reasonOf(err);
      logger.warn(`[rifty] service worker registration failed: ${swError}`);
    }
  }

  const spawn = deps.spawn ?? spawnRuntime;
  const runtime = spawn({ workerUrl: String(options.workerUrl) });

  return {
    runtime,
    fs: runtime.fs,
    vfs,
    capabilities,
    ...(swError === undefined ? {} : { swError }),
    dispose() {
      runtime.dispose();
    },
  };
}

/** Resolve the VFS backend, catching init failure and degrading to memory. Never throws. */
async function bootVfs(
  initVfs: () => Promise<VfsBackend>,
  logger: Pick<Console, 'warn'>,
): Promise<VfsBootInfo> {
  try {
    return { backend: await initVfs() };
  } catch (err) {
    const reason = reasonOf(err);
    logger.warn(`[rifty] VFS backend init failed, falling back to memory: ${reason}`);
    return { backend: 'memory', reason };
  }
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
