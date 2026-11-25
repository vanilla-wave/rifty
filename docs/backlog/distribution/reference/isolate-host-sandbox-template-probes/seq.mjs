#!/usr/bin/env node --no-node-snapshot
/**
 * Template probe S — the layered FS (`layered.ts`) through operation sequences, against real
 * `node` over a real directory (the oracle: a temp dir read as `/`, the same template laid out
 * with the same times, the same program). Three paths per sequence:
 *   guest   — the program runs in a fresh isolate over a LayeredFs (rifty's fs → FsSync), the
 *             run's difference is captured there, applied by the consumer over a fresh
 *             LayeredFs, and the consumer's view is compared with Node's tree;
 *   host    — host-op sequences (sandbox.ts semantics: writeFile creates parents) run on the
 *             consumer's LayeredFs, compared with Node doing the same calls;
 *   mixed   — host ops, then a run, then the host's view.
 * Also: every consumer state round-trips through toWire() → fromWire() unchanged, and the
 * changed-paths list between the two views equals a walk of Node's before/after.
 *
 *   node --no-node-snapshot docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/seq.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repo = fileURLToPath(new URL('../../../../..', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
const guestPkg = join(repo, 'packages/isolate-guest');
const ivm = createRequire(join(repo, 'packages/isolate-host/package.json'))('isolated-vm');
const { createHostBridge } = await import(join(guestPkg, 'dist/index.js'));
const nodePaths = [join(guestPkg, 'node_modules')];

// Consumer realm: the layered FS + codec, from source.
const realmFile = join(tmpdir(), `seq-realm-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `export * from ${JSON.stringify(join(here, 'layered.ts'))};
export { MemoryFsSync } from '@riftydev/vfs/internal';
export { snapshotFs, restoreFs } from './src/snapshot.ts';`,
    resolveDir: guestPkg,
    loader: 'ts',
  },
  nodePaths,
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: realmFile,
  logLevel: 'warning',
});
const R = await import(pathToFileURL(realmFile).href);
rmSync(realmFile);
// Guest bundle: the real entry + a LayeredFs installed as the realm's sync FS.
const bundleFile = join(tmpdir(), `seq-guest-${process.pid}.js`);
await build({
  absWorkingDir: guestPkg,
  stdin: {
    contents: `import './entry.ts';
import { MemoryFsSync, setSyncMirror } from '@riftydev/vfs/internal';
import { LayeredFs, templateLayer } from ${JSON.stringify(join(here, 'layered.ts'))};
import { restoreFs, snapshotFs } from '../snapshot.ts';
let L;
const opts = { template: null, maxBytes: 1 << 30 };
Object.defineProperty(globalThis, '__seq', { value: Object.freeze({
  install(pack, rows, blob, refs) {
    const e = new MemoryFsSync();
    restoreFs(e, blob, opts);
    L = LayeredFs.fromWire(templateLayer(pack, JSON.parse(rows)), e, JSON.parse(refs));
    setSyncMirror(L);
  },
  capture() {
    const w = L.toWire();
    return { blob: snapshotFs(w.entries, opts), refs: JSON.stringify(w.refs) };
  },
}), configurable: true });`,
    resolveDir: join(guestPkg, 'src/guest'),
    loader: 'ts',
  },
  nodePaths,
  inject: ['src/guest/web-shim.ts'],
  ignoreAnnotations: true,
  outfile: bundleFile,
  bundle: true,
  target: 'es2022',
  logLevel: 'warning',
  legalComments: 'none',
  platform: 'browser',
  format: 'iife',
  external: ['node:module'],
});
const bundle = readFileSync(bundleFile, 'utf8');
rmSync(bundleFile);

// ---- the template -------------------------------------------------------------------
const T0 = 1_600_000_000_000;
const T1 = 1_650_000_000_000;
const TPL = {
  '/node_modules/a/package.json': '{"main":"index.js"}',
  '/node_modules/a/index.js': "module.exports = 'a';",
  '/node_modules/a/lib/x.js': "module.exports = 'x';",
  '/node_modules/a/lib/y.js': "module.exports = 'y';",
  '/node_modules/b/index.js': "module.exports = 'b';",
};
const enc = new TextEncoder();
function packOf() {
  const files = Object.entries(TPL).map(([p, t]) => [p, enc.encode(t)]);
  const dirs = new Set(['/']);
  for (const [p] of files) {
    const parts = p.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) dirs.add(`/${parts.slice(0, i).join('/')}`);
  }
  const pack = new Uint8Array(files.reduce((n, [, d]) => n + d.length, 0));
  const rows = [...dirs].sort().map((d) => [1, d, 0, 0, T0, T0, T0, T0]);
  let off = 0;
  for (const [p, d] of files) {
    pack.set(d, off);
    rows.push([2, p, off, d.length, T0, T0, T0, T0]);
    off += d.length;
  }
  return { pack, rows };
}
const { pack, rows } = packOf();
const lower = () => R.templateLayer(pack, rows);
const OPTS = { template: null, maxBytes: 1 << 30 };

/** A fresh sandbox over the template: /workspace, /tmp. */
function fresh() {
  const L = new R.LayeredFs(lower());
  for (const d of ['/workspace', '/tmp']) L.mkdirSync(d, { recursive: true });
  return L;
}
/** Consumer view: path → kind, size, sha, file mtime (template-era or 'now'). */
function viewOf(fs, root = '/') {
  const out = {};
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir)) {
      const p = dir === '/' ? `/${d.name}` : `${dir}/${d.name}`;
      const st = fs.statSync(p);
      if (st.isDirectory) {
        out[p] = 'dir';
        walk(p);
      } else {
        const bytes = fs.readFileBytesSync(p);
        const m = st.mtime < 1.7e12 ? st.mtime : 'now';
        out[p] =
          `file ${bytes.length} ${createHash('sha1').update(bytes).digest('hex').slice(0, 8)} ${m}`;
      }
    }
  };
  walk(root);
  return out;
}
function nodeView(root) {
  const out = {};
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const p = `${rel}/${name}`;
      const st = statSync(abs);
      if (st.isDirectory()) {
        out[p] = 'dir';
        walk(abs, p);
      } else {
        const bytes = readFileSync(abs);
        const m = st.mtimeMs < 1.7e12 ? Math.round(st.mtimeMs) : 'now';
        out[p] =
          `file ${bytes.length} ${createHash('sha1').update(bytes).digest('hex').slice(0, 8)} ${m}`;
      }
    }
  };
  walk(root, '');
  return out;
}
function nodeRoot() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'seq-')));
  for (const d of ['workspace', 'tmp']) mkdirSync(join(root, d));
  for (const [p, t] of Object.entries(TPL)) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  const touch = (abs) => {
    utimesSync(abs, T0 / 1000, T0 / 1000);
    if (statSync(abs).isDirectory()) for (const n of readdirSync(abs)) touch(join(abs, n));
  };
  touch(join(root, 'node_modules'));
  return root;
}
/** Changed paths between two views (the design derives them over the nodes held; here, a walk). */
function changesOf(before, after) {
  const a = viewOf(before);
  const b = viewOf(after);
  return nodeChanges(a, b);
}
function nodeChanges(a, b) {
  const out = [];
  for (const p of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const ka =
      a[p] === undefined ? null : a[p] === 'dir' ? 'dir' : a[p].split(' ').slice(0, 3).join(' ');
    const kb =
      b[p] === undefined ? null : b[p] === 'dir' ? 'dir' : b[p].split(' ').slice(0, 3).join(' ');
    if (ka === kb) continue;
    if (out.some((q) => q.type === 'deleted' && p.startsWith(`${q.path}/`))) continue;
    out.push({ path: p, type: ka === null ? 'created' : kb === null ? 'deleted' : 'changed' });
  }
  return out;
}

