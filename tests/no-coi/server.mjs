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

/** Start the headerless fixture server; resolves with the http.Server. */
export function startNoCoiServer(port, root = FIXTURES_DIR) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const path = normalize(join(root, rel));
    if (!path.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const body = await readFile(path);
      // Deliberately NO Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy.
      res.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
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
