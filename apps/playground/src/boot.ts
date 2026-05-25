/**
 * Playground bootstrap helpers (ADR-0013).
 *
 * `bootstrap` wires the VFS backend (OPFS vs memory) BEFORE the UI mounts so
 * that the first edit, dev-mode tick, and `fs.readFileSync` see the right
 * surface. On `initBackend()` failure the app falls back to memory storage and
 * surfaces the cause via the returned descriptor — the UI can show a banner
 * but rendering never blocks (per task spec).
 *
 * The helpers are extracted from `main.tsx` so they can be unit-tested without
 * needing a DOM or Solid renderer in the test env. The thin Solid layer in
 * `main.tsx` only does: `await bootstrap()` → `render(() => <App init={...}/>)`.
 */
import { initBackend } from '@rifty/vfs';

export interface VfsBootDescriptor {
  readonly backend: 'opfs' | 'memory';
  /** Populated only on `initBackend()` failure (then `backend === 'memory'`). */
  readonly reason?: string;
}

export type InitBackendFn = () => Promise<'opfs' | 'memory'>;

/**
 * Resolve the VFS backend descriptor. Catches any failure from `initBackend()`,
 * falls back to memory, and surfaces the cause via `reason`. Never throws.
 *
 * @param impl - injection seam for tests; defaults to `@rifty/vfs/initBackend`.
 * @param logger - injection seam for the `console.warn` side effect (tests
 *   pass a spy to assert the fallback log without polluting stderr).
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

/**
 * Human-readable label for the storage badge in the header.
 * Pure function — easy to test, easy to localise later.
 */
export function backendLabel(descriptor: VfsBootDescriptor): string {
  if (descriptor.backend === 'opfs') return 'Storage: OPFS (persisted)';
  if (descriptor.reason) return 'Storage: in-memory (will not persist) — OPFS init failed';
  return 'Storage: in-memory (will not persist)';
}

/**
 * Map an unknown SW-registration rejection into the banner text shown when
 * `registerServiceWorker('/sw.js')` fails. Centralised so the `App` template
 * and tests share the same formatting.
 */
export function swErrorBannerMessage(reason: string): string {
  return `Preview unavailable — service worker registration failed: ${reason}. Reload to retry.`;
}

/**
 * Pull a stable reason string out of whatever the SW registration promise
 * rejects with. Mirrors the `.catch` arm in `App.onMount`.
 */
export function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