// ---- guest runs -----------------------------------------------------------------------
let cachedData;
async function run(state, program) {
  const out = [];
  const g = {};
  const { functions, timeOrigin, close } = createHostBridge({
    write: (_fd, b) => out.push(Buffer.from(b).toString()),
    fire: (id) => g.fire.apply(undefined, [id]),
  });
  const iso = new ivm.Isolate({ memoryLimit: 256 });
  try {
    const context = await iso.createContext();
    const names = Object.keys(functions);
    await context.evalClosure(
      `globalThis.__riftyIsolateHost = { timeOrigin: ${timeOrigin}, ${names.map((n, i) => `${n}: $${i}`).join(', ')} };`,
      names.map((n) => new ivm.Callback(functions[n])),
    );
    const script = await iso.compileScript(bundle, {
      filename: 'g.js',
      ...(cachedData ? { cachedData } : { produceCachedData: true }),
    });
    if (!cachedData) cachedData = script.cachedData;
    await script.run(context);
    const entry = await context.global.get('__riftyGuest', { reference: true });
    const seq = await context.global.get('__seq', { reference: true });
    g.fire = await entry.get('fire', { reference: true });
    // The state: the consumer's difference plus the program.
    state.writeFileSync('/workspace/main.js', enc.encode(program));
    const d = state.toWire();
    await (await seq.get('install', { reference: true })).apply(
      undefined,
      [
        new Uint8Array(pack),
        JSON.stringify(rows),
        R.snapshotFs(d.entries, OPTS),
        JSON.stringify(d.refs),
      ],
      { arguments: { copy: true } },
    );
    const code = await (await entry.get('runFile', { reference: true })).apply(
      undefined,
      ['/workspace/main.js', []],
      {
        arguments: { copy: true },
        result: { promise: true, copy: true },
      },
    );
    const cap = await (await seq.get('capture', { reference: true })).apply(undefined, [], {
      result: { copy: true },
    });
    // The consumer: validate (codec) and apply over a fresh template view.
    const entries = new R.MemoryFsSync();
    R.restoreFs(entries, cap.blob, OPTS);
    const next = R.LayeredFs.fromWire(lower(), entries, JSON.parse(cap.refs));
    return { code, stdout: out.join(''), next };
  } finally {
    close();
    if (!iso.isDisposed) iso.dispose();
  }
}

