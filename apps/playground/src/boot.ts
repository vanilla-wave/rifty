/**
 * Playground bootstrap helpers (ADR-0002, ADR-0013).
 *
 * Wires the VFS backend (OPFS vs memory) BEFORE the UI mounts so the first
 * edit, dev-mode tick, and `fs.readFileSync` see the right surface. Extracted
 * from `main.tsx` so they can be unit-tested without a DOM or Solid renderer.
 */
import { registerServiceWorker } from '@riftydev/service-worker';
import { initBackend } from '@riftydev/vfs';

export interface VfsBootDescriptor {
  readonly backend: 'opfs' | 'memory';
  /** Populated only on `initBackend()` failure (then `backend === 'memory'`). */
  readonly reason?: string;
}

export type InitBackendFn = () => Promise<'opfs' | 'memory'>;

/**
 * Resolve the VFS backend descriptor. On `initBackend()` failure, falls back to
 * memory and surfaces the cause via `reason`. Never throws.
 *
 * @param impl - injection seam for tests; defaults to `@riftydev/vfs/initBackend`.
 * @param logger - injection seam for the `console.warn` side effect (tests pass a spy
 *   to assert the fallback log without polluting stderr).
 */
export async function bootstrap(
  impl: InitBackendFn = initBackend,
  logger: Pick<Console, 'warn'> = console,
): Promise<VfsBootDescriptor> {
  try {
    const backend = await impl();
    return { backend };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(`[rifty] VFS backend init failed, falling back to memory: ${reason}`);
    return { backend: 'memory', reason };
  }
}

/** Human-readable label for the storage badge in the header. */
export function backendLabel(descriptor: VfsBootDescriptor): string {
  if (descriptor.backend === 'opfs') return 'Storage: OPFS (persisted)';
  if (descriptor.reason) return 'Storage: in-memory (will not persist) — OPFS init failed';
  return 'Storage: in-memory (will not persist)';
}

/**
 * Banner text shown when `registerServiceWorker('/sw.js')` fails. Centralised so
 * the `App` template and tests share the same formatting.
 */
export function swErrorBannerMessage(reason: string): string {
  return `Preview unavailable — service worker registration failed: ${reason}. Reload to retry.`;
}

/** Pull a stable reason string out of whatever the SW registration rejects with. */
export function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Message rendered into the page when cross-origin isolation is off.
 * Exported so tests can assert the exact copy without re-implementing it.
 */
export const COI_FATAL_MESSAGE =
  'Cross-origin isolation is not active. Sync IPC and SharedArrayBuffer are unavailable. ' +
  'Check COOP/COEP headers (Cross-Origin-Opener-Policy: same-origin, ' +
  'Cross-Origin-Embedder-Policy: credentialless).';

/**
 * Result of {@link bootstrapPlayground} — handed to `App` as a single bundle so
 * the component never reaches back into module-global state for boot data.
 */
export interface BootResult {
  /** VFS backend descriptor from {@link bootstrap}. Never throws upstream. */
  readonly vfsBoot: VfsBootDescriptor;
  /**
   * Populated only when `registerServiceWorker()` rejected. The App renders a
   * banner via {@link swErrorBannerMessage}; the rest of the REPL keeps running
   * (the SW only matters for the preview iframe path).
   */
  readonly swError?: string;
}

/**
 * Read globalThis.crossOriginIsolated. Carved out so
 * {@link assertCrossOriginIsolated} can be unit-tested without monkey-patching
 * `globalThis`.
 */
export function isCrossOriginIsolated(): boolean {
  return Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated);
}

/** Injection seam for {@link assertCrossOriginIsolated} — defaults are real DOM. */
export interface CoiGuardDeps {
  readonly check?: () => boolean;
  /** Side-effecting DOM hook — renders the fatal message visibly. */
  readonly renderFatal?: (message: string) => void;
  readonly logger?: Pick<Console, 'error'>;
}

/**
 * Assert cross-origin isolation (ADR-0002 / D-001). When NOT isolated, paints
 * {@link COI_FATAL_MESSAGE} into `document.body`, logs, and throws — so
 * downstream SAB consumers never start and the page shows a clear cause instead
 * of a blank screen. Idempotent on an isolated realm.
 */
export function assertCrossOriginIsolated(deps?: CoiGuardDeps): void {
  const check = deps?.check ?? isCrossOriginIsolated;
  if (check()) return;
  const logger = deps?.logger ?? console;
  const renderFatal = deps?.renderFatal ?? defaultRenderFatal;
  logger.error(COI_FATAL_MESSAGE);
  renderFatal(COI_FATAL_MESSAGE);
  throw new Error(COI_FATAL_MESSAGE);
}

function defaultRenderFatal(message: string): void {
  // No DOM (Node/SSR/accidental import): skip to avoid a ReferenceError on `document`; the throw alone suffices.
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return;
  const pre = doc.createElement('pre');
  pre.setAttribute('data-banner', 'coi-fatal');
  pre.setAttribute('role', 'alert');
  pre.style.cssText =
    'margin:0;padding:24px;background:#3b1f1f;color:#fecaca;' +
    'font-family:system-ui,sans-serif;font-size:14px;white-space:pre-wrap;' +
    'min-height:100vh;box-sizing:border-box;';
  pre.textContent = message;
  if (doc.body) {
    doc.body.innerHTML = '';
    doc.body.appendChild(pre);
  } else {
    doc.documentElement.appendChild(pre);
  }
}

/** Injection seam for {@link bootstrapPlayground} — tests pass spies for each step. */
export interface BootstrapPlaygroundDeps {
  readonly assertCoi?: (deps?: CoiGuardDeps) => void;
  readonly initVfs?: InitBackendFn;
  readonly registerSw?: (scriptUrl: string) => Promise<unknown>;
  readonly logger?: Pick<Console, 'warn' | 'error'>;
}

/**
 * Top-level bootstrap pipeline awaited by `main.tsx` before render. Throws
 * synchronously on COI failure (fatal); resolves with a {@link BootResult}
 * otherwise. VFS init failure degrades to memory; SW registration failure is
 * surfaced via `swError` for the inline banner.
 */
export async function bootstrapPlayground(deps: BootstrapPlaygroundDeps = {}): Promise<BootResult> {
  const logger = deps.logger ?? console;
  (deps.assertCoi ?? assertCrossOriginIsolated)();
  const vfsBoot = await bootstrap(deps.initVfs, logger);
  const swRegister = deps.registerSw ?? ((url: string) => registerServiceWorker(url));
  try {
    await swRegister('/sw.js');
    return { vfsBoot };
  } catch (err) {
    const swError = reasonOf(err);
    logger.warn(`[rifty] service worker registration failed: ${swError}`);
    return { vfsBoot, swError };
  }
}
