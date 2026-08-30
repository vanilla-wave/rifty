#!/usr/bin/env node
/**
 * Headerless static server for the no-COI substrate lane.
 *
 * Serves `tests/no-coi/fixtures/` over plain HTTP with NO COOP/COEP headers —
 * the load-bearing property: on this page real Chromium reports
 * `crossOriginIsolated === false` and defines NO `SharedArrayBuffer` global
 * binding (while shared `WebAssembly.Memory` still constructs — probe row 2).
 * Never add isolation headers here; the whole lane exists to be un-isolated.
 *
 * Reused as a module by `tools/probes/no-coi-realm-probe.mjs` (replayable
 * evidence driver for `docs/backlog/runtime-js/reference/no-coi-degradation-probes.md`).
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures', import.meta.url));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
};

const INJECT_HEADERS = {
  coop: ['cross-origin-opener-policy', 'same-origin'],
  coep: ['cross-origin-embedder-policy', 'require-corp'],
};

/**
 * Start the headerless fixture server; resolves with the http.Server.
 *
 * `inject` (negative-control harness ONLY — `header-provenance.no-coi.spec.ts`):
 * - `{header: 'coop'|'coep', path}` — serve ONE isolation header on ONE path,
 *   ONLY on actually-consumed destinations (`Sec-Fetch-Dest` present and not
 *   'empty') — the adversarial server an ordinary re-fetch sweep cannot see;
 *   the consumed-response provenance pins must still catch it.
 * - `{status, path}` — serve that non-200 status on ONE path (body replaced) so
 *   the harness's consumed-non-200 arm is exercised against a REAL class path.
 */
export function startNoCoiServer(port, { inject } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const path = normalize(join(FIXTURES_DIR, rel));
    if (!path.startsWith(FIXTURES_DIR)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (inject !== undefined && inject.status !== undefined && url.pathname === inject.path) {
      res.writeHead(inject.status).end('injected non-200');
      return;
    }
    try {
      const body = await readFile(path);
      // Deliberately NO Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy.
      const headers = {
        'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      };
      const dest = req.headers['sec-fetch-dest'];
      if (
        inject !== undefined &&
        inject.header !== undefined &&
        url.pathname === inject.path &&
        dest !== undefined &&
        dest !== 'empty'
      ) {
        const [name, value] = INJECT_HEADERS[inject.header];
        headers[name] = value;
      }
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const port = Number(process.env.RIFTY_NO_COI_PORT ?? 5307);
  await startNoCoiServer(port);
  console.log(`[no-coi] headerless server on http://localhost:${port}/ (no COOP/COEP)`);
}
