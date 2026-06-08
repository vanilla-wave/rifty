/**
 * `@rifty-examples/vite-like-dev` — a tiny Vite-equivalent dev server.
 *
 * This is the M10 demo: it shows the runtime can host a real dev-server
 * pattern entirely in the browser without ever shelling out to Node. Vite
 * itself has hundreds of transitive deps and edge cases; the pattern that
 * matters — HTTP for static + JS, fs.watch for change detection, WebSocket
 * for HMR — is what we exercise here.
 *
 * What it does NOT do (yet):
 *   - real TS / JSX transformation (esbuild.wasm shadow-binding lands later)
 *   - ESM rewriting for bare specifiers (M10 follow-up)
 *   - source maps
 *   - dependency pre-bundling
 *
 * What it DOES demonstrate end-to-end:
 *   - `npm run dev`-style entry point (call `startDevServer({ ... })`)
 *   - HTML / JS served from the in-Worker VFS via `@riftydev/net.http`
 *   - file changes picked up by polling `fs.watch`
 *   - HMR notifications over `@riftydev/net.WebSocketServer`
 *   - HMR client injected into the served HTML
 */

import { WebSocketServer, createHttpServer } from '@riftydev/net';
import { type FSWatcher, watch } from '@riftydev/runtime-js/builtins/fs-watch';
import { isAbsolute, joinPath, normalizePath, syncMirror } from '@riftydev/vfs';

/**
 * Pluggable HMR transport. Lets an embedder (e.g. the rifty playground) route
 * change notifications over its own channel and inject a matching client.
 */
export interface HmrTransport {
  /** Broadcast a JSON HMR payload to connected clients. */
  broadcast(payload: string): void;
  /** Client `<script>…</script>` injected into served HTML (replaces the built-in WS client). */
  clientScript: string;
}

export interface DevServerOptions {
  /** VFS path to the project root (must contain `index.html`). */
  root: string;
  /** HTTP + WS port the server listens on. */
  port: number;
  /** fs.watch poll interval (ms). Defaults to 100 ms in dev, dropped for tests. */
  watchInterval?: number;
  /**
   * Override the HMR transport. When provided, served HTML embeds
   * `hmr.clientScript` instead of the built-in native-`WebSocket` client and
   * file-change notifications also broadcast through `hmr.broadcast`. The
   * playground passes its cross-realm `BroadcastChannel` bridge here so HMR
   * reaches the preview iframe — a separate realm the in-process
   * `WebSocketServer` can't reach (no real TCP, no SW WS upgrade). Omit for the
   * built-in same-realm WS client.
   */
  hmr?: HmrTransport;
}

export interface DevServer {
  readonly port: number;
  close(): Promise<void>;
}

const HMR_PATH = '/__hmr';

const HMR_CLIENT_SCRIPT = `
<script>
// rifty:hmr client
(function () {
  if (typeof WebSocket === 'undefined') return;
  var ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '${HMR_PATH}');
  ws.addEventListener('message', function (event) {
    var msg;
    try { msg = JSON.parse(event.data); } catch (_) { return; }
    if (msg.type === 'update') {
      // Naive HMR: reload. Real ESM HMR would re-fetch the changed module
      // and call any registered accept callbacks — out of scope for this demo.
      location.reload();
    }
  });
})();
</script>`;

function ctype(path: string): string {
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.ts')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function resolveRoot(root: string, path: string): string {
  return normalizePath(isAbsolute(path) ? joinPath(root, path) : joinPath(root, path));
}

export async function startDevServer(opts: DevServerOptions): Promise<DevServer> {
  const root = normalizePath(opts.root);
  const interval = opts.watchInterval ?? 100;
  const decoder = new TextDecoder();

  const wss = new WebSocketServer({ port: opts.port, path: HMR_PATH });

  // HMR client injected into served HTML + the broadcast sink. With a custom
  // `hmr` transport (the playground's cross-realm bridge) we inject its client
  // and fan changes out to both the in-process WSS and that bridge; without it
  // we keep the built-in same-realm WebSocket path.
  const clientScript = opts.hmr?.clientScript ?? HMR_CLIENT_SCRIPT;
  const broadcast = (payload: string): void => {
    wss.broadcast(payload);
    opts.hmr?.broadcast(payload);
  };

  const http = createHttpServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/index.html') {
      try {
        const bytes = syncMirror().readFileBytesSync(joinPath(root, 'index.html'));
        let html = decoder.decode(bytes);
        const idx = html.lastIndexOf('</body>');
        html = idx >= 0 ? html.slice(0, idx) + clientScript + html.slice(idx) : html + clientScript;
        res.writeHead(200, { 'content-type': ctype('.html') });
        res.end(html);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('index.html not found in root');
      }
      return;
    }

    try {
      const bytes = syncMirror().readFileBytesSync(resolveRoot(root, pathname));
      res.writeHead(200, { 'content-type': ctype(pathname) });
      res.end(bytes);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(`Not found: ${pathname}`);
    }
  });

  http.listen(opts.port);

  // Watch the project root recursively (we only have a non-recursive watcher;
  // watch root + src as the demo's "interesting" subtree).
  const watchers: FSWatcher[] = [];
  const targets = [root, joinPath(root, 'src')];
  for (const t of targets) {
    try {
      const w = watch(t, { interval }, (event, filename) => {
        if (!filename) return;
        // Translate the disk path back to a server-relative URL.
        const fullPath = joinPath(t, filename);
        const rel = fullPath.slice(root.length) || '/';
        broadcast(JSON.stringify({ type: 'update', event, path: rel }));
      });
      watchers.push(w);
    } catch {
      // Directory may not exist yet — fine, watcher is best-effort.
    }
  }

  return {
    port: opts.port,
    async close() {
      for (const w of watchers) w.close();
      wss.close();
      http.close();
    },
  };
}
