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
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { isAbsolute, joinPath, normalizePath, syncMirror } from '@riftydev/vfs';
import { parse } from 'acorn';

type ModuleLoader = ReturnType<typeof createModuleLoader>;
type TransformLoader = 'ts' | 'tsx' | 'jsx' | 'js';

export interface TransformRequest {
  readonly path: string;
  readonly root: string;
  readonly source: string;
  readonly loader: TransformLoader;
}

export type TransformModule = (request: TransformRequest) => Promise<string>;

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
  /**
   * Transform TS/TSX/JSX modules before serving. Defaults to the real vendored
   * esbuild WASI binding; tests may inject the same shape to pin arguments.
   */
  transformModule?: TransformModule;
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
  if (
    path.endsWith('.js') ||
    path.endsWith('.mjs') ||
    path.endsWith('.jsx') ||
    path.endsWith('.ts') ||
    path.endsWith('.tsx')
  ) {
    return 'text/javascript; charset=utf-8';
  }
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function resolveRoot(root: string, path: string): string {
  return normalizePath(isAbsolute(path) ? joinPath(root, path) : joinPath(root, path));
}

function resolveRequestPath(root: string, pathname: string): string {
  if (pathname.startsWith('/@fs/')) {
    return normalizePath(`/${decodeURIComponent(pathname.slice('/@fs/'.length))}`);
  }
  return resolveRoot(root, pathname);
}

function isDeclarationFile(path: string): boolean {
  return /\.d\.(?:ts|cts|mts)$/.test(path);
}

function moduleLoaderForPath(path: string): TransformLoader | null {
  if (isDeclarationFile(path)) return null;
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.ts')) return 'ts';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'js';
  return null;
}

let cachedEsbuildWasm: Uint8Array<ArrayBuffer> | null = null;

async function defaultTransformModule(request: TransformRequest): Promise<string> {
  const [{ runWasi }, { loadVendoredEsbuildWasm, transformWithEsbuild }] = await Promise.all([
    import('@riftydev/runtime-wasi'),
    import('@riftydev/shadow-registry/esbuild-binding'),
  ]);
  if (cachedEsbuildWasm === null) {
    const raw = loadVendoredEsbuildWasm();
    const wasmBuffer = new ArrayBuffer(raw.byteLength);
    cachedEsbuildWasm = new Uint8Array(wasmBuffer);
    cachedEsbuildWasm.set(raw);
  }
  const result = await transformWithEsbuild(runWasi, cachedEsbuildWasm, {
    source: request.source,
    loader: request.loader,
    workspace: request.root,
    format: 'esm',
    jsx: request.loader === 'tsx' || request.loader === 'jsx' ? 'automatic' : undefined,
    supported: { decorators: false },
  });
  return result.code;
}

interface BaseNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

interface LiteralNode extends BaseNode {
  readonly type: 'Literal';
  readonly value: unknown;
}

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly value: string;
}

