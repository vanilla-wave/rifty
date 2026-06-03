/**
 * M10 dev-mode adapter.
 *
 * Starts a Vite-equivalent dev server in the main-thread realm so the SW's
 * `/preview/<port>/*` interceptor can dispatch into our `@riftydev/net.http`
 * port registry without crossing Worker boundaries.
 *
 * Editor edits write a single file (configurable, default `/workspace/src/main.js`)
 * into the shared VFS sync-mirror; the dev server's `fs.watch` ticks pick it up
 * and broadcast HMR over `WebSocketServer`. The injected client script in the
 * served HTML reloads the iframe on each update.
 */

import { type DevServer, startDevServer } from '@rifty-examples/vite-like-dev';
import { syncMirror } from '@riftydev/vfs';
import { mountPlaygroundPreviewBridge } from './preview-bridge-wiring.ts';

const enc = new TextEncoder();

const INITIAL_INDEX_HTML = `<!doctype html>
<html>
  <head><title>rifty preview</title></head>
  <body>
    <h1>Hello from rifty</h1>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>`;

const INITIAL_MAIN_JS = `document.getElementById('app').textContent =
  'Edit src/main.js in the editor → see changes here ↑';
`;

export interface DevModeHandle {
  readonly devServer: DevServer;
  readonly entryPath: string;
  updateEntry(content: string): void;
  close(): Promise<void>;
}

export interface DevModeOptions {
  root?: string;
  entry?: string;
  port?: number;
}

export async function startDevMode(options: DevModeOptions = {}): Promise<DevModeHandle> {
  const root = options.root ?? '/workspace';
  const entryRel = options.entry ?? '/src/main.js';
  const port = options.port ?? 3000;
  const entryPath = `${root}${entryRel}`;

  const fs = syncMirror();
  // Seed the project tree if empty.
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(`${root}/src`, { recursive: true });
  if (!fs.existsSync(`${root}/index.html`)) {
    fs.writeFileSync(`${root}/index.html`, enc.encode(INITIAL_INDEX_HTML));
  }
  if (!fs.existsSync(entryPath)) {
    fs.writeFileSync(entryPath, enc.encode(INITIAL_MAIN_JS));
  }

  const devServer = await startDevServer({ root, port, watchInterval: 100 });

  // Shared adapter wiring — see `preview-bridge-wiring.ts`. ADR-0017 phase 1
  // streaming flows through as a `ReadableStream` when supported.
  const tearBridge = mountPlaygroundPreviewBridge();

  return {
    devServer,
    entryPath,
    updateEntry(content) {
      syncMirror().writeFileSync(entryPath, enc.encode(content));
    },
    async close() {
      tearBridge();
      await devServer.close();
    },
  };
}
