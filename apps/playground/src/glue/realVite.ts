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
import { bridgeCrossRealmPreview, registerPort, unregisterPort } from '@riftydev/net';
import { NotImplementedError } from '@riftydev/vfs';
import type { ProjectSpec } from '../templates/project-spec.ts';
import { defaultProjectSpec } from '../templates/registry.ts';
import kernelWorkerUrl from '../workers/kernel-worker-entry.ts?worker&url';
import nodeEntryWorkerUrl from '../workers/node-entry-bootstrap.ts?worker&url';
import bootstrapWorkerUrl from '../workers/real-vite-bootstrap.ts?worker&url';
import { mountPlaygroundPreviewBridge } from './preview-bridge-wiring.ts';
import {
  type ExecOptions,
  type PtyOpenSeed,
  type PtySessionSnapshot,
  createPtyClient,
} from './pty-client.ts';
import { PTY_IPC_TYPE, type PtyDevServer, isOwnerToPage, isPtyIpcMessage } from './pty-protocol.ts';
import { sendVfsWrite } from './vfs-write-port.ts';
import { type WorkspaceArchiveBridge, bridgeWorkspaceArchive } from './workspace-archive-port.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

function createPreviewOwnerToken(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return randomUUID();
  return `owner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Wire the PAGE side of the co-resident preview (ADR-0148). The owner worker
 * serves `/preview/<port>/` (its `setupPreviewBridge` + `serveCrossRealmPreview`,
 * keyed by `ownerToken`); this registers the matching page-side cross-realm
 * bridge so the SW route reaches the owner. Call it when the owner reports the
 * dev server running (the `pty:dev-server` frame carries the port + token); the
 * returned teardown runs on stop.
 *
 * Replaces {@link startRealVite}'s per-run preview wiring — the worker is no
 * longer spawned per dev run (it IS the persistent owner), only the page-side
 * route is (un)registered as the dev server starts/stops.
 */
export function wirePreviewBridge(port: number, ownerToken: string): () => void {
  // SW dispatches `/preview/<port>/*` to the page; the `@riftydev/net` registry
  // routes through this handler over BroadcastChannel to the owner's
  // `serveCrossRealmPreview`.
  const previewBridge = bridgeCrossRealmPreview(port);
  registerPort(port, previewBridge);
  // ADR-0086: typed handle → SW requests take the struct fast-path.
  const tearSwBridge = mountPlaygroundPreviewBridge(previewBridge, { ownerToken });
  return (): void => {
    tearSwBridge();
    unregisterPort(port);
    previewBridge.dispose();
  };
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
  /**
   * Token the owner uses to key its `/preview/<port>/` SW route (ADR-0148).
   * The page passes it to {@link wirePreviewBridge} when the dev server starts.
   */
  readonly previewOwnerToken: string;
  /**
   * BroadcastChannel addressing key for the owner's snapshot + node_modules
   * read bridges (ADR-0076/0080). The bridges are still port-keyed; the owner
   * serves on this dedicated number (distinct from any dev-server port, so the
   * per-run preview worker's channels never cross-talk). The page subscribes on
   * it so the explorer reflects the owner tree before/after any vite run.
   */
  readonly snapshotPort: number;
  readonly closed: Promise<number | null>;
  /**
   * Open a pty session in the owner; resolves on `pty:ready`. An optional `seed`
   * (persisted cwd/env) restores terminal state into the owner shell on reload.
   */
  openSession(sid: string, seed?: PtyOpenSeed): Promise<void>;
  /** Run one line in `sid`; streams chunks to `onChunk`, resolves exit code. */
  exec(sid: string, line: string, opts: ExecOptions): Promise<number>;
  writeStdin(sid: string, rid: string, data: Uint8Array): void;
  signal(sid: string, rid: string): void;
  closeSession(sid: string): void;
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
   * Download: ask the owner to serialize its whole source tree to a workspace
   * archive JSON (single-store-owner model: the PAGE keeps no authoritative store
   * and reads the owner's tree through ports, so the archive reads the owner's
   * tree, full content, shell/CLI writes included).
   */
  exportArchive(): Promise<string>;
  /** Upload: hand the owner an archive JSON to apply to its tree. */
  importArchive(archiveJson: string): Promise<void>;
  /** Cached cwd/env for a session (from the latest `pty:exit`). */
  snapshot(sid: string): PtySessionSnapshot;
  /**
   * Subscribe to owner→page dev-server state (ADR-0148): the co-resident
   * dev server's start/stop + listen port. Returns an unsubscribe. The page
   * derives its LIVE pill + preview iframe URL from these frames.
   */
  onDevServer(cb: (frame: PtyDevServer) => void): () => void;
  /**
   * Tell the owner the current preset's dev-server config (ADR-0148) — the
   * persistent owner is spawned once, so a preset switch must update which
   * template/runtime the next co-resident dev server boots. Send before the dev line.
   */
  setDevConfig(config: {
    templateId: string;
    slug: string;
    setup: 'instant' | 'from-scratch';
  }): void;
  /** Terminate the owner worker; idempotent. */
  close(): void;
}

/**
 * Dedicated BroadcastChannel port for the persistent owner's serve bridges.
 * High, fixed, and outside the template default-port range (vite 5174, express
 * 3210) so the owner's `vfs-snapshot.local:<n>` / `vfs-nodemods.local:<n>`
 * channels never collide with a per-run preview worker's. This is a synthetic
 * channel key, never a real network port (the owner runs no dev server).
 */
