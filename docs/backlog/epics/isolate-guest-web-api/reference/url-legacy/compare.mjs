import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
// rifty's legacy node:url vs live Node v24.16.0 over cases.json (collect.cjs).
// From the repo root, after `pnpm install && pnpm --filter @riftydev/isolate-host build`:
//   node docs/backlog/epics/isolate-guest-web-api/reference/url-legacy/compare.mjs [--json results.json]
// (a) isolate: the built guest bundle, `runCode` (URL a ceiling, absent when the runtime loads);
// (b) "URL present": runtime-js `builtins/url.ts` bundled by esbuild and loaded in Node, whose
//     global URL stands in for the browser hosts' native one (same source every host ships).
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../../..');
const require = createRequire(import.meta.url);
const { normalize } = require('./normalize.cjs');
const { replay } = require('./replay.cjs');
const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'));
const jsonOut = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : null;

// (b) runtime-js url.ts in Node.
const { build } = createRequire(join(root, 'packages/isolate-guest/package.json'))('esbuild');
const out = join(mkdtempSync(join(tmpdir(), 'url-legacy-')), 'url.cjs');
await build({
  entryPoints: [join(root, 'packages/runtime-js/src/builtins/url.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'neutral',
  outfile: out,
  logLevel: 'error',
});
const riftyUrl = require(out).default;
const present = cases.map((c) => normalize(() => replay(riftyUrl, c)));

// (a) isolate guest.
const { runCode } = await import(
  pathToFileURL(join(root, 'packages/isolate-host/dist/index.js')).href
);
const guestCode = `${readFileSync(join(here, 'normalize.cjs'), 'utf8').replace(/module\.exports.*$/m, '')}
${readFileSync(join(here, 'replay.cjs'), 'utf8').replace(/module\.exports.*$/m, '')}
const url = require('url');
const cases = ${JSON.stringify(cases.map(({ fn, args }) => ({ fn, args })))};
process.stdout.write(JSON.stringify(cases.map((c) => normalize(() => replay(url, c)))));`;
const r = await runCode(guestCode, { timeoutMs: 60000, maxOutputBytes: 64 << 20 });
if (r.exitCode !== 0) throw new Error(`guest exit ${r.exitCode}: ${r.stderr.slice(0, 2000)}`);
const isolate = JSON.parse(r.stdout);

// Lax: a parse/resolveObject record by its 12 legacy fields only (missing ≡ undefined ≡ null),
// prototype and key order ignored — "values wrong", not just "shape not Node's".
const FIELDS = [
  'protocol',
  'slashes',
  'auth',
  'host',
  'port',
  'hostname',
  'hash',
  'search',
  'query',
  'pathname',
  'path',
  'href',
];
const lax = (r, fields = FIELDS) => {
  const o = r?.ok;
  if (!o || typeof o !== 'object' || !('$keys' in o))
    return r?.throw ? { throw: r.throw.code ?? r.throw.name } : r;
  const n = (v) => (v == null || v?.$undefined ? null : v?.$keys ? lax({ ok: v }) : v);
  return Object.fromEntries(fields.map((f) => [f, n(o[f])]));
};
const report = {};
for (const [lane, results] of [
  ['isolate', isolate],
  ['urlPresent', present],
]) {
  const byFn = {};
  const examples = [];
  cases.forEach((c, i) => {
    byFn[c.fn] ??= { cases: 0, differ: 0, differLax: 0, differLaxNoPath: 0 };
    const s = byFn[c.fn];
    s.cases++;
    if (!isDeepStrictEqual(lax(c.node), lax(results[i]))) s.differLax++;
    const noPath = FIELDS.filter((f) => f !== 'path');
    if (!isDeepStrictEqual(lax(c.node, noPath), lax(results[i], noPath))) s.differLaxNoPath++;
    if (!isDeepStrictEqual(c.node, results[i])) {
      s.differ++;
      if (examples.filter((e) => e.fn === c.fn).length < 4)
        examples.push({ fn: c.fn, args: c.args, node: c.node, rifty: results[i] });
    }
  });
  const total = Object.values(byFn).reduce((a, s) => a + s.differ, 0);
  report[lane] = { differ: total, of: cases.length, byFn, examples };
  console.log(lane, `${total}/${cases.length} differ`, JSON.stringify(byFn));
}
if (jsonOut)
  writeFileSync(jsonOut, `${JSON.stringify({ node: process.version, report }, null, 1)}\n`);
