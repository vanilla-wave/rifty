import { spawnSync } from 'node:child_process';
// Probe: can a WPT file run in the isolate guest through the real testharness.js, the way Node's
// own runner does (test/common/wpt.js + wpt/worker.js), concatenated into one CommonJS file?
// From the repo root after `pnpm --filter @riftydev/isolate-host build`:
//   node docs/backlog/epics/isolate-guest-web-api/reference/wpt/run.mjs [--pin] [--json out.json]
//        [--dist <isolate-host dist dir>]... [--node-only] [test paths relative to WPT root]
// Sources: Node v24.16.0's test/fixtures/wpt (sha256-pinned in wpt.sha256.json; --pin rewrites it),
// cached in $TMPDIR/rifty-wpt-v24.16.0.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../../..');
const BASE = 'https://raw.githubusercontent.com/nodejs/node/v24.16.0/test/fixtures/wpt/';
const cache = join(tmpdir(), 'rifty-wpt-v24.16.0');
const pinFile = join(here, 'wpt.sha256.json');

const argv = process.argv.slice(2);
const take = (flag) => {
  const out = [];
  for (let i = argv.indexOf(flag); i >= 0; i = argv.indexOf(flag)) out.push(argv.splice(i, 2)[1]);
  return out;
};
const pinMode = argv.includes('--pin') && argv.splice(argv.indexOf('--pin'), 1);
const jsonOut = take('--json')[0];
const dists = take('--dist');
const nodeOnly = argv.includes('--node-only') && argv.splice(argv.indexOf('--node-only'), 1);
if (dists.length === 0 && !nodeOnly) dists.push(join(root, 'packages/isolate-host/dist'));
const TESTS = argv.length
  ? argv
  : [
      'FileAPI/blob/Blob-slice.any.js',
      'FileAPI/blob/Blob-constructor.any.js',
      'FileAPI/blob/Blob-text.any.js',
      'FileAPI/file/File-constructor.any.js',
      'encoding/api-basics.any.js',
      'encoding/textdecoder-labels.any.js',
      'encoding/textdecoder-fatal-single-byte.any.js',
      'encoding/encodeInto.any.js',
      'dom/abort/event.any.js',
      'dom/abort/timeout.any.js',
      'dom/abort/abort-signal-any.any.js',
      'dom/events/AddEventListenerOptions-signal.any.js',
      'dom/events/Event-constructors.any.js',
      'dom/events/EventTarget-constructible.any.js',
    ];

const pins = existsSync(pinFile) ? JSON.parse(readFileSync(pinFile, 'utf8')) : {};
async function source(rel) {
  const at = join(cache, rel);
  if (!existsSync(at)) {
    const res = await fetch(BASE + rel);
    if (!res.ok) throw new Error(`fetch ${rel}: ${res.status}`);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, Buffer.from(await res.arrayBuffer()));
  }
  const bytes = readFileSync(at);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (pinMode) {
    pins[rel] = sha;
    writeFileSync(pinFile, `${JSON.stringify(pins, null, 2)}\n`);
  } else if (pins[rel] !== sha)
    throw new Error(`sha256 mismatch for ${rel} (run with --pin to record)`);
  return bytes.toString('utf8');
}

// Node's runner: `// META: script=` dependencies (relative to the test, or root-absolute), then the
// test; `self`, `GLOBAL`, `location`, `META_TITLE` set by an init script (worker.js, wpt.js:627).
// `location` is a plain object here: `URL` is a ceiling in the isolate guest.
async function bundle(test) {
  const code = await source(test);
  const scripts = [];
  for (const m of code.matchAll(/^\/\/ META: script=(.+)$/gm)) {
    const s = m[1].trim();
    scripts.push(s.startsWith('/') ? s.slice(1) : posix.join(posix.dirname(test), s));
  }
  const title = /^\/\/ META: title=(.+)$/m.exec(code)?.[1] ?? '';
  const harness = await source('resources/testharness.js');
  const deps = [];
  for (const s of scripts) deps.push(`//=== ${s}\n${await source(s)}`);
  const href = `http://web-platform.test:8000/${test.replace(/\.any\.js$/, '.any.html')}`;
  // Plain concatenation, no indirect eval: rifty refuses literal `eval` in a CommonJS module
  // (module-loader.cjs-dynamic-function-scope). Sloppy mode, as each script would run on its own.
  return `const __start = Date.now();
globalThis.self = globalThis;
globalThis.GLOBAL = { isWindow() { return false; }, isShadowRealm() { return false; } };
globalThis.location = { href: ${JSON.stringify(href)}, toString() { return this.href; } };
globalThis.META_TITLE = ${JSON.stringify(title)};
// testharness.js builds an AbortController per test when the global is a function; the isolate's
// ceiling thrower is one. Hide it then (a no-op in Node and once the guest has the real class).
let __acHidden = false;
try { new AbortController(); } catch { delete globalThis.AbortController; __acHidden = true; }
const __results = [];
// Synchronous write before exit: console.log to a pipe is async in Node and an exit would cut it.
function __report(r) { require('fs').writeSync(1, '__WPT__' + JSON.stringify(r) + '\\n'); process.exit(0); }
// Node's runner ends the worker at completion; a test's open handle (a MessagePort) must not keep this
// process alive, so the report exits.
const __keep = setTimeout(() => { __report({ timeout: true, results: __results }); }, 30000);
//=== resources/testharness.js
${harness}
add_result_callback((r) => __results.push(r.status === 0 ? { name: r.name, status: 0 } : { name: r.name, status: r.status, message: r.message }));
add_completion_callback((_, status) => {
  clearTimeout(__keep);
  __report({ acHidden: __acHidden, harness: status.status, ms: Date.now() - __start, results: __results });
});
${deps.join('\n')}
//=== ${test}
${code}
`;
}

