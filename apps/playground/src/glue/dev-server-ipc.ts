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
  readonly previewScope?: string;
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
/**
 * Child→owner: the FULL current listening-port set, posted on every net-registry
 * change AFTER `rifty:dev-ready` (the entry called `server.close()` /
 * re-listened). `ports: []` = nothing listening → the pill leaves 'running'.
 */
export interface DevPortsMessage {
  readonly type: 'rifty:dev-ports';
  readonly ports: number[];
  readonly previewScope?: string;
}
export type DevServerChildMessage =
  | DevReadyMessage
  | DevErrorMessage
  | DevSnapshotMessage
  | DevPortsMessage;

function optionalPreviewScope(c: { readonly previewScope?: unknown }): boolean {
  return c.previewScope === undefined || typeof c.previewScope === 'string';
}

export function isDevServerChildMessage(m: unknown): m is DevServerChildMessage {
  if (!m || typeof m !== 'object') return false;
  const c = m as {
    type?: unknown;
    port?: unknown;
    message?: unknown;
    previewScope?: unknown;
  };
  // ready carries the listening port — reject NaN/float (would resolve boot LIVE
  // on `/preview/NaN/`). error keeps a plain string check: an error frame MUST
  // reject boot even with a thin message, else dropping it would hang the boot.
  if (c.type === 'rifty:dev-ready') return Number.isInteger(c.port) && optionalPreviewScope(c);
  if (c.type === 'rifty:dev-error') return typeof c.message === 'string';
  if (c.type === 'rifty:dev-ports') {
    const ports = (m as { ports?: unknown }).ports;
    return (
      Array.isArray(ports) && ports.every((p) => Number.isInteger(p)) && optionalPreviewScope(c)
    );
  }
  return c.type === 'rifty:dev-snapshot';
}
