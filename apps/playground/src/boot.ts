/**
 * Playground bootstrap helpers (ADR-0002, ADR-0013).
 *
 * Wires the VFS backend (OPFS vs memory) BEFORE the UI mounts so the first
 * edit, dev-mode tick, and `fs.readFileSync` see the right surface. Extracted
 * from `main.tsx` so they can be unit-tested without a DOM or Solid renderer.
 */
import { registerServiceWorker } from '@riftydev/service-worker';
import { detectVfsBackend } from '@riftydev/vfs';
import { type PreconnectDocument, injectPreconnects } from './glue/preconnect.ts';
import { getRegistryProxyPrefix } from './glue/registry-fetch.ts';
import { getEddyBundleBaseUrl, getResolverUrl } from './glue/resolver-config.ts';
import { type StoragePersistenceStatus, probeStoragePersistence } from './glue/storage-status.ts';

export interface VfsBootDescriptor {
  readonly backend: 'opfs' | 'memory';
  /** Reserved for a backend-init failure cause; unused now the page installs no store. */
  readonly reason?: string;
}

export type DetectBackendFn = () => 'opfs' | 'memory';

/**
 * Resolve the storage-badge descriptor by DETECTING the backend the persistent
 * workspace owner will use (single store owner: exactly one realm owns the
 * authoritative VFS store; the page holds no authoritative fs). The PAGE
 * installs NO VFS store: the owner worker is the single store owner and runs
 * `initBackend()` itself, so this constructs nothing — it only reports what the
 * cross-origin-isolated owner realm will pick (OPFS when available, else memory).
 *
 * @param detect - injection seam for tests; defaults to `@riftydev/vfs/detectVfsBackend`.
 */
export async function bootstrap(
  detect: DetectBackendFn = detectVfsBackend,
): Promise<VfsBootDescriptor> {
  return { backend: detect() };
}

/** Human-readable label for the storage badge in the header. */
export function backendLabel(descriptor: VfsBootDescriptor): string {
  if (descriptor.backend === 'opfs') return 'Storage: OPFS';
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
  'Cross-Origin-Embedder-Policy: credentialless). If rifty is embedded in another app or ' +
  'iframe, the embedding page must also be cross-origin isolated and the iframe must include ' +
  'allow="cross-origin-isolated"; otherwise open rifty as a top-level page.';

/**
 * Result of {@link bootstrapPlayground} — handed to `App` as a single bundle so
 * the component never reaches back into module-global state for boot data.
 */
export interface BootResult {
  /** VFS backend descriptor from {@link bootstrap}. Never throws upstream. */
  readonly vfsBoot: VfsBootDescriptor;
  /** Browser storage persistence/quota probe. */
  readonly storage: StoragePersistenceStatus;
  /**
   * Populated only when `registerServiceWorker()` rejected. The App renders a
   * banner via {@link swErrorBannerMessage}; the rest of the playground keeps running
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
  readonly detectVfs?: DetectBackendFn;
  readonly probeStorage?: () => Promise<StoragePersistenceStatus>;
  readonly registerSw?: (scriptUrl: string) => Promise<unknown>;
  readonly injectPreconnects?: () => void;
  readonly logger?: Pick<Console, 'warn' | 'error'>;
}

/**
 * Preconnect to the configured registry + eddy origins (ADR-0195): DNS+TCP+TLS
 * warm during boot instead of serializing into the first install fetch.
 * Best-effort — a DOM-less realm or a throwing DOM never breaks boot.
 */
function injectDefaultPreconnects(): void {
  const doc = (globalThis as { document?: PreconnectDocument }).document;
  if (!doc) return;
  try {
    injectPreconnects(doc, [getRegistryProxyPrefix(), getResolverUrl(), getEddyBundleBaseUrl()]);
  } catch {
    // Purely an optimization — never fatal at boot.
  }
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
  (deps.injectPreconnects ?? injectDefaultPreconnects)();
  const vfsBoot = await bootstrap(deps.detectVfs);
  const storage = await (deps.probeStorage ?? (() => probeStoragePersistence()))();
  const swRegister = deps.registerSw ?? ((url: string) => registerServiceWorker(url));
  try {
    await swRegister('/sw.js');
    return { vfsBoot, storage };
  } catch (err) {
    const swError = reasonOf(err);
    logger.warn(`[rifty] service worker registration failed: ${swError}`);
    return { vfsBoot, storage, swError };
  }
}