// Program: each op logged as [name, code|'ok']; paths under P (Node: the temp root, guest: '').
const prog = (ops) => `const fs = require('fs');
const P = process.argv[2] || '';
const log = [];
const ops = ${JSON.stringify(ops)};
for (const [op, a, b, c] of ops) {
  try {
    if (op === 'write') fs.writeFileSync(P + a, b);
    else if (op === 'rm') fs.rmSync(P + a, b);
    else if (op === 'mkdir') fs.mkdirSync(P + a, b);
    else if (op === 'rename') fs.renameSync(P + a, P + b);
    else if (op === 'utimes') fs.utimesSync(P + a, b / 1000, b / 1000);
    else if (op === 'copy') fs.copyFileSync(P + a, P + b);
    else if (op === 'cp') fs.cpSync(P + a, P + b, { recursive: true });
    else if (op === 'read') log.push([op, a, fs.readFileSync(P + a, 'utf8')]);
    else if (op === 'require') log.push([op, a, require(P + a)]);
    if (op !== 'read' && op !== 'require') log.push([op, a, 'ok']);
  } catch (e) { log.push([op, a, e.code]); }
}
console.log(JSON.stringify(log));`;

const SAME = "module.exports = 'a';";
const GUEST = {
  'remove → write same path': [
    ['rm', '/node_modules/a/index.js'],
    ['write', '/node_modules/a/index.js', 'new'],
  ],
  'remove dir → write child (no dir)': [
    ['rm', '/node_modules/a', { recursive: true }],
    ['write', '/node_modules/a/new.js', 'n'],
  ],
  'remove dir → mkdir → write child': [
    ['rm', '/node_modules/a', { recursive: true }],
    ['mkdir', '/node_modules/a'],
    ['write', '/node_modules/a/new.js', 'n'],
  ],
  'rmdir + mkdir (lower children gone)': [
    ['rm', '/node_modules/a/lib', { recursive: true }],
    ['mkdir', '/node_modules/a/lib'],
  ],
  'rename a template dir': [
    ['rename', '/node_modules/a', '/node_modules/c'],
    ['require', '/node_modules/c/lib/x.js'],
  ],
  'move a template file out': [['rename', '/node_modules/b/index.js', '/workspace/b.js']],
  'move a file in': [
    ['write', '/workspace/z.js', 'z'],
    ['rename', '/workspace/z.js', '/node_modules/b/z.js'],
  ],
  'rename a dir onto a non-empty template dir': [['rename', '/node_modules/b', '/node_modules/a']],
  'utimes a template file': [['utimes', '/node_modules/a/index.js', T1]],
  'overwrite with the same bytes': [['write', '/node_modules/a/index.js', SAME]],
  'write on a directory path': [['write', '/node_modules/a', 'x']],
  'mkdir an existing template dir': [['mkdir', '/node_modules/a']],
  'rm a non-empty template dir, not recursive': [['rm', '/node_modules/a']],
  'copy a template file out': [['copy', '/node_modules/a/index.js', '/workspace/i.js']],
  // N2 (review of 9624b9c9d → ee8614363): regressions the generator (gen.mjs) also finds.
  'N2a: rename a template dir, then mkdir it again': [
    ['rename', '/node_modules/a', '/node_modules/c'],
    ['mkdir', '/node_modules/a'],
  ],
  'N2b: a template file becomes a dir with a child': [
    ['rm', '/node_modules/a/index.js'],
    ['mkdir', '/node_modules/a/index.js'],
    ['write', '/node_modules/a/index.js/k.js', 'k'],
  ],
  'N2b: a template dir becomes a file': [
    ['rm', '/node_modules/a/lib', { recursive: true }],
    ['write', '/node_modules/a/lib', 'f'],
  ],
  'N2: B → A after A → C': [
    ['rename', '/node_modules/a', '/node_modules/c'],
    ['rename', '/node_modules/b', '/node_modules/a'],
  ],
  'N2: rename onto an existing template file': [
    ['rename', '/node_modules/b/index.js', '/node_modules/a/index.js'],
  ],
  'cp merging into an existing template dir': [['cp', '/node_modules/b', '/node_modules/a']],
};

