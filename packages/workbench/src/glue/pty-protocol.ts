// pty channel frame protocol (ADR-0146). Carried as kernel fork-IPC payload
// { type:'rifty:pty', frame } alongside rifty:vfs-write. Structured-clone-safe only.
export type PtyStream = 'stdout' | 'stderr';

export type PtyOpen = {
  type: 'pty:open';
  sid: string;
  /** Seed cwd for the session's shell (restored persisted terminal state, ADR-0146). */
  cwd?: string;
  /** Seed env for the session's shell (restored persisted terminal state, ADR-0146). */
  env?: Record<string, string>;
};
export type PtyExec = {
  type: 'pty:exec';
  sid: string;
  rid: string;
  line: string;
  cols: number;
  rows: number;
  isTTY: boolean;
};
export type PtyStdin = { type: 'pty:stdin'; sid: string; rid: string; data: Uint8Array };
export type PtyStdinEof = { type: 'pty:stdin-eof'; sid: string; rid: string };
export type PtySignal = { type: 'pty:signal'; sid: string; rid: string; signal: 'SIGINT' };
/** Live foreground terminal size update, correlated to one active run. */
export type PtyResize = {
  type: 'pty:resize';
  sid: string;
  rid: string;
  cols: number;
  rows: number;
};
export type PtyClose = { type: 'pty:close'; sid: string };

export type PtyReady = { type: 'pty:ready'; sid: string };
export type PtyChunk = {
  type: 'pty:chunk';
  sid: string;
  rid: string;
  stream: PtyStream;
  seq: number;
  data: Uint8Array;
};
export type PtyExit = {
  type: 'pty:exit';
  sid: string;
  rid: string;
  code: number;
  cwd: string;
  env: Record<string, string>;
  error?: string;
};

/** Co-resident dev-server lifecycle (ADR-0148, dev server runs inside the owner). */
export type DevServerStatus = 'starting' | 'running' | 'stopped';
export type PtyDevServer = {
  type: 'pty:dev-server';
  status: DevServerStatus;
  /** Owning terminal session. Present for lifecycle frames emitted by a pty run. */
  sid?: string;
  /** cwd of the command that started the server (owner-authoritative — the page
   * session cache is stale mid-run; used to record the reload-restore command). */
  cwd?: string;
  /** Internal listen port — defined once `status` reaches 'running'. */
  port?: number;
  /** Run-scoped preview bridge discriminator for the page↔worker hop. */
  previewScope?: string;
  /** Preview URL the iframe loads — defined once 'running'. */
  url?: string;
  /** Non-fatal start failure surfaced to the page pill (`status` stays 'stopped'). */
  error?: string;
};
/** Page asks the owner to re-publish dev-server state (owner-republishes-on-request handshake discipline). */
export type PtyDevServerReq = { type: 'pty:dev-server-req' };
/**
 * Page tells the owner the CURRENT preset's dev-server config (ADR-0148, dev server runs inside the owner). The
 * persistent owner is spawned once with the default template, so a preset switch
 * must update which runtime/template the next co-resident dev server boots.
 */
export type PtyDevConfig = {
  type: 'pty:dev-config';
  id: string;
  templateId: string;
  slug: string;
  setup: 'instant' | 'from-scratch';
};
export type PtyDevConfigReady = {
  type: 'pty:dev-config-ready';
  id: string;
  error?: string;
};

/** One previewable listening port (dev server or a `node <file>` server). */
export type PreviewPortEntry = {
  port: number;
  url: string;
  label: string;
  source: 'dev-server' | 'preview' | 'node';
  /** Owning session/run id (for label + teardown correlation). */
  sid: string;
  /** Run-scoped preview bridge discriminator for the page↔worker hop. */
  previewScope?: string;
};
/**
 * Owner→page snapshot of ALL live previewable ports (ADR-0155 — generalizes the
 * single-active dev-server preview to a set). Republished on change + on
 * `pty:preview-req`; never a one-shot push (P3 missed-before-listener discipline).
 */
export type PtyPreview = { type: 'pty:preview'; ports: PreviewPortEntry[] };
/** Page asks the owner to re-publish the preview-port set (subscribe handshake). */
export type PtyPreviewReq = { type: 'pty:preview-req' };

export type PageToOwnerFrame =
  | PtyOpen
  | PtyExec
  | PtyStdin
  | PtyStdinEof
  | PtySignal
  | PtyResize
  | PtyClose
  | PtyDevServerReq
  | PtyDevConfig
  | PtyPreviewReq;
export type OwnerToPageFrame =
  | PtyReady
  | PtyChunk
  | PtyExit
  | PtyDevServer
  | PtyPreview
  | PtyDevConfigReady;
export type PtyFrame = PageToOwnerFrame | OwnerToPageFrame;

/** kernel fork-IPC envelope discriminator (sits beside 'rifty:vfs-write'). */
export const PTY_IPC_TYPE = 'rifty:pty' as const;
export type PtyIpcMessage = { type: typeof PTY_IPC_TYPE; frame: PtyFrame };
export function isPtyIpcMessage(m: unknown): m is PtyIpcMessage {
  return !!m && typeof m === 'object' && (m as { type?: unknown }).type === PTY_IPC_TYPE;
}

const PAGE_TO_OWNER = new Set([
  'pty:open',
  'pty:exec',
  'pty:stdin',
  'pty:stdin-eof',
  'pty:signal',
  'pty:resize',
  'pty:close',
  'pty:dev-server-req',
  'pty:dev-config',
  'pty:preview-req',
]);
const OWNER_TO_PAGE = new Set([
  'pty:ready',
  'pty:chunk',
  'pty:exit',
  'pty:dev-server',
  'pty:preview',
  'pty:dev-config-ready',
]);
export function isPageToOwner(f: PtyFrame): f is PageToOwnerFrame {
  return PAGE_TO_OWNER.has(f.type);
}
export function isOwnerToPage(f: PtyFrame): f is OwnerToPageFrame {
  return OWNER_TO_PAGE.has(f.type);
}
