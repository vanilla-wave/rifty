/**
 * Real Vite — page-realm orchestrator for the kernel-spawned Worker realm
 * (ADR-0043 — Vite-in-Worker, M11 / A-026; supersedes the page-realm path
 * from ADR-0025).
 *
 * Spawns the Real Vite worker (which runs install + Vite createServer),
 * wires the cross-realm preview-port bridge, and forwards editor edits over
 * the VFS write port. Dev server, HMR bridge, file watcher, and the `node:*`
 * shim all live in the worker — so the page pays no Vite CPU cost and ships
 * no `installProcessGlobals()` side-effect into its `Promise.prototype.then`.
 *
 * `devMode.ts` (main-thread Dev Mode) is retained as the non-isolated
 * fallback; this adapter requires `crossOriginIsolated` + SAB IPC (ADR-0011).
 */
import { globalProcessManager, isSabIpcSupported } from '@riftydev/kernel';
import { isTsResponseMessage } from '@riftydev/ts-language-service/protocol';
import { NotImplementedError } from '@riftydev/vfs';
import type { ProjectSpec } from '../templates/project-spec.ts';
import { defaultProjectSpec } from '../templates/registry.ts';
import devServerWorkerUrl from '../workers/dev-server-child-bootstrap.ts?worker&url';
import bootstrapWorkerUrl from '../workers/real-vite-bootstrap.ts?worker&url';
import tsLspWorkerUrl from '../workers/ts-lsp-worker-entry.ts?worker&url';
import type { OwnerBridgeKey } from './owner-bridge-key.ts';
import { createOwnerVfsClient } from './owner-vfs-client.ts';
import type {
  HostCommitAck,
  HostCommitRequest,
  OwnerEpoch,
  OwnerVfsDurabilityReceipt,
  TreeRevision,
} from './owner-vfs-protocol.ts';
import { PLAYGROUND_NODE_WORKER_RUNTIME_ENV } from './playground-node-worker-runtime.ts';
export { wirePreviewBridge } from './preview-port-wiring.ts';
import {
  type ExecOptions,
  type PtyOpenSeed,
  type PtyRunResult,
  type PtySessionSnapshot,
  createPtyClient,
} from './pty-client.ts';
import {
  PTY_IPC_TYPE,
  type PtyDevServer,
  type PtyPreview,
  isOwnerToPage,
  isPtyIpcMessage,
} from './pty-protocol.ts';
import { stampTsLspOwner, tsLspOwnerMatches } from './ts-lsp-owner-scope.ts';
import {
  type VfsWriteFrame,
  isVfsFlushAckMessage,
  isVfsWriteAckMessage,
  sendGuardedVfsWrite,
  sendVfsWrite,
} from './vfs-write-port.ts';
import { type WorkspaceArchiveBridge, bridgeWorkspaceArchive } from './workspace-archive-port.ts';
import {
  type WorkspaceFileReadBridge,
  bridgeWorkspaceFileReads,
} from './workspace-file-read-port.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
/** OPFS durability drain can trail a big write burst (post-install trees run
 *  hundreds of ms; quota-pressure retries longer) — give the barrier slack. */
const VFS_FLUSH_ACK_TIMEOUT_MS = 30_000;