const results = [];
const report = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      ${JSON.stringify(detail)}`}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log(
  `node ${process.version}, isolated-vm 7.0.2, ${process.platform}/${process.arch}\n\n## guest sequences (run in the isolate, captured, applied by the consumer) vs node`,
);
for (const [name, ops] of Object.entries(GUEST)) {
  const root = nodeRoot();
  try {
    writeFileSync(join(root, 'workspace/main.js'), prog(ops));
    const before = nodeView(root);
    const nodeLog = execFileSync(process.execPath, ['main.js', root], {
      cwd: join(root, 'workspace'),
      encoding: 'utf8',
    })
      .split(root)
      .join('');
    const nodeAfter = nodeView(root);
    const state = fresh();
    const pre = fresh();
    pre.writeFileSync('/workspace/main.js', enc.encode(prog(ops)));
    const r = await run(state, prog(ops));
    const riftyAfter = viewOf(r.next);
    const logSame = r.stdout.trim() === nodeLog.trim();
    const treeSame = eq(riftyAfter, nodeAfter);
    const changes = changesOf(pre, r.next);
    const changesSame = eq(changes, nodeChanges(before, nodeAfter));
    report(name, logSame && treeSame && changesSame && r.code === 0, {
      code: r.code,
      ...(logSame ? {} : { rifty: r.stdout.trim(), node: nodeLog.trim() }),
      ...(treeSame ? {} : { rifty: riftyAfter, node: nodeAfter }),
      ...(changesSame ? {} : { changes, nodeChanges: nodeChanges(before, nodeAfter) }),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Host ops as sandbox.ts does them: writeFile = mkdir -p parent + write; remove = rm -r.
const hostOp = (fs, [op, p, data]) => {
  try {
    if (op === 'write') {
      const parent = p.slice(0, p.lastIndexOf('/')) || '/';
      fs.mkdirSync(parent, { recursive: true });
      fs.writeFileSync(p, enc.encode(data));
    } else if (op === 'remove') fs.rmSync(p, { recursive: true });
    return 'ok';
  } catch (e) {
    return e.code;
  }
};
const nodeHostOp = (root, [op, p, data]) => {
  try {
    if (op === 'write') {
      mkdirSync(join(root, p, '..'), { recursive: true });
      writeFileSync(join(root, p), data);
    } else if (op === 'remove') rmSync(join(root, p), { recursive: true });
    return 'ok';
  } catch (e) {
    return e.code;
  }
};
const HOST = {
  'host: remove → write same path': [
    ['remove', '/node_modules/a/index.js'],
    ['write', '/node_modules/a/index.js', 'new'],
  ],
  'host: remove dir → write child': [
    ['remove', '/node_modules/a'],
    ['write', '/node_modules/a/new.js', 'n'],
  ],
  'host: write on a directory path': [['write', '/node_modules/a', 'x']],
  'host: remove a template file, then its dir': [
    ['remove', '/node_modules/a/lib/x.js'],
    ['remove', '/node_modules/a/lib'],
  ],
};
console.log('\n## host sequences (consumer LayeredFs) vs node, then a round trip through the wire');
for (const [name, ops] of Object.entries(HOST)) {
  const root = nodeRoot();
  try {
    const fs = fresh();
    const codes = ops.map((o) => hostOp(fs, o));
    const nodeCodes = ops.map((o) => nodeHostOp(root, o));
    const view = viewOf(fs);
    const nv = nodeView(root);
    const d = fs.toWire();
    const blob = new R.MemoryFsSync();
    R.restoreFs(blob, R.snapshotFs(d.entries, OPTS), OPTS);
    const again = R.LayeredFs.fromWire(lower(), blob, JSON.parse(JSON.stringify(d.refs)));
    report(name, eq(codes, nodeCodes) && eq(view, nv) && eq(viewOf(again), view), {
      codes,
      nodeCodes,
      ...(eq(view, nv) ? {} : { rifty: view, node: nv }),
      ...(eq(viewOf(again), view) ? {} : { roundTrip: viewOf(again) }),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('\n## mixed: host ops → a run → the host');
const MIXED = [
  [
    'host remove, run writes the same path, host reads',
    [['remove', '/node_modules/a/index.js']],
    [['write', '/node_modules/a/index.js', 'from-run']],
    '/node_modules/a/index.js',
    'from-run',
  ],
  [
    'host overwrites a template file, run requires it',
    [['write', '/node_modules/a/index.js', "module.exports = 'host';"]],
    [['require', '/node_modules/a/index.js']],
    null,
    null,
  ],
  [
    'host removes a dir, run recreates and writes a child',
    [['remove', '/node_modules/a']],
    [
      ['mkdir', '/node_modules/a'],
      ['write', '/node_modules/a/k.js', 'k'],
    ],
    '/node_modules/a/k.js',
    'k',
  ],
];
for (const [name, host, guest, readPath, expect] of MIXED) {
  const root = nodeRoot();
  try {
    const fs = fresh();
    for (const o of host) hostOp(fs, o);
    for (const o of host) nodeHostOp(root, o);
    writeFileSync(join(root, 'workspace/main.js'), prog(guest));
    const nodeLog = execFileSync(process.execPath, ['main.js', root], {
      cwd: join(root, 'workspace'),
      encoding: 'utf8',
    })
      .split(root)
      .join('');
    const r = await run(fs, prog(guest));
    const same = eq(viewOf(r.next), nodeView(root)) && r.stdout.trim() === nodeLog.trim();
    const read =
      readPath === null ? null : new TextDecoder().decode(r.next.readFileBytesSync(readPath));
    report(name, same && read === expect, {
      stdout: r.stdout.trim(),
      nodeLog: nodeLog.trim(),
      read,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
console.log('\n## run → run: the next run sees what the previous one left');
{
  const first = [
    ['rm', '/node_modules/a/index.js'],
    ['rename', '/node_modules/a/lib', '/node_modules/a/lib2'],
    ['write', '/workspace/out.txt', 'one'],
  ];
  const second = [
    ['read', '/workspace/out.txt'],
    ['require', '/node_modules/a/lib2/x.js'],
    ['read', '/node_modules/a/index.js'],
    ['read', '/node_modules/a/lib/x.js'],
  ];
  const root = nodeRoot();
  try {
    const nodeRun = (ops) => {
      writeFileSync(join(root, 'workspace/main.js'), prog(ops));
      return execFileSync(process.execPath, ['main.js', root], {
        cwd: join(root, 'workspace'),
        encoding: 'utf8',
      })
        .split(root)
        .join('');
    };
    nodeRun(first);
    const nodeLog = nodeRun(second);
    const r1 = await run(fresh(), prog(first));
    const r2 = await run(r1.next, prog(second));
    const same = r2.stdout.trim() === nodeLog.trim() && eq(viewOf(r2.next), nodeView(root));
    report('two runs in a row', same, { rifty: r2.stdout.trim(), node: nodeLog.trim() });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('\n## minimal difference: reading the template changes nothing');
{
  const r = await run(
    fresh(),
    prog([
      ['require', '/node_modules/a/index.js'],
      ['read', '/node_modules/a/lib/y.js'],
    ]),
  );
  const d = r.next.toWire();
  const paths = Object.keys(viewOf(d.entries));
  const bytesUnder = paths.filter(
    (p) => p.startsWith('/node_modules') && !viewOf(d.entries)[p].startsWith('dir'),
  );
  const ok = bytesUnder.length === 0 && d.refs.every((x) => x[1] === 'lazy' || x[1] === 'ref');
  report('require / read of template files', ok, {
    bytesUnder,
    refs: d.refs.map((x) => x.slice(0, 3)),
  });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pass`);
process.exit(failed === 0 ? 0 : 1);