function rewriteBareSpecifiers(source: string, filePath: string, root: string): string {
  const ast = parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowHashBang: true,
  }) as unknown as BaseNode;
  const loader = createModuleLoader(syncMirror(), {
    cwd: root,
    autoDiscoverTsconfigPaths: true,
  });
  const replacements: Replacement[] = [];

  visitNode(ast, (node) => {
    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
    ) {
      maybeRewriteLiteral(node.source, replacements, loader, filePath, root);
      return;
    }
    if (node.type === 'ImportExpression') {
      maybeRewriteLiteral(node.source, replacements, loader, filePath, root);
    }
  });

  let out = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, replacement.start)}${JSON.stringify(replacement.value)}${out.slice(
      replacement.end,
    )}`;
  }
  return out;
}

function visitNode(node: BaseNode, cb: (node: BaseNode) => void): void {
  cb(node);
  for (const value of Object.values(node)) {
    if (isNode(value)) {
      visitNode(value, cb);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) visitNode(item, cb);
      }
    }
  }
}

function isNode(value: unknown): value is BaseNode {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.type === 'string' &&
    typeof record.start === 'number' &&
    typeof record.end === 'number'
  );
}

function maybeRewriteLiteral(
  value: unknown,
  replacements: Replacement[],
  loader: ModuleLoader,
  filePath: string,
  root: string,
): void {
  if (!isStringLiteral(value) || isProtocolSpecifier(value.value)) return;
  if (isBrowserResolvableSpecifier(value.value) && hasExplicitFileExtension(value.value)) return;
  const { path, suffix } = splitSpecifierSuffix(value.value);
  const resolved = loader.resolver.resolve(path.startsWith('/') ? `.${path}` : path, {
    fromFile: path.startsWith('/') ? joinPath(root, 'index.js') : filePath,
    esm: true,
  });
  replacements.push({
    start: value.start,
    end: value.end,
    value: `${filePathToServedUrl(root, resolved.id)}${suffix}`,
  });
}

function isStringLiteral(value: unknown): value is LiteralNode & { readonly value: string } {
  return isNode(value) && value.type === 'Literal' && typeof value.value === 'string';
}

function isBrowserResolvableSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/') ||
    isProtocolSpecifier(specifier)
  );
}

function isProtocolSpecifier(specifier: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier);
}

function hasExplicitFileExtension(specifier: string): boolean {
  const path = specifier.split(/[?#]/u, 1)[0] ?? specifier;
  const lastSlash = path.lastIndexOf('/');
  const lastSegment = path.slice(lastSlash + 1);
  return /\.[^./]+$/u.test(lastSegment);
}

function splitSpecifierSuffix(specifier: string): {
  readonly path: string;
  readonly suffix: string;
} {
  const suffixIndex = specifier.search(/[?#]/u);
  if (suffixIndex === -1) return { path: specifier, suffix: '' };
  return { path: specifier.slice(0, suffixIndex), suffix: specifier.slice(suffixIndex) };
}

function filePathToServedUrl(root: string, filePath: string): string {
  if (filePath === root) return '/';
  if (filePath.startsWith(`${root}/`))
    return encodeServedPath(`/${filePath.slice(root.length + 1)}`);
  return `/@fs${encodeServedPath(filePath)}`;
}

function encodeServedPath(path: string): string {
  return path
    .split('/')
    .map((part, index) => (index === 0 ? '' : encodeURIComponent(part)))
    .join('/');
}

export async function startDevServer(opts: DevServerOptions): Promise<DevServer> {
  const root = normalizePath(opts.root);
  const interval = opts.watchInterval ?? 100;
  const decoder = new TextDecoder();
  const transformModule = opts.transformModule ?? defaultTransformModule;

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
    void (async () => {
      const url = new URL(req.url, 'http://x');
      const pathname = url.pathname;

      if (pathname === '/' || pathname === '/index.html') {
        try {
          const bytes = syncMirror().readFileBytesSync(joinPath(root, 'index.html'));
          let html = decoder.decode(bytes);
          const idx = html.lastIndexOf('</body>');
          html =
            idx >= 0 ? html.slice(0, idx) + clientScript + html.slice(idx) : html + clientScript;
          res.writeHead(200, { 'content-type': ctype('.html') });
          res.end(html);
        } catch {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('index.html not found in root');
        }
        return;
      }

      const filePath = resolveRequestPath(root, pathname);
      let bytes: Uint8Array;
      try {
        bytes = syncMirror().readFileBytesSync(filePath);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end(`Not found: ${pathname}`);
        return;
      }

      if (isDeclarationFile(filePath)) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(`Declaration files are not runnable modules: ${pathname}`);
        return;
      }

      const loader = moduleLoaderForPath(filePath);
      if (loader === null) {
        res.writeHead(200, { 'content-type': ctype(pathname) });
        res.end(bytes);
        return;
      }
      try {
        const source = decoder.decode(bytes);
        const transformed =
          loader === 'js'
            ? source
            : await transformModule({ path: filePath, root, source, loader });
        res.writeHead(200, { 'content-type': ctype(pathname) });
        res.end(rewriteBareSpecifiers(transformed, filePath, root));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(`Transform failed for ${pathname}: ${detail}`);
      }
    })();
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