const STATUS = ['PASS', 'FAIL', 'TIMEOUT', 'NOTRUN', 'PRECONDITION_FAILED'];
function parse(stdout, stderr, exitCode, wallMs) {
  const line = stdout.split('\n').find((l) => l.startsWith('__WPT__'));
  if (!line)
    return {
      error: `exit ${exitCode}: ${(stderr || stdout).split('\n').slice(0, 3).join(' | ')}`,
      wallMs,
    };
  const r = JSON.parse(line.slice(7));
  const counts = {};
  for (const t of r.results) counts[STATUS[t.status]] = (counts[STATUS[t.status]] ?? 0) + 1;
  return { ...r, counts, wallMs, exitCode };
}

function inNode(file) {
  const dir = mkdtempSync(join(tmpdir(), 'wpt-probe-'));
  try {
    writeFileSync(join(dir, 't.cjs'), file);
    const t0 = performance.now();
    const r = spawnSync(process.execPath, ['t.cjs'], { cwd: dir, env: {}, encoding: 'utf8' });
    return parse(r.stdout, r.stderr, r.status, Math.round(performance.now() - t0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
async function inSandbox(createSandbox, file) {
  const sb = await createSandbox();
  try {
    await sb.writeFile('t.cjs', file);
    const t0 = performance.now();
    const r = await sb.exec('t.cjs', { timeoutMs: 60_000, maxOutputBytes: 32 * 2 ** 20 });
    return parse(r.stdout, r.stderr, r.exitCode, Math.round(performance.now() - t0));
  } finally {
    await sb.destroy();
  }
}

// Kept: counts, timings, and per guest the subtests whose status differs from live Node's (first 20).
function compact(row, names) {
  const strip = ({ results, ...rest }) => rest;
  const byName = new Map((row.node.results ?? []).map((t) => [t.name, t]));
  const c = { bytes: row.bytes, node: strip(row.node) };
  for (const n of names) {
    const g = row[n];
    if (!g.results) {
      c[n] = g;
      continue;
    }
    const diff = g.results.filter((t) => byName.get(t.name)?.status !== t.status);
    const missing = [...byName.keys()].filter((k) => !g.results.some((t) => t.name === k)).length;
    c[n] = {
      ...strip(g),
      differFromNode: diff.length,
      notRunVsNode: missing,
      firstDiffs: diff.slice(0, 20),
    };
  }
  return c;
}
const out = { node: process.version, tests: {} };
const hosts = [];
for (const d of dists) {
  const { createSandbox } = await import(pathToFileURL(join(d, 'index.js')).href);
  hosts.push([d.replace(`${root}/`, ''), createSandbox]);
}
for (const test of TESTS) {
  const file = await bundle(test);
  const row = { bytes: file.length, node: inNode(file) };
  for (const [name, createSandbox] of hosts) row[name] = await inSandbox(createSandbox, file);
  out.tests[test] = compact(
    row,
    hosts.map(([n]) => n),
  );
  const fmt = (r) =>
    r.error
      ? `ERROR ${r.error}`
      : `${JSON.stringify(r.counts)} harness=${r.harness ?? 'timeout'} ${r.ms ?? '-'}ms (wall ${r.wallMs}ms)${r.differFromNode === undefined ? '' : ` differ=${r.differFromNode} missing=${r.notRunVsNode}`}`;
  const c = out.tests[test];
  console.log(`${test}\n  node: ${fmt(c.node)}`);
  for (const [name] of hosts) console.log(`  ${name}: ${fmt(c[name])}`);
}
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(out, null, 2)}\n`);
