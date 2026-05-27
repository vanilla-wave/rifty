/**
 * Real Vite — kernel-spawned Worker realm (ADR-0043 — Vite-in-Worker,
 * M11 / A-026).
 *
 * The page-realm orchestrator. Spawns the Real Vite worker (which
 * actually runs the install + Vite createServer flow), wires the
 * cross-realm preview-port bridge, and forwards editor edits to the
 * worker via the VFS write port. The dev server, the HMR bridge, the
 * file watcher, and the entire `node:*` global shim all live in the
 * Worker realm — the page realm pays no Vite CPU cost and ships no
 * `installProcessGlobals()` side-effect into the page's
 * `Promise.prototype.then`.
 *
 * Supersedes the page-realm Real Vite path from ADR-0025. The
 * main-thread Dev Mode (`devMode.ts`) is retained as the non-isolated
 * fallback; this adapter requires `crossOriginIsolated` + SAB IPC
 * (same gate as the rest of ADR-0011).
 *
 * Flow:
 *   1. Gate on `isSabIpcSupported()` — throws `NotImplementedError`
 *      otherwise with the documented requirement.
 *   2. Resolve the bootstrap module URL via
 *      `new URL('../workers/real-vite-bootstrap.ts', import.meta.url)`
 *      so Vite bundles the worker chunk at build time.
 *   3. `globalProcessManager.spawnWorker('real-vite', spec)` — kernel
 *      builds the SAB ring, three stdio MessagePorts, posts init,
 *      kernel's pre-entry hook installs `globalThis.process` from the
 *      spec, kernel imports the bootstrap URL, bootstrap takes it from
 *      there.
 *   4. Register a page-side `bridgeCrossRealmPreview(port)` handler
 *      against `port` in the page's `@rifty/net` registry so the SW's
 *      preview-bridge forwards the SW fetch into the worker.
 *   5. Mount the existing `mountPlaygroundPreviewBridge()` — unchanged
 *      from the M10 path; it dispatches into the page registry, which
 *      now proxies to the worker.
 *   6. Pump worker stdout / stderr lines into `onLog` so the playground
 *      terminal mirrors the worker's progress.
 *   7. `updateEntry(content)` forwards each edit over the VFS write
 *      port — one-way mailbox per ADR-0043 / D4.
 *
 * What this file does NOT do:
 *   - Install Node-shape globals on the page realm. (That was the
 *     ADR-0025 trade-off.)
 *   - Run npm-install in the page realm.
 *   - Drive Vite's module-graph work in the page realm.
 *   - Replace the M10 Dev Mode (`devMode.ts`) — that's a separate
 *     adapter with the same kernel-Worker migration story to do later
 *     (out of scope here per ADR-0043 / D5).
 */
import { globalProcessManager, isSabIpcSupported } from '@rifty/kernel';
import { bridgeCrossRealmPreview, registerPort, unregisterPort } from '@rifty/net';
import { NotImplementedError } from '@rifty/vfs';
import { mountPlaygroundPreviewBridge } from './preview-bridge-wiring.ts';
import { sendVfsWrite } from './vfs-write-port.ts';

export interface RealViteHandle {
  readonly port: number;
  close(): Promise<void>;
  updateEntry(content: string): void;
}

export interface RealViteOptions {
  root?: string;
  entry?: string;
  port?: number;
  onLog?(line: string): void;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Spawn the Real Vite worker realm and wire the cross-realm bridges.
 *
 * Throws `NotImplementedError('startRealVite', '…')` if the host realm
 * doesn't have SAB IPC available (cross-origin isolation is the gate;
 * see ADR-0002 / D-001). The UI catches and surfaces the error in the
 * playground terminal — matches the existing `useMode.toggleRealVite()`
 * error path.
 */
export async function startRealVite(opts: RealViteOptions = {}): Promise<RealViteHandle> {
  const root = opts.root ?? '/workspace';
  const entryRel = opts.entry ?? '/src/main.js';
  const port = opts.port ?? 5174;
  const entryPath = `${root}${entryRel}`;
  const log = opts.onLog ?? (() => {});

  if (!isSabIpcSupported()) {
    throw new NotImplementedError(
      'startRealVite',
      'requires SAB IPC (cross-origin isolation) — toggle the host headers ' +
        'or run inside the playground dev server (vite.config.ts ships them).',
    );
  }

  // Vite bundles the bootstrap into its own worker chunk. The URL is
  // resolved at build time via `new URL(..., import.meta.url)`.
  const bootstrapUrl = new URL('../workers/real-vite-bootstrap.ts', import.meta.url).toString();

  log(`[real-vite] spawning worker with bootstrap ${bootstrapUrl}\n`);

  const handle = globalProcessManager.spawnWorker(
    'real-vite',
    {
      entry: { kind: 'url', url: bootstrapUrl },
      argv: ['rifty', 'real-vite'],
      env: {
        RIFTY_RFV_PORT: String(port),
        RIFTY_RFV_ROOT: root,
        RIFTY_RFV_ENTRY: entryRel,
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

  // Pump worker stdout / stderr lines into the playground log sink.
  // Vite's progress messages, install logs, and bootstrap-error stacks
  // all flow through here. The `Readable`'s data payload type is
  // `unknown` by design (object-mode allowance); the SAB Worker layer
  // always posts `Uint8Array`, so the runtime cast is sound.
  handle.stdout().on('data', (chunk: unknown) => {
    if (chunk instanceof Uint8Array) log(dec.decode(chunk));
  });
  handle.stderr().on('data', (chunk: unknown) => {
    if (chunk instanceof Uint8Array) log(dec.decode(chunk));
  });

  // Track worker exit so the handle's `close()` is idempotent — if the
  // worker dies on its own (install failure, vite crash) we still want
  // `close()` to be safe.
  let exited = false;
  handle.on('exit', (..._args: unknown[]) => {
    exited = true;
  });

  // Page-side preview-port bridge. The SW dispatches `/preview/<port>/*`
  // to the page; the page's `@rifty/net` registry routes through this
  // handler over `BroadcastChannel` to the worker's `serveCrossRealmPreview`.
  const previewBridge = bridgeCrossRealmPreview(port);
  registerPort(port, previewBridge);

  // Existing M7 SW ↔ page wiring — unchanged. It dispatches into the
  // page's `@rifty/net` registry, which now hits `previewBridge`.
  const tearSwBridge = mountPlaygroundPreviewBridge();

  log(`[real-vite] page-side preview-port bridge ready (port ${port})\n`);

  return {
    port,
    async close() {
      tearSwBridge();
      unregisterPort(port);
      previewBridge.dispose();
      if (!exited) {
        // Best-effort termination — `kill` is idempotent and the kernel
        // teardown closes the SAB ring + stdio ports.
        handle.kill('SIGTERM');
      }
    },
    updateEntry(content) {
      // One-way mailbox: edit lands in the worker's `syncMirror()`. Vite's
      // file watcher (worker-realm) sees it and the HMR bridge
      // (worker-realm) broadcasts the iframe reload.
      sendVfsWrite(port, {
        type: 'write',
        path: entryPath,
        data: enc.encode(content),
      });
    },
  };
}