function createPreviewOwnerToken(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return randomUUID();
  return `owner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Page-side handle to the persistent workspace-owner worker — the owner-resident
 * shell (ADR-0146).
 *
 * The owner hosts the realm-resident `Shell` instances keyed by session id AND
 * the co-resident dev server (ADR-0148); this handle is the PAGE pty client
 * surface (`createPtyClient`) wired to the kernel fork-IPC channel. `close()`
 * kills the worker; `closed` settles on exit.
 */
export interface WorkspaceOwnerHandle {
  /** Stable id carried to the owner over `RIFTY_WORKSPACE_ID`. */
  readonly workspaceId: string;
  /** Actual root this owner was spawned at (`/scratch` or `/projects/<id>`). */
  readonly root: string;
  /**
   * Resolves after the owner registers its IPC handlers and serves its workspace
   * bridges. Page-originated frames sent before this point can race bootstrap.
   */
  readonly ready: Promise<void>;
  /**
   * Token the owner uses to key its `/preview/<port>/` SW route (ADR-0148).
   * The page passes it to {@link wirePreviewBridge} when the dev server starts.
   */
  readonly previewOwnerToken: string;
  /**
   * BroadcastChannel addressing key for the owner's snapshot + node_modules
   * read bridges (ADR-0076/0080). Scoped per owner so parallel same-origin
   * playgrounds never hydrate each other's owner snapshots or project indexes.
   */
  readonly snapshotPort: OwnerBridgeKey;
  readonly closed: Promise<number | null>;
  /** Owner nonce learned from the ready handshake; access before ready throws. */
  readonly ownerEpoch: OwnerEpoch;
  /** True while the backing owner worker is still alive. */
  isAlive(): boolean;
  /**
   * Open a pty session in the owner; resolves on `pty:ready`. An optional `seed`
   * (persisted cwd/env) restores terminal state into the owner shell on reload.
   */
  openSession(sid: string, seed?: PtyOpenSeed): Promise<void>;
  /** Run one line in `sid`; streams chunks to `onChunk`, resolves exit code. */
  exec(sid: string, line: string, opts: ExecOptions): Promise<number>;
  /** Run one line without losing the exact physical final-command exit. */
  execResult(sid: string, line: string, opts: ExecOptions): Promise<PtyRunResult>;
  writeStdin(sid: string, rid: string, data: Uint8Array): Promise<void>;
  endStdin(sid: string, rid: string): Promise<void>;
  resizeSession(sid: string, cols: number, rows: number): Promise<void>;
  resize(sid: string, rid: string, cols: number, rows: number): Promise<void>;
  signal(sid: string, rid: string): void;
  closeSession(sid: string, cancellation?: Error): Promise<void>;
  /**
   * Seed/overwrite a file in the owner realm's tree (a `rifty:vfs-write` frame,
   * ADR-0146). The owner-resident shell reads its OWN realm's `syncMirror()`, so
   * project files the page seeds must be pushed here too — else `cat`/`ls` miss
   * preset files the template seed didn't carry (the explorer reflects the owner
   * tree, so the owner is the single source of truth). Falls back to the
   * snapshot-port vfs-write channel.
   */
  writeFile(path: string, content: string): void;
  /**
   * Apply one owner-side VFS mutation frame. Explorer write operations route
   * here so rename/copy/delete cannot fall back to a stale page-side channel
   * after the workspace owner exits.
   */
  writeFrame(frame: VfsWriteFrame): void;
  /**
   * Apply one owner-side VFS mutation frame and wait for the owner's apply
   * result. File-manager operations use this so collision/stale-state errors
   * surface as the actual owner error, not as a generic reflect timeout.
   */
  writeFrameAcked(frame: VfsWriteFrame): Promise<void>;
  /**
   * Durability barrier (ADR-0187 Corrected). A write ack means "applied to the
   * owner's in-memory mirror"; OPFS write-through drains asynchronously behind
   * it. This resolves once the owner drained the queue AND the durable tier is
   * clean — rejects listing unhealed persist failures (disk lags the mirror),
   * so durability is provable without wall-clock sleeps. Memory backend: no
   * durability tier, resolves after the drain no-op.
   */
  flushDurable(): Promise<void>;
  /** Exact conditional host mutation transport used by VfsCommitCoordinator. */
  applyHostCommit(request: HostCommitRequest): Promise<HostCommitAck>;
  /** Bound owner/revision durability barrier used after reflected snapshots. */
  durabilityBarrier(treeRevision: TreeRevision): Promise<OwnerVfsDurabilityReceipt>;
  /**
   * Download: ask the owner to serialize its whole source tree to a workspace
   * archive JSON (single-store-owner model: the PAGE keeps no authoritative store
   * and reads the owner's tree through ports, so the archive reads the owner's
   * tree, full content, shell/CLI writes included).
   */
  exportArchive(): Promise<string>;
  /** Upload: hand the owner an archive JSON to apply to its tree. */
  importArchive(archiveJson: string): Promise<void>;
  /** Read one working-tree file from the owner with full bytes (no snapshot cap). */
  readFileBytes(path: string): Promise<Uint8Array>;
  /** Cached cwd/env for a session (from the latest `pty:exit`). */
  snapshot(sid: string): PtySessionSnapshot;
  /**
   * Subscribe to owner→page dev-server state (ADR-0148): the co-resident
   * dev server's start/stop + listen port. Returns an unsubscribe. The page
   * derives its LIVE pill + preview iframe URL from these frames.
   */
  onDevServer(cb: (frame: PtyDevServer) => void): () => void;
  /**
   * Subscribe to owner→page preview-port snapshots (ADR-0155): ALL live
   * previewable ports (the dev-server port + each `node <file>` server's
   * ports). Returns an unsubscribe. The page derives its preview switcher set +
   * per-node-port SW bridges from these frames.
   */
  onPreview(cb: (frame: PtyPreview) => void): () => void;
  /**
   * Ask the owner to re-publish the preview-port set (ADR-0155 subscribe
   * handshake) — recovers a `pty:preview` push that predates the page's listener
   * (never a one-shot push). Mirrors {@link requestDevServer}'s discipline.
   */
  requestPreview(): void;
  /**
   * Tell the owner the current preset's dev-server config (ADR-0148) — the
   * persistent owner is spawned once, so a preset switch must update which
   * template/runtime the next co-resident dev server boots. Send before the dev line.
   */
  setDevConfig(config: {
    templateId: string;
    slug: string;
    setup: 'instant' | 'from-scratch';
  }): Promise<void>;
  /**
   * Send a `rifty:ts-lsp` REQUEST envelope to the owner (ADR-0166 P1.9a). There
   * is no direct page→LS channel — the LS is a grandchild the owner spawned — so
   * the owner relays the frame to its LS child. `message` is a
   * {@link import('@riftydev/ts-language-service').TsRequestMessage}; structured-
   * clone-safe. No-op if the owner has exited.
   */
  sendTsLsp(message: unknown): void;
  /**
   * Subscribe to `rifty:ts-lsp` RESPONSE envelopes relayed back from the LS child
   * through the owner (ADR-0166 P1.9a). Returns an unsubscribe. The page LS
   * client correlates responses by `id`.
   */
  onTsLsp(cb: (message: unknown) => void): () => void;
  /** Terminate the owner worker; idempotent. */
  close(): void;
}

/**
 * Dedicated BroadcastChannel key for one persistent owner's serve bridges. It is
 * never a real network port; the key is embedded in the synthetic channel path.
 */
function ownerBridgeKey(workspaceId: string): OwnerBridgeKey {
  return `owner:${workspaceId}:${createPreviewOwnerToken()}`;
}

export interface WorkspaceOwnerOptions {
  /** Workspace root (cwd of the owner + its shells). Defaults to `/workspace`. */
  root?: string;
  /** Stable workspace id; defaults to a generated token. */
  workspaceId?: string;
  /** Template to mount in the owner realm; defaults to the registered default. */
  template?: ProjectSpec;
  /** Sandbox setup kind (ADR-0135), carried over `RIFTY_RFV_SETUP`. */
  setup?: 'instant' | 'from-scratch';
  /** Install-stamp reuse key, carried over `RIFTY_RFV_SLUG`. */
  slug?: string;
  /**
   * Active STARTER id (preset id), carried over `RIFTY_RFV_STARTER` (ADR-0165 §4).
   * The slug is the active ROOT id ('scratch'|projectId); the owner needs the
   * starter to synthesize a scratch index entry. Defaults to the template id.
   */
  starter?: string;
  /** Fresh starter pick before the full owner spawned; generated baseline files should amend Initial commit. */
  starterGeneratedBaselinePending?: boolean;
  /**
   * First-run hidden workspace: seed only the template scaffold, not the chosen
   * starter/index scratch record. The launcher still owns the user's first pick.
   */
  hiddenEmptyBoot?: boolean;
  onLog?(line: string): void;
}

interface WorkspaceOwnerReadyMessage {
  readonly type: 'rifty:workspace-owner-ready';
  readonly port: OwnerBridgeKey;
  readonly ownerEpoch: OwnerEpoch;
  readonly treeRevision: TreeRevision;
}

function isWorkspaceOwnerReadyMessage(message: unknown): message is WorkspaceOwnerReadyMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as {
    readonly type?: unknown;
    readonly port?: unknown;
    readonly ownerEpoch?: unknown;
    readonly treeRevision?: unknown;
  };
  return (
    candidate.type === 'rifty:workspace-owner-ready' &&
    (typeof candidate.port === 'string' || typeof candidate.port === 'number') &&
    typeof candidate.ownerEpoch === 'string' &&
    candidate.ownerEpoch.length > 0 &&
    typeof candidate.treeRevision === 'number' &&
    Number.isSafeInteger(candidate.treeRevision) &&
    candidate.treeRevision >= 0
  );
}

/**
 * Spawn the persistent workspace-owner worker in shell mode — owner-resident
 * shell (ADR-0146) — and
 * return its PAGE pty client surface.
 *
 * The worker runs `real-vite-bootstrap` with `RIFTY_OWNER_MODE='shell'`: it
 * builds the realm-resident `Shell` factory (owner npm + in-realm bin) and a
 * `createPtyServer` wired to the same kernel IPC channel this handle posts on.
 * Frames travel as `{ type: PTY_IPC_TYPE, frame }`; this side filters owner→page
 * envelopes via `isPtyIpcMessage` and feeds `client.onFrame`. On worker exit
 * `client.disconnect()` rejects any in-flight `exec` loudly so transport death
 * cannot masquerade as a process exit.
 *
 * @throws NotImplementedError when SAB IPC is unavailable — cross-origin
 *   isolation is the gate (ADR-0002 / D-001), same as {@link startRealVite}.
 */
export function startWorkspaceOwner(opts: WorkspaceOwnerOptions = {}): WorkspaceOwnerHandle {
  const template = opts.template ?? defaultProjectSpec();
  // ADR-0165 §4: the active root is `/scratch` or `/projects/<id>`; App always
  // passes it via rootForId(activeId). Fallback is the default scratch root (the
  // legacy single `/workspace` is deleted).
  const root = opts.root ?? '/scratch';
  const setup = opts.setup ?? 'instant';
  const slug = opts.slug ?? template.id;
  const starter = opts.starter ?? template.id;
  const starterGeneratedBaselinePending = opts.starterGeneratedBaselinePending === true;
  const hiddenEmptyBoot = opts.hiddenEmptyBoot === true;
  const workspaceId = opts.workspaceId ?? createPreviewOwnerToken();
  const snapshotPort = ownerBridgeKey(workspaceId);
  // Keys the page's `/preview/<port>/` SW route (ADR-0148/0150 P6b): the page
  // wires its side via `wirePreviewBridge`. The dev server runs in a supervised
  // child whose cross-realm route is keyed by port, not this token.
  const previewOwnerToken = createPreviewOwnerToken();
  const log = opts.onLog ?? (() => {});

  if (!isSabIpcSupported()) {
    throw new NotImplementedError(
      'startWorkspaceOwner',
      'requires SAB IPC (cross-origin isolation) — toggle the host headers ' +
        'or run inside the playground dev server (vite.config.ts ships them).',
    );
  }

  log(`[workspace-owner] spawning shell-mode owner (workspace ${workspaceId})\n`);

  const handle = globalProcessManager.spawnWorker(
    'workspace-owner',
    {
      entry: { kind: 'url', url: bootstrapWorkerUrl },
      argv: ['rifty', 'workspace-owner'],
      env: {
        RIFTY_OWNER_MODE: 'shell',
        RIFTY_WORKSPACE_ID: workspaceId,
        RIFTY_RFV_ROOT: root,
        RIFTY_RFV_TEMPLATE: template.id,
        RIFTY_RFV_SETUP: setup,
        RIFTY_RFV_SLUG: slug,
        RIFTY_RFV_STARTER: starter,
        RIFTY_RFV_STARTER_BASELINE_PENDING: starterGeneratedBaselinePending ? '1' : '0',
        RIFTY_RFV_HIDDEN_EMPTY_BOOT: hiddenEmptyBoot ? '1' : '0',
        // Dedicated snapshot/nm BroadcastChannel key (not a dev-server port);
        // the page subscribes on `handle.snapshotPort` to read the owner tree.
        RIFTY_RFV_PORT: String(snapshotPort),
        // Node idiom for node-server template entries (`process.env.PORT`): the
        // co-resident dev server listens on the template's default port.
        PORT: String(template.defaultPort),
        // ADR-0150: worker URLs the owner needs to recursively spawn each
        // foreground CLI as a supervised child reading the owner fs over
        // sync-RPC (kernel realm + node-entry boot).
        ...PLAYGROUND_NODE_WORKER_RUNTIME_ENV,
        // ADR-0150 P6b — child entry the owner spawns for the dev server.
        RIFTY_DEV_SERVER_WORKER_URL: devServerWorkerUrl,
        // ADR-0166 P1.9a — child entry the owner spawns for the TS language
        // service. Spawned FROM the owner (not the page) so the LS reads the
        // owner's authoritative VFS over fs.* sync-RPC (a page-spawned LS would
        // see an empty tree). page↔LS `rifty:ts-lsp` frames relay through the owner.
        RIFTY_TS_LSP_WORKER_URL: tsLspWorkerUrl,
      },
      cwd: root,
      // ADR-0144: long-lived owner — the realm stays alive past the bootstrap
      // entry; the open IPC channel keeps the shells resident until close().
      serve: true,
    },
    /* ppid */ 1,
    { cwd: root },
  );

  if (handle.kind !== 'worker') {
    throw new NotImplementedError(
      'startWorkspaceOwner',
      `globalProcessManager.spawnWorker returned kind=${handle.kind}; expected 'worker'`,
    );
  }
  const worker = handle;

  const devServerListeners = new Set<(frame: PtyDevServer) => void>();
  const previewListeners = new Set<(frame: PtyPreview) => void>();
  // ADR-0166 P1.9a: `rifty:ts-lsp` RESPONSE envelopes the owner relays back from
  // its LS child. The page LS client subscribes and correlates by `id`.
  const tsLspListeners = new Set<(message: unknown) => void>();
  const pendingVfsWrites = new Map<
    string,
    {
      readonly resolve: () => void;
      readonly reject: (err: Error) => void;
    }
  >();
  const pendingVfsFlushes = new Map<
    string,
    {
      readonly resolve: () => void;
      readonly reject: (err: Error) => void;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();
  let currentOwnerEpoch: OwnerEpoch | null = null;
  let exited = false;
  let readySettled = false;
  let resolveReady: () => void = () => {};
  let rejectReady: (err: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});
  const settleReady = (): void => {
    if (readySettled) return;
    readySettled = true;
    resolveReady();
  };
  const failReady = (err: Error): void => {
    if (readySettled) return;
    readySettled = true;
    rejectReady(err);
  };
  const ownerVfsClient = createOwnerVfsClient({
    send: (frame) => worker.send(frame),
    currentOwnerEpoch: () => currentOwnerEpoch,
    isAlive: () => !exited,
    reportProtocolError: (error) => {
      console.error('[real-vite/page] rejected divergent owner VFS terminal', error);
    },
  });
  const client = createPtyClient({
    send: (frame) => {
      if (!worker.send({ type: PTY_IPC_TYPE, frame })) {
        throw new Error(`owner PTY send failed (${frame.type})`);
      }
    },
    onDevServer: (frame) => {
      for (const cb of devServerListeners) cb(frame);
    },
    onPreview: (frame) => {
      for (const cb of previewListeners) cb(frame);
    },
  });

  // Mirror startRealVite's tolerant decode — surface owner boot/install logs.
  const decodeChunk = (chunk: unknown): string => {
    if (chunk instanceof Uint8Array) return dec.decode(chunk);
    if (chunk instanceof ArrayBuffer) return dec.decode(new Uint8Array(chunk));
    if (ArrayBuffer.isView(chunk)) {
      return dec.decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
    return typeof chunk === 'string' ? chunk : '';
  };
  worker.stdout().on('data', (chunk: unknown) => {
    const text = decodeChunk(chunk);
    if (text) log(text);
  });
  worker.stderr().on('data', (chunk: unknown) => {
    const text = decodeChunk(chunk);
    if (text) log(text);
  });

  worker.on('message', (message: unknown) => {
    if (isWorkspaceOwnerReadyMessage(message) && Object.is(message.port, snapshotPort)) {
      currentOwnerEpoch = message.ownerEpoch;
      settleReady();
      return;
    }
    if (ownerVfsClient.accept(message)) return;
    if (isVfsWriteAckMessage(message)) {
      const pending = pendingVfsWrites.get(message.opId);
      if (!pending) return;
      pendingVfsWrites.delete(message.opId);
      if (message.ok) {
        pending.resolve();
      } else {
        const err = new Error(message.error.message);
        err.name = message.error.name;
        pending.reject(err);
      }
      return;
    }
    if (isVfsFlushAckMessage(message)) {
      const pending = pendingVfsFlushes.get(message.opId);
      if (!pending) return;
      pendingVfsFlushes.delete(message.opId);
      clearTimeout(pending.timer);
      if (message.ok) {
        pending.resolve();
      } else {
        const err = new Error(message.error.message);
        err.name = message.error.name;
        pending.reject(err);
      }
      return;
    }
    if (isPtyIpcMessage(message)) {
      // Only owner→page frames are actionable here; drop any echoed page→owner.
      if (isOwnerToPage(message.frame)) client.onFrame(message.frame);
      return;
    }
    // ADR-0166 P1.9a: TS LSP responses the owner relayed back from its LS child.
    // Only RESPONSE envelopes are inbound here (the page sends requests); a stray
    // echoed request envelope is ignored.
    if (isTsResponseMessage(message) && tsLspOwnerMatches(message, snapshotPort)) {
      for (const cb of tsLspListeners) cb(message);
    }
  });

  // Readiness handshake (ADR-0146 / ADR-0148 / ADR-0155): request the current
  // dev-server state AND preview-port set on spawn so a `pty:dev-server` /
  // `pty:preview` push that predates our listener is recoverable (the
  // dropped-frame class the owner-resident shell hit) — never a one-shot push.
  void ready
    .then(
      () => {
        client.requestDevServer();
        client.requestPreview();
      },
      () => {},
    )
    .catch(() => {});

  let resolveClosed: (code: number | null) => void = () => {};
  const closed = new Promise<number | null>((resolve) => {
    resolveClosed = resolve;
  });
  worker.on('exit', (code?: unknown) => {
    exited = true;
    const exitCode = typeof code === 'number' ? code : null;
    failReady(new Error(`workspace owner exited before ready (code ${exitCode ?? 'null'})`));
    client.disconnect(); // resolve in-flight runs nonzero — never hang
    ownerVfsClient.disconnect();
    for (const [opId, pending] of pendingVfsWrites) {
      pendingVfsWrites.delete(opId);
      pending.reject(new Error(`workspace owner exited before VFS write ack (${opId})`));
    }
    for (const [opId, pending] of pendingVfsFlushes) {
      pendingVfsFlushes.delete(opId);
      clearTimeout(pending.timer);
      pending.reject(new Error(`workspace owner exited before VFS flush ack (${opId})`));
    }
    // Owner died → the co-resident dev server is gone. Synthesize a stopped
    // frame to the page so its LIVE pill leaves 'running' (Bug #4: the exit
    // path used to only resolve `closed`, leaving the UI stale). `error` is
    // the non-fatal-failure carrier per the frame protocol (status stays
    // 'stopped'); `port`/`url` are undefined, so the preview iframe tears down.
    const stopped: PtyDevServer = {
      type: 'pty:dev-server',
      status: 'stopped',
      error: `workspace owner exited (code ${exitCode ?? 'null'})`,
    };
    for (const cb of devServerListeners) cb(stopped);
    // Owner died → every previewable server is gone. Publish an empty set so the
    // page tears down all per-node-port bridges + falls back from the switcher
    // (mirrors the synthesized stopped dev-server frame above).
    const noPreviews: PtyPreview = { type: 'pty:preview', ports: [] };
    for (const cb of previewListeners) cb(noPreviews);
    resolveClosed(exitCode);
  });

  // Page-side client for the owner's archive export/import bridge (single store
  // owner; the page holds no authoritative fs): the owner serializes/applies the
  // workspace against its OWN syncMirror, so the page never needs an
  // authoritative store to download/upload a workspace.
  const archiveBridge: WorkspaceArchiveBridge = bridgeWorkspaceArchive(snapshotPort, {
    ownerClosed: closed,
  });
  const fileReadBridge: WorkspaceFileReadBridge = bridgeWorkspaceFileReads(snapshotPort);
  const writeFrame = (frame: VfsWriteFrame): void => {
    sendGuardedVfsWrite({
      key: snapshotPort,
      frame,
      exited,
      sendIpc: (message) => worker.send(message),
      fallback: sendVfsWrite,
    });
  };
  const writeFrameAcked = (frame: VfsWriteFrame): Promise<void> => {
    if (exited) {
      return Promise.reject(
        new Error(
          `${frame.type}: workspace owner has exited — write not applied. Reload to respawn the owner.`,
        ),
      );
    }
    const opId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
    return new Promise<void>((resolve, reject) => {
      // The page cannot cancel an admitted owner mutation. Only its ACK/NACK or
      // owner exit can establish a terminal outcome without a late mutation.
      pendingVfsWrites.set(opId, { resolve, reject });
      if (!worker.send({ type: 'rifty:vfs-write', opId, frame })) {
        pendingVfsWrites.delete(opId);
        reject(new Error(`owner VFS write send failed (${opId})`));
      }
    });
  };
  const flushDurable = (): Promise<void> => {
    if (exited) {
      return Promise.reject(
        new Error('workspace owner has exited — nothing to flush. Reload to respawn the owner.'),
      );
    }
    const opId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingVfsFlushes.delete(opId);
        reject(new Error(`owner VFS flush ack timed out (${opId})`));
      }, VFS_FLUSH_ACK_TIMEOUT_MS);
      pendingVfsFlushes.set(opId, { resolve, reject, timer });
      if (!worker.send({ type: 'rifty:vfs-flush', opId })) {
        pendingVfsFlushes.delete(opId);
        clearTimeout(timer);
        reject(new Error(`owner VFS flush send failed (${opId})`));
      }
    });
  };
  const readFileBytes = (path: string): Promise<Uint8Array> => {
    if (exited) {
      return Promise.reject(
        new Error(`workspace owner has exited — cannot read ${path}. Reload to respawn the owner.`),
      );
    }
    return Promise.race([
      fileReadBridge.readFileBytes(path),
      closed.then(() => {
        throw new Error(
          `workspace owner exited while reading ${path}. Reload to respawn the owner.`,
        );
      }),
    ]);
  };

  return {
    workspaceId,
    root,
    ready,
    previewOwnerToken,
    snapshotPort,
    closed,
    get ownerEpoch() {
      if (currentOwnerEpoch === null) {
        throw new Error('workspace owner epoch is unavailable before ready');
      }
      return currentOwnerEpoch;
    },
    openSession: async (sid, seed) => {
      await ready;
      return client.openSession(sid, seed);
    },
    exec: async (sid, line, execOpts) => {
      await ready;
      return client.exec(sid, line, execOpts);
    },
    execResult: async (sid, line, execOpts) => {
      await ready;
      return client.execResult(sid, line, execOpts);
    },
    writeStdin: (sid, rid, data) => client.writeStdin(sid, rid, data),
    endStdin: (sid, rid) => client.endStdin(sid, rid),
    resizeSession: (sid, cols, rows) => client.resizeSession(sid, cols, rows),
    resize: (sid, rid, cols, rows) => client.resize(sid, rid, cols, rows),
    signal: (sid, rid) => client.signal(sid, rid),
    closeSession: (sid, cancellation) => client.closeSession(sid, cancellation),
    isAlive: () => !exited,
    writeFile(path, content) {
      writeFrame({ type: 'write', path, data: enc.encode(content) });
    },
    writeFrame,
    writeFrameAcked,
    flushDurable,
    applyHostCommit: ownerVfsClient.applyHostCommit,
    durabilityBarrier: ownerVfsClient.durabilityBarrier,
    exportArchive: () => archiveBridge.export(),
    importArchive: (archiveJson) => archiveBridge.import(archiveJson),
    readFileBytes,
    snapshot: (sid) => client.snapshot(sid),
    onDevServer(cb) {
      devServerListeners.add(cb);
      return () => devServerListeners.delete(cb);
    },
    onPreview(cb) {
      previewListeners.add(cb);
      return () => previewListeners.delete(cb);
    },
    requestPreview: () => {
      void ready
        .then(
          () => client.requestPreview(),
          () => {},
        )
        .catch(() => {});
    },
    setDevConfig: async (config) => {
      await ready;
      return client.setDevConfig(config);
    },
    sendTsLsp(message) {
      // No-op once the owner is gone — the LS child died with it; the page LS
      // client's per-request timeout rejects any in-flight call so nothing hangs.
      if (exited) return;
      void ready.then(
        () => {
          if (!exited) worker.send(stampTsLspOwner(message, snapshotPort));
        },
        () => {},
      );
    },
    onTsLsp(cb) {
      tsLspListeners.add(cb);
      return () => tsLspListeners.delete(cb);
    },
    close() {
      archiveBridge.dispose();
      fileReadBridge.dispose();
      if (!exited) handle.kill('SIGTERM');
    },
  };
}
