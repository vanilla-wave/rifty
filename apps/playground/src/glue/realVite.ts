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
import bootstrapWorkerUrl from '../workers/real-vite-bootstrap.ts?worker&url';
import { mountPlaygroundPreviewBridge } from './preview-bridge-wiring.ts';
import { type ExecOptions, type PtySessionSnapshot, createPtyClient } from './pty-client.ts';
import { PTY_IPC_TYPE, isOwnerToPage, isPtyIpcMessage } from './pty-protocol.ts';
import { sendVfsWrite } from './vfs-write-port.ts';

export interface RealViteHandle {
  readonly port: number;
  readonly closed: Promise<number | null>;
  close(): Promise<void>;
  updateEntry(content: string): void;
  updateFile(path: string, content: string): void;
}

export interface RealViteOptions {
  root?: string;
  entry?: string;
  port?: number;
  /** Template to run; defaults to the registered default. Carried to the worker
   *  by id over `RIFTY_RFV_TEMPLATE`; the worker re-resolves the spec. */
  template?: ProjectSpec;
  /** Sandbox setup kind (ADR-0135), carried over `RIFTY_RFV_SETUP`. Drives the
   *  worker's dependency arrival: `from-scratch` skips the baked snapshot and
   *  streams a real `npm install` to the terminal; `instant` (default) uses the
   *  quiet snapshot/stamp path. */
  setup?: 'instant' | 'from-scratch';
  /** Project slug (preset id), carried over `RIFTY_RFV_SLUG`. The worker's
   *  install-stamp reuse key — distinct presets on the same template must not
   *  reuse each other's tree. Defaults to the template id. */
  slug?: string;
  onLog?(line: string): void;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function createPreviewOwnerToken(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return randomUUID();
  return `owner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Spawn the Real Vite worker realm and wire the cross-realm bridges.
 *
 * @throws NotImplementedError when SAB IPC is unavailable — cross-origin
 *   isolation is the gate (ADR-0002 / D-001). UI catches and surfaces it in
 *   the playground terminal.
 */
export async function startRealVite(opts: RealViteOptions = {}): Promise<RealViteHandle> {
  const template = opts.template ?? defaultProjectSpec();
  const root = opts.root ?? '/workspace';
  const entryRel = opts.entry ?? template.entry.relativePath;
  const port = opts.port ?? template.defaultPort;
  const setup = opts.setup ?? 'instant';
  const slug = opts.slug ?? template.id;
  const ownerToken = createPreviewOwnerToken();
  const entryPath = `${root}${entryRel}`;
  const log = opts.onLog ?? (() => {});

  if (!isSabIpcSupported()) {
    throw new NotImplementedError(
      'startRealVite',
      'requires SAB IPC (cross-origin isolation) — toggle the host headers ' +
        'or run inside the playground dev server (vite.config.ts ships them).',
    );
  }

  const bootstrapUrl = bootstrapWorkerUrl;

  log(`[real-vite] spawning ${template.displayName} worker with bootstrap ${bootstrapUrl}\n`);

  const handle = globalProcessManager.spawnWorker(
    'real-vite',
    {
      entry: { kind: 'url', url: bootstrapUrl },
      argv: ['rifty', 'real-vite'],
      env: {
        RIFTY_RFV_PORT: String(port),
        RIFTY_RFV_ROOT: root,
        RIFTY_RFV_ENTRY: entryRel,
        RIFTY_RFV_TEMPLATE: template.id,
        RIFTY_RFV_SETUP: setup,
        RIFTY_RFV_SLUG: slug,
        RIFTY_PREVIEW_OWNER_TOKEN: ownerToken,
        // Node idiom for node-server template entries (`process.env.PORT`).
        PORT: String(port),
      },
      cwd: root,
      // ADR-0144: long-lived owner — the kernel keeps the realm alive after the
      // bootstrap entry settles (until handle.kill()), replacing the worker's
      // old `await new Promise<never>(() => {})` keep-alive hack.
      serve: true,
    },
    /* ppid */ 1,
    { cwd: root },
  );

  if (handle.kind !== 'worker') {
    throw new NotImplementedError(
      'startRealVite',
      `globalProcessManager.spawnWorker returned kind=${handle.kind}; expected 'worker'`,
    );
  }

  // The `Readable` payload type is `unknown` (object-mode allowance); decode
  // whatever the SAB Worker layer hands us. A too-narrow `instanceof
  // Uint8Array` guard silently swallowed worker logs (install/boot progress
  // AND error stacks), making a stalled boot look frozen with no feedback.
  const decodeChunk = (chunk: unknown): string => {
    if (chunk instanceof Uint8Array) return dec.decode(chunk);
    if (chunk instanceof ArrayBuffer) return dec.decode(new Uint8Array(chunk));
    if (ArrayBuffer.isView(chunk)) {
      return dec.decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
    return typeof chunk === 'string' ? chunk : '';
  };
  handle.stdout().on('data', (chunk: unknown) => {
    const text = decodeChunk(chunk);
    if (text) log(text);
  });
  handle.stderr().on('data', (chunk: unknown) => {
    const text = decodeChunk(chunk);
    if (text) log(text);
  });

  // Track exit so `close()` stays safe when the worker dies on its own
  // (install failure, vite crash).
  let exited = false;
  let resolveClosed: (code: number | null) => void = () => {};
  const closed = new Promise<number | null>((resolve) => {
    resolveClosed = resolve;
  });
  handle.on('exit', (code?: unknown) => {
    exited = true;
    resolveClosed(typeof code === 'number' ? code : null);
  });

  // SW dispatches `/preview/<port>/*` to the page; the `@riftydev/net`
  // registry routes through this handler over `BroadcastChannel` to the
  // worker's `serveCrossRealmPreview`.
  const previewBridge = bridgeCrossRealmPreview(port);
  registerPort(port, previewBridge);

  // ADR-0086: pass the typed handle so SW requests take the struct fast-path
  // (skips the page→worker Request rebuild + arrayBuffer drain).
  const tearSwBridge = mountPlaygroundPreviewBridge(previewBridge, { ownerToken });

  log(`[real-vite] page-side preview-port bridge ready (port ${port})\n`);

  const updateFile = (path: string, content: string): void => {
    const frame = {
      type: 'write' as const,
      path,
      data: enc.encode(content),
    };
    if (!handle.send({ type: 'rifty:vfs-write', frame })) {
      sendVfsWrite(port, frame);
    }
  };

  return {
    port,
    closed,
    async close() {
      tearSwBridge();
      unregisterPort(port);
      previewBridge.dispose();
      if (!exited) {
        // `kill` is idempotent; kernel teardown closes the SAB ring + stdio.
        handle.kill('SIGTERM');
      }
    },
    updateEntry(content) {
      updateFile(entryPath, content);
    },
    updateFile,
  };
}

/**
 * Page-side handle to the persistent workspace-owner worker (ADR-0146 P2).
 *
 * The owner hosts the realm-resident `Shell` instances keyed by session id;
 * this handle is the PAGE pty client surface (`createPtyClient`) wired to the
 * kernel fork-IPC channel. Unlike {@link RealViteHandle} it owns no preview
 * bridge — vite/preview stays in the separate preview worker (P4 will fold it
 * into the owner). `close()` kills the worker; `closed` settles on exit.
 */
export interface WorkspaceOwnerHandle {
  /** Stable id carried to the owner over `RIFTY_WORKSPACE_ID`. */
  readonly workspaceId: string;
  readonly closed: Promise<number | null>;
  /** Open a pty session in the owner; resolves on `pty:ready`. */
  openSession(sid: string): Promise<void>;
  /** Run one line in `sid`; streams chunks to `onChunk`, resolves exit code. */
  exec(sid: string, line: string, opts: ExecOptions): Promise<number>;
  writeStdin(sid: string, rid: string, data: Uint8Array): void;
  signal(sid: string, rid: string): void;
  resize(sid: string, rid: string, cols: number, rows: number): void;
  closeSession(sid: string): void;
  /** Cached cwd/env for a session (from the latest `pty:exit`). */
  snapshot(sid: string): PtySessionSnapshot;
  /** Terminate the owner worker; idempotent. */
  close(): void;
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
  onLog?(line: string): void;
}

/**
 * Spawn the persistent workspace-owner worker in shell mode (ADR-0146 P2) and
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

  const client = createPtyClient({
    send: (frame) => {
      worker.send({ type: PTY_IPC_TYPE, frame });
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

  let exited = false;
  let resolveClosed: (code: number | null) => void = () => {};
  const closed = new Promise<number | null>((resolve) => {
    resolveClosed = resolve;
  });
  worker.on('exit', (code?: unknown) => {
    exited = true;
    client.disconnect(); // resolve in-flight runs nonzero — never hang
    resolveClosed(typeof code === 'number' ? code : null);
  });

  return {
    workspaceId,
    closed,
    openSession: (sid) => client.openSession(sid),
    exec: (sid, line, execOpts) => client.exec(sid, line, execOpts),
    writeStdin: (sid, rid, data) => client.writeStdin(sid, rid, data),
    signal: (sid, rid) => client.signal(sid, rid),
    resize: (sid, rid, cols, rows) => client.resize(sid, rid, cols, rows),
    closeSession: (sid) => client.closeSession(sid),
    snapshot: (sid) => client.snapshot(sid),
    close() {
      if (!exited) handle.kill('SIGTERM');
    },
  };
}
