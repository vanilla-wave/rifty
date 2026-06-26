/**
 * Fork-IPC contract between the workspace owner and the supervised dev-server
 * child (ADR-0150 P6b). The dev server runs in a child realm that owns listen();
 * these are the only owner↔child control frames (fs.* rides the sync-RPC ring;
 * stdio rides the kernel stdio ports). `stop` is not a frame — the owner kills
 * the child + awaits exit (Kill + re-listen; graceful drain is deferred,
 * backlog: shell/owner-graceful-drain-on-terminate).
 */

/** Child→owner: server is listening on `port` (resolves the controller boot). */
export interface DevReadyMessage {
  readonly type: 'rifty:dev-ready';
  readonly port: number;
}
/** Child→owner: vite preview is listening on `port` (adds the production preview slot). */
export interface PreviewReadyMessage {
  readonly type: 'rifty:preview-ready';
  readonly port: number;
}
/** Child→owner: boot failed (rejects the controller boot → recoverable). */
export interface DevErrorMessage {
  readonly type: 'rifty:dev-error';
  readonly message: string;
}
/** Child→owner: request the owner re-publish its snapshot (owner store changed — seed/install). */
export interface DevSnapshotMessage {
  readonly type: 'rifty:dev-snapshot';
}
export type DevServerChildMessage =
  | DevReadyMessage
  | PreviewReadyMessage
  | DevErrorMessage
  | DevSnapshotMessage;

/** Owner→child: an editor write — forward to the running server's HMR. */
export interface DevFileChangedMessage {
  readonly type: 'rifty:dev-file-changed';
  readonly path: string;
}
export type DevServerOwnerMessage = DevFileChangedMessage;

export function isDevServerChildMessage(m: unknown): m is DevServerChildMessage {
  if (!m || typeof m !== 'object') return false;
  const c = m as { type?: unknown; port?: unknown; message?: unknown };
  // ready carries the listening port — reject NaN/float (would resolve boot LIVE
  // on `/preview/NaN/`). error keeps a plain string check: an error frame MUST
  // reject boot even with a thin message, else dropping it would hang the boot.
  if (c.type === 'rifty:dev-ready') return Number.isInteger(c.port);
  if (c.type === 'rifty:preview-ready') return Number.isInteger(c.port);
  if (c.type === 'rifty:dev-error') return typeof c.message === 'string';
  return c.type === 'rifty:dev-snapshot';
}

export function isDevServerOwnerMessage(m: unknown): m is DevServerOwnerMessage {
  if (!m || typeof m !== 'object') return false;
  const c = m as { type?: unknown; path?: unknown };
  return c.type === 'rifty:dev-file-changed' && typeof c.path === 'string';
}
