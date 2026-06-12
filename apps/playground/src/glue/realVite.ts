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
import { mountPlaygroundPreviewBridge } from './preview-bridge-wiring.ts';
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

  // `new URL(..., import.meta.url)` so Vite bundles the bootstrap as its own
  // worker chunk at build time.
  const bootstrapUrl = new URL('../workers/real-vite-bootstrap.ts', import.meta.url).toString();

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
        RIFTY_PREVIEW_OWNER_TOKEN: ownerToken,
        // Node idiom for node-server template entries (`process.env.PORT`).
        PORT: String(port),
      },
      cwd: root,
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
