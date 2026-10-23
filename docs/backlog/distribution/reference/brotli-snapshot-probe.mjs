import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { constants, brotliCompressSync, gunzipSync, gzipSync } from 'node:zlib';
const root = process.cwd();
const require = createRequire(`${root}/package.json`);
const { build } = require('esbuild');
const { chromium } = require('@playwright/test');
function compressionFormats() {
  return Object.fromEntries(
    ['gzip', 'br', 'brotli'].map((format) => {
      try {
        new CompressionStream(format);
        return [format, 'accepted'];
      } catch (error) {
        return [format, `${error.name}: ${error.message}`];
      }
    }),
  );
}
const entry = `${root}/packages/workbench/src/glue/dep-snapshot.ts`;
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '/tmp/rifty-brotli-refine/loader.mjs',
});
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'loader',
  outfile: '/tmp/rifty-brotli-refine/loader.js',
});
const { parseDepSnapshot, serializeDepSnapshotTar } = await import(
  '/tmp/rifty-brotli-refine/loader.mjs'
);
const legacy = gunzipSync(
  await readFile(`${root}/apps/playground/public/snapshots/vite-node-modules.json.gz`),
);
const tar = Buffer.from(serializeDepSnapshotTar(parseDepSnapshot(legacy.toString())));
const gz = gzipSync(tar);
const start = performance.now();
const br = brotliCompressSync(tar, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } });
const hash = `sha256:${createHash('sha256').update(tar).digest('hex')}`;
const report = {
  node: process.version,
  nodeCompressionStream: compressionFormats(),
  source: 'committed Vite snapshot converted with current TAR serializer; not a fresh producer run',
  tarBytes: tar.length,
  gzipBytes: gz.length,
  brotli6Bytes: br.length,
  encodeMs: Math.round(performance.now() - start),
  snapshotId: hash,
};
const js = await readFile('/tmp/rifty-brotli-refine/loader.js');
const requests = [];
const server = createServer((req, res) => {
  requests.push({ path: req.url, acceptEncoding: req.headers['accept-encoding'] });
  if (req.url === '/loader.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(js);
    return;
  }
  if (req.url === '/br' || req.url === '/raw-br' || req.url === '/gzip') {
    const bytes = req.url === '/gzip' ? gz : br;
    if (req.url !== '/raw-br')
      res.setHeader('Content-Encoding', req.url === '/gzip' ? 'gzip' : 'br');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', bytes.length);
    res.end(bytes);
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<script src="/loader.js"></script>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  report.chromium = browser.version();
  const page = await browser.newPage();
  report.chromiumCompressionStream = await page.evaluate(compressionFormats);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  report.results = await page.evaluate(async (hash) => {
    const results = [];
    for (const path of ['/br', '/gzip', '/raw-br']) {
      try {
        const r = await loader.fetchVerifiedDepSnapshot(path, hash);
        results.push({
          path,
          status: r.status,
          ...(r.status === 'matched'
            ? { templateId: r.snapshot.templateId, packages: r.snapshot.packages }
            : {}),
        });
      } catch (e) {
        results.push({ path, error: String(e) });
      }
    }
    return results;
  }, hash);
  report.requests = requests.filter((r) => ['/br', '/gzip', '/raw-br'].includes(r.path));
  console.log(JSON.stringify(report, null, 2));
  await writeFile('/tmp/rifty-brotli-refine/result.json', JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
