/**
 * Pure open-classification for the editor host (ADR-0148 single-store-owner).
 *
 * Solid-free so the read-only-vs-editable decision is unit-testable: a
 * just-seeded PROJECT file must open EDITABLE even when its owner write has not
 * yet been reflected in the page's owner snapshot (the seed → owner publish →
 * page `snapshotFs.update` handshake is async). The previous code took a sync
 * snapshot miss as "view-only" and marked the path read-only, so a freshly
 * seeded preset file stayed read-only until close+reopen.
 *
 * Race-free: an `await-snapshot` miss is resolved by the NEXT snapshot frame the
 * page applies (an event, not a timer) — the same owner→page handshake the
 * explorer already rides. node_modules / over-cap / binary stay view-only.
 */

export type OpenClass =
  /** node_modules OR a present-but-over-cap file — async owner read-port, view-only. */
  | 'remote'
  /** Readable in the owner snapshot — sync read, editable (or binary → view-only). */
  | 'sync'
  /**
   * Non-node_modules path absent from the snapshot: a seeded/owner-written
   * project file racing the publish. Wait for the next snapshot frame and retry
   * — do NOT classify view-only (the bug). View-only fallback only once no more
   * frames can arrive (no snapshot source) — then it is genuinely owner-only.
   */
  | 'await-snapshot';

export interface OpenContext {
  /** Path is under a `node_modules` segment. */
  readonly isNodeModules: boolean;
  /** Path exists as a file in the snapshot tree (may be over-cap → no bytes). */
  readonly present: boolean;
  /** Sync read off the owner snapshot returned bytes (present + content inlined). */
  readonly readable: boolean;
  /** An async owner read-port (node_modules / over-cap) is wired. */
  readonly hasRemotePort: boolean;
}

/**
 * Decide how to open `path`. The caller does the IO; this only routes.
 *
 * - node_modules (remote port) → `'remote'`
 * - readable in snapshot → `'sync'`
 * - present but over-cap (no inlined bytes, remote port) → `'remote'` (view-only,
 *   unchanged) — distinct from a racing seed, which is absent, not present
 * - absent + non-node_modules → `'await-snapshot'` (retry on the next frame),
 *   regardless of `hasRemotePort` — a seeded project file is editable, not view-only.
 */
export function classifyOpen(_path: string, ctx: OpenContext): OpenClass {
  if (ctx.isNodeModules && ctx.hasRemotePort) return 'remote';
  if (ctx.readable) return 'sync';
  if (ctx.present && ctx.hasRemotePort) return 'remote';
  return 'await-snapshot';
}