const WORKSPACE_OWNER_SNAPSHOT_PORT = 59124;

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
  onLog?(line: string): void;
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
 * `client.disconnect()` resolves any in-flight `exec` nonzero so the terminal
 * never hangs.
 *
 * @throws NotImplementedError when SAB IPC is unavailable — cross-origin
 *   isolation is the gate (ADR-0002 / D-001), same as {@link startRealVite}.
 */
export function startWorkspaceOwner(opts: WorkspaceOwnerOptions = {}): WorkspaceOwnerHandle {
  const template = opts.template ?? defaultProjectSpec();
  const root = opts.root ?? '/workspace';
  const setup = opts.setup ?? 'instant';
  const slug = opts.slug ?? template.id;
  const workspaceId = opts.workspaceId ?? createPreviewOwnerToken();
  const snapshotPort = WORKSPACE_OWNER_SNAPSHOT_PORT;
  // Keys the owner's `/preview/<port>/` SW route (ADR-0148); shared with the
  // worker via env and with the page via `wirePreviewBridge`.
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
        // Dedicated snapshot/nm BroadcastChannel key (not a dev-server port);
        // the page subscribes on `handle.snapshotPort` to read the owner tree.
        RIFTY_RFV_PORT: String(snapshotPort),
        // ADR-0148: the owner's co-resident dev server keys its preview SW
        // route on this token; the page passes it to `wirePreviewBridge`.
        RIFTY_PREVIEW_OWNER_TOKEN: previewOwnerToken,
        // Node idiom for node-server template entries (`process.env.PORT`): the
        // co-resident dev server listens on the template's default port.
        PORT: String(template.defaultPort),
        // ADR-0150: worker URLs the owner needs to recursively spawn each
        // foreground CLI as a supervised child reading the owner fs over
        // sync-RPC (kernel realm + node-entry boot).
        RIFTY_KERNEL_WORKER_URL: kernelWorkerUrl,
        RIFTY_NODE_ENTRY_WORKER_URL: nodeEntryWorkerUrl,
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
  const client = createPtyClient({
    send: (frame) => {
      worker.send({ type: PTY_IPC_TYPE, frame });
    },
    onDevServer: (frame) => {
      for (const cb of devServerListeners) cb(frame);
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
    if (!isPtyIpcMessage(message)) return;
    // Only owner→page frames are actionable here; drop any echoed page→owner.
    if (isOwnerToPage(message.frame)) client.onFrame(message.frame);
  });

  // Readiness handshake (ADR-0146 / ADR-0148): request the current dev-server
  // state on spawn so a `pty:dev-server` push that predates our listener is
  // recoverable (the dropped-frame class the owner-resident shell hit) — never a
  // one-shot push.
  client.requestDevServer();

  let exited = false;
  let resolveClosed: (code: number | null) => void = () => {};
  const closed = new Promise<number | null>((resolve) => {
    resolveClosed = resolve;
  });
  worker.on('exit', (code?: unknown) => {
    exited = true;
    client.disconnect(); // resolve in-flight runs nonzero — never hang
    // Owner died → the co-resident dev server is gone. Synthesize a stopped
    // frame to the page so its LIVE pill leaves 'running' (Bug #4: the exit
    // path used to only resolve `closed`, leaving the UI stale). `error` is
    // the non-fatal-failure carrier per the frame protocol (status stays
    // 'stopped'); `port`/`url` are undefined, so the preview iframe tears down.
    const exitCode = typeof code === 'number' ? code : null;
    const stopped: PtyDevServer = {
      type: 'pty:dev-server',
      status: 'stopped',
      error: `workspace owner exited (code ${exitCode ?? 'null'})`,
    };
    for (const cb of devServerListeners) cb(stopped);
    resolveClosed(exitCode);
  });

  // Page-side client for the owner's archive export/import bridge (single store
  // owner; the page holds no authoritative fs): the owner serializes/applies the
  // workspace against its OWN syncMirror, so the page never needs an
  // authoritative store to download/upload a workspace.
  const archiveBridge: WorkspaceArchiveBridge = bridgeWorkspaceArchive(snapshotPort);

  return {
    workspaceId,
    previewOwnerToken,
    snapshotPort,
    closed,
    openSession: (sid, seed) => client.openSession(sid, seed),
    exec: (sid, line, execOpts) => client.exec(sid, line, execOpts),
    writeStdin: (sid, rid, data) => client.writeStdin(sid, rid, data),
    signal: (sid, rid) => client.signal(sid, rid),
    closeSession: (sid) => client.closeSession(sid),
    writeFile(path, content) {
      // Owner dead → a `worker.send` would return false and fall through to the
      // snapshot-port channel, which SILENTLY DROPS with no worker listening
      // (vfs-write-port.ts). Bug #4: post-crash edits must FAIL LOUDLY, not
      // vanish. The fallback below stays for the pre-handler boot window only.
      if (exited) {
        throw new Error(
          `writeFile(${path}): workspace owner has exited — write not applied. Reload to respawn the owner.`,
        );
      }
      const frame = { type: 'write' as const, path, data: enc.encode(content) };
      // IPC first (the owner's onMessage applies it to syncMirror); the
      // shim buffers frames sent before the slow entry registers its handler.
      if (!worker.send({ type: 'rifty:vfs-write', frame })) {
        sendVfsWrite(snapshotPort, frame);
      }
    },
    exportArchive: () => archiveBridge.export(),
    importArchive: (archiveJson) => archiveBridge.import(archiveJson),
    snapshot: (sid) => client.snapshot(sid),
    onDevServer(cb) {
      devServerListeners.add(cb);
      return () => devServerListeners.delete(cb);
    },
    setDevConfig: (config) => client.setDevConfig(config),
    close() {
      archiveBridge.dispose();
      if (!exited) handle.kill('SIGTERM');
    },
  };
}
