#!/usr/bin/env node --no-node-snapshot
/**
 * Template probe G — generated operation sequences (review N2: kill the class, not the cases).
 * A seeded generator builds random sequences of `mkdir`, write, `rm` (recursive / not, force /
 * not), `rename`, `cpSync`, `copyFile`, `utimes`, read and `readdir` over a small template and a
 * few new paths, and runs each one:
 *   - live `node` (`node:fs`) over a real temp directory holding the template (the oracle);
 *   - rifty's flat `MemoryFsSync` holding the same files (rifty without a layer);
 *   - each layered construction (`layered-v1.ts`: difference derived from existence; `layered.ts`:
 *     the state by node identity), its state then carried over the wire and rebuilt on a fresh
 *     template view.
 * Class check (the layer adds nothing): every call's result and the rebuilt tree equal the flat
 * FS's. Oracle check: the rebuilt tree equals Node's (calls whose rifty `FsSync` result differs
 * from `node:fs` are rifty's FS semantics, counted apart). A sample also runs through a fresh
 * isolate (rifty `fs` in the guest) against `node` running the same program. A failure prints its
 * seed and a minimized sequence. The shared template bytes are hashed before and after.
 *
 *   node --no-node-snapshot docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/gen.mjs [N=3000] [GUEST=60]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as nfs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repo = fileURLToPath(new URL('../../../../..', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
const guestPkg = join(repo, 'packages/isolate-guest');
const nodePaths = [join(guestPkg, 'node_modules')];
const N = Number(process.argv[2] ?? 3000);
const GUEST = Number(process.argv[3] ?? 60);

const realmFile = join(tmpdir(), `gen-realm-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `export * as V3 from ${JSON.stringify(join(here, 'layered.ts'))};
export * as V2 from ${JSON.stringify(join(here, 'layered-v2.ts'))};
export * as V1 from ${JSON.stringify(join(here, 'layered-v1.ts'))};
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
nfs.rmSync(realmFile);

// ---- template ---------------------------------------------------------------------------
const T0 = 1_600_000_000_000;
const TPL = {
  '/node_modules/a/package.json': '{"main":"index.js"}',
  '/node_modules/a/index.js': "module.exports = 'a';",
  '/node_modules/a/lib/x.js': 'x',
  '/node_modules/a/lib/y.js': 'y',
  '/node_modules/b/index.js': 'b',
  '/node_modules/b/sub/s.js': 's',
};
const enc = new TextEncoder();
const files = Object.entries(TPL).map(([p, t]) => [p, enc.encode(t)]);
const dirs = new Set(['/']);
for (const [p] of files) {
  const parts = p.split('/').filter(Boolean);
  for (let i = 1; i < parts.length; i++) dirs.add(`/${parts.slice(0, i).join('/')}`);
}
const pack = new Uint8Array(files.reduce((n, [, d]) => n + d.length, 0));
const rows = [...dirs]
  .filter((d) => d !== '/')
  .sort()
  .map((d) => [1, d, 0, 0, T0, T0, T0, T0]);
{
  let off = 0;
  for (const [p, d] of files) {
    pack.set(d, off);
    rows.push([2, p, off, d.length, T0, T0, T0, T0]);
    off += d.length;
  }
}
const packHash = () => createHash('sha256').update(pack).digest('hex');
const packBefore = packHash();
const OPTS = { template: null, maxBytes: 1 << 30 };

// ---- generator ----------------------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const POOL = [
  ...[...dirs].filter((d) => d !== '/'),
  ...Object.keys(TPL),
  '/node_modules/c',
  '/node_modules/c/z.js',
  '/node_modules/a/new',
  '/node_modules/a/new/n.js',
  '/node_modules/b/sub/t.js',
  '/workspace/w',
  '/workspace/w/f.js',
  '/workspace/g.js',
];
const TIMES = [1_610_000_000_000, 1_620_000_000_000];
const BODIES = ['one', "module.exports = 'a';", ''];
function sequence(seed) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const ops = [];
  const len = 4 + Math.floor(r() * 10);
  for (let i = 0; i < len; i++) {
    const k = pick([
      'mkdir',
      'write',
      'write',
      'rm',
      'rm',
      'rename',
      'rename',
      'cp',
      'copy',
      'utimes',
      'read',
      'readdir',
    ]);
    const p = pick(POOL);
    if (k === 'mkdir') ops.push([k, p, { recursive: r() < 0.5 }]);
    else if (k === 'write') ops.push([k, p, pick(BODIES)]);
    else if (k === 'rm') ops.push([k, p, { recursive: r() < 0.6, force: r() < 0.3 }]);
    else if (k === 'rename' || k === 'cp' || k === 'copy') ops.push([k, p, pick(POOL)]);
    else if (k === 'utimes') ops.push([k, p, pick(TIMES)]);
    else ops.push([k, p]);
  }
  return ops;
}

// ---- executors --------------------------------------------------------------------------
const code = (e) => (typeof e?.code === 'string' ? e.code : `throw:${e?.message}`);
/** One op on an FsSync (rifty's interface, the layer's and the flat FS's). */
function onFsSync(fs, [k, p, a]) {
  try {
    if (k === 'mkdir') fs.mkdirSync(p, a);
    else if (k === 'write') fs.writeFileSync(p, enc.encode(a));
    else if (k === 'rm') fs.rmSync(p, a);
    else if (k === 'rename') fs.renameSync(p, a);
    else if (k === 'cp') fs.cpSync(p, a, { recursive: true });
    else if (k === 'copy') fs.copyFileSync(p, a);
    else if (k === 'utimes') fs.utimes(p, a, a);
    else if (k === 'read') return `=${new TextDecoder().decode(fs.readFileBytesSync(p))}`;
    else if (k === 'readdir')
      return `=${fs
        .readdirSync(p)
        .map((d) => d.name)
        .join(',')}`;
    return 'ok';
  } catch (e) {
    return code(e);
  }
}
function onNode(root, [k, p, a]) {
  const at = (q) => join(root, q);
  try {
    if (k === 'mkdir') nfs.mkdirSync(at(p), a);
    else if (k === 'write') nfs.writeFileSync(at(p), a);
    else if (k === 'rm') nfs.rmSync(at(p), a);
    else if (k === 'rename') nfs.renameSync(at(p), at(a));
    else if (k === 'cp') nfs.cpSync(at(p), at(a), { recursive: true });
    else if (k === 'copy') nfs.copyFileSync(at(p), at(a));
    else if (k === 'utimes') nfs.utimesSync(at(p), a / 1000, a / 1000);
    else if (k === 'read') return `=${nfs.readFileSync(at(p), 'utf8')}`;
    else if (k === 'readdir') return `=${nfs.readdirSync(at(p)).sort().join(',')}`;
    return 'ok';
  } catch (e) {
    return code(e);
  }
}
const stamp = (ms) => (ms < 1.7e12 ? Math.round(ms) : 'now');
/** Tree as {path: kind/bytes/mtime}; directories' mtimes included. */
function treeOfFs(fs) {
  const out = {};
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir)) {
      const p = dir === '/' ? `/${d.name}` : `${dir}/${d.name}`;
      const st = fs.statSync(p);
      if (st.isDirectory) {
        out[p] = `dir ${stamp(st.mtime)}`;
        walk(p);
      } else
        out[p] = `file ${new TextDecoder().decode(fs.readFileBytesSync(p))} ${stamp(st.mtime)}`;
    }
  };
  walk('/');
  return out;
}
function treeOfNode(root) {
  const out = {};
  const walk = (abs, rel) => {
    for (const name of nfs.readdirSync(abs).sort()) {
      const a = join(abs, name);
      const p = `${rel}/${name}`;
      const st = nfs.statSync(a);
      if (st.isDirectory()) {
        out[p] = `dir ${stamp(st.mtimeMs)}`;
        walk(a, p);
      } else out[p] = `file ${nfs.readFileSync(a, 'utf8')} ${stamp(st.mtimeMs)}`;
    }
  };
  walk(root, '');
  return out;
}
function nodeRoot() {
  const root = nfs.realpathSync(nfs.mkdtempSync(join(tmpdir(), 'gen-')));
  nfs.mkdirSync(join(root, 'workspace'));
  for (const [p, t] of Object.entries(TPL)) {
    nfs.mkdirSync(join(root, p, '..'), { recursive: true });
    nfs.writeFileSync(join(root, p), t);
  }
  const touch = (abs) => {
    if (nfs.statSync(abs).isDirectory()) for (const n of nfs.readdirSync(abs)) touch(join(abs, n));
    nfs.utimesSync(abs, T0 / 1000, T0 / 1000);
  };
  touch(join(root, 'node_modules'));
  return root;
}
function flat() {
  const fs = new R.MemoryFsSync();
  for (const d of [...dirs].filter((x) => x !== '/').sort()) fs.mkdirSync(d, {});
  for (const [p, d] of files) fs.writeFileSync(p, d);
  for (const d of [...dirs].filter((x) => x !== '/'))
    fs.restoreStatSync(d, { mtimeMs: T0, atimeMs: T0, ctimeMs: T0, birthtimeMs: T0 });
  for (const [p] of files)
    fs.restoreStatSync(p, { mtimeMs: T0, atimeMs: T0, ctimeMs: T0, birthtimeMs: T0 });
  fs.mkdirSync('/workspace', {});
  return fs;
}
const IMPLS = {
  v1: {
    make() {
      const L = new R.V1.LayeredFs(R.V1.templateLayer(pack, rows));
      L.mkdirSync('/workspace', {});
      return L;
    },
    rebuild(L) {
      const d = L.difference();
      const blob = R.snapshotFs(d.entries, OPTS);
      const e = new R.MemoryFsSync();
      R.restoreFs(e, blob, OPTS);
      const M = new R.V1.LayeredFs(R.V1.templateLayer(pack, rows));
      M.apply(e, JSON.parse(JSON.stringify(d.deleted)));
      return M;
    },
  },
  v2: wireImpl(() => R.V2),
  v3: wireImpl(() => R.V3),
};
/** A construction carried as nodes + rows over the wire (`layered-v2.ts`, `layered.ts`). */
function wireImpl(M) {
  return {
    make() {
      const L = new (M().LayeredFs)(M().templateLayer(pack, rows));
      L.mkdirSync('/workspace', {});
      return L;
    },
    rebuild(L) {
      const w = L.toWire();
      const e = new R.MemoryFsSync();
      R.restoreFs(e, R.snapshotFs(w.entries, OPTS), OPTS);
      return M().LayeredFs.fromWire(
        M().templateLayer(pack, rows),
        e,
        JSON.parse(JSON.stringify(w.refs)),
      );
    },
    wire(L) {
      const w = L.toWire();
      return { tree: treeOfFs(w.entries), refs: w.refs.map((r) => r.slice(0, 3)) };
    },
  };
}
/** The state cap counted independently from the wire: rows + explicit entries (ADR-0567 §7). */
function wireBudget(L) {
  const w = L.toWire();
  const charge = (q) => 384 + 8 * q.length + 80 * (q === '/' ? 0 : q.split('/').length - 1);
  let n = 0;
  for (const r of w.refs) n += charge(r[0]);
  const walk = (dir) => {
    for (const d of w.entries.readdirSync(dir)) {
      const q = dir === '/' ? `/${d.name}` : `${dir}/${d.name}`;
      n += charge(q);
      if (d.isDirectory) walk(q);
      else n += w.entries.readFileBytesSync(q).byteLength;
    }
  };
  if (!w.refs.some((r) => r[0] === '/')) walk('/');
  return n;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The layer vs the flat FS (class), and the rebuilt tree vs Node (oracle). For wire constructions
 * also: the state rebuilt from the wire after a seeded op (a run boundary) changes nothing, and
 * (layered.ts) the cap's budget equals the wire's count.
 */
function check(impl, ops, cut = Math.floor(ops.length / 2)) {
  const f = flat();
  const L = IMPLS[impl].make();
  const fr = ops.map((o) => onFsSync(f, o));
  const lr = ops.map((o) => onFsSync(L, o));
  let rebuilt;
  try {
    rebuilt = treeOfFs(IMPLS[impl].rebuild(L));
  } catch (e) {
    rebuilt = { rebuildThrew: code(e) };
  }
  const flatTree = treeOfFs(f);
  let boundaryOk = true;
  let budgetOk = true;
  if (impl !== 'v1') {
    let M = IMPLS[impl].make();
    const mr = [];
    ops.forEach((o, i) => {
      if (i === cut) M = IMPLS[impl].rebuild(M);
      mr.push(onFsSync(M, o));
    });
    boundaryOk = eq(mr, fr) && eq(treeOfFs(M), flatTree);
    if (impl === 'v3') budgetOk = L.budget() === wireBudget(L) && M.budget() === wireBudget(M);
  }
  return {
    classOk:
      eq(fr, lr) && eq(treeOfFs(L), flatTree) && eq(rebuilt, flatTree) && boundaryOk && budgetOk,
    fr,
    lr,
    flatTree,
    rebuilt,
    boundaryOk,
    budgetOk,
  };
}
/** Reads only (read, readdir, failed calls aside) leave the wire as a fresh sandbox's. */
function minimal(impl, ops) {
  const reads = ops.filter(([k]) => k === 'read' || k === 'readdir');
  const L = IMPLS[impl].make();
  const fresh = IMPLS[impl].wire(L);
  for (const o of reads) onFsSync(L, o);
  for (const [p] of files) onFsSync(L, ['read', p]);
  return eq(IMPLS[impl].wire(L), fresh);
}
function minimize(impl, ops) {
  let cur = ops;
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < cur.length; i++) {
      const next = cur.filter((_, j) => j !== i);
      if (!check(impl, next).classOk) {
        cur = next;
        changed = true;
        break;
      }
    }
  }
  return cur;
}

console.log(
  `node ${process.version}, ${process.platform}/${process.arch}; ${N} sequences, seeds 1..${N}\n`,
);
const summary = {};
for (const impl of ['v1', 'v2', 'v3']) {
  let classFail = 0;
  let oracleFail = 0;
  let notMinimal = 0;
  let firstFail;
  const outsideClass = new Map();
  for (let seed = 1; seed <= N; seed++) {
    const ops = sequence(seed);
    if (impl !== 'v1' && !minimal(impl, ops)) notMinimal++;
    const c = check(impl, ops, Math.floor(rng(seed + 7)() * ops.length));
    if (!c.classOk) {
      classFail++;
      firstFail ??= { seed, minimized: minimize(impl, ops) };
      continue;
    }
    // Oracle: Node over a real directory.
    const root = nodeRoot();
    try {
      const nr = ops.map((o) => onNode(root, o));
      const nt = treeOfNode(root);
      if (!eq(c.rebuilt, nt)) {
        // Rifty's own FS (flat) already differs from node:fs here: outside the layer's class.
        if (!eq(c.flatTree, nt) || !eq(c.fr, nr)) {
          const key =
            ops
              .map((o, i) =>
                c.fr[i] !== nr[i] ? `${o[0]}: rifty ${c.fr[i]} / node ${nr[i]}` : null,
              )
              .find(Boolean) ?? 'tree (times/order)';
          outsideClass.set(key, (outsideClass.get(key) ?? 0) + 1);
        } else oracleFail++;
      }
    } finally {
      nfs.rmSync(root, { recursive: true, force: true });
    }
  }
  summary[impl] = { classFail, oracleFail, notMinimal };
  console.log(
    `## ${impl}: layer ≠ flat rifty FS in ${classFail}/${N}; rebuilt ≠ node where flat = node in ${oracleFail}/${N}${impl === 'v1' ? '' : `; reading the template grows the state in ${notMinimal}/${N}`}`,
  );
  if (firstFail) {
    const c = check(impl, firstFail.minimized);
    console.log(
      `   first failing seed ${firstFail.seed}, minimized: ${JSON.stringify(firstFail.minimized)}`,
    );
    console.log(`   flat: ${JSON.stringify(c.fr)} ${JSON.stringify(c.flatTree)}`);
    console.log(`   layer: ${JSON.stringify(c.lr)} rebuilt ${JSON.stringify(c.rebuilt)}`);
  }
  if (impl === 'v3') {
    console.log(
      '   rifty FsSync vs node:fs where they differ (rifty FS semantics, not the layer), by first differing call:',
    );
    for (const [k, n] of [...outsideClass].sort((a, b) => b[1] - a[1]).slice(0, 12))
      console.log(`     ${n} × ${k}`);
  }
}

// ---- guest sample: rifty fs in a fresh isolate vs node running the same program ----------
const ivm = createRequire(join(repo, 'packages/isolate-host/package.json'))('isolated-vm');
const { createHostBridge } = await import(join(guestPkg, 'dist/index.js'));
const bundleFile = join(tmpdir(), `gen-guest-${process.pid}.js`);
await build({
  absWorkingDir: guestPkg,
  stdin: {
    contents: `import './entry.ts';
import { MemoryFsSync, setSyncMirror } from '@riftydev/vfs/internal';
import { LayeredFs, templateLayer } from ${JSON.stringify(join(here, 'layered.ts'))};
import { restoreFs, snapshotFs } from '../snapshot.ts';
let L;
const opts = { template: null, maxBytes: 1 << 30 };
Object.defineProperty(globalThis, '__gen', { value: Object.freeze({
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
  // No layer at all: rifty's plain MemoryFsSync holding every file.
  installFlat(blob) {
    L = new MemoryFsSync();
    restoreFs(L, blob, opts);
    setSyncMirror(L);
  },
  captureFlat() {
    return { blob: snapshotFs(L, opts), refs: '[]' };
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
const bundle = nfs.readFileSync(bundleFile, 'utf8');
nfs.rmSync(bundleFile);
const prog = (ops) => `const fs = require('fs');
const P = process.argv[2] || '';
const out = [];
for (const [k, p, a] of ${JSON.stringify(ops)}) {
  try {
    if (k === 'mkdir') fs.mkdirSync(P + p, a);
    else if (k === 'write') fs.writeFileSync(P + p, a);
    else if (k === 'rm') fs.rmSync(P + p, a);
    else if (k === 'rename') fs.renameSync(P + p, P + a);
    else if (k === 'cp') fs.cpSync(P + p, P + a, { recursive: true });
    else if (k === 'copy') fs.copyFileSync(P + p, P + a);
    else if (k === 'utimes') fs.utimesSync(P + p, a / 1000, a / 1000);
    else if (k === 'read') { out.push('=' + fs.readFileSync(P + p, 'utf8')); continue; }
    else if (k === 'readdir') { out.push('=' + fs.readdirSync(P + p).sort().join(',')); continue; }
    out.push('ok');
  } catch (e) { out.push(e.code); }
}
console.log(JSON.stringify(out));`;
let cachedData;
/** `layer`: the template as layered.ts; `flat`: rifty's plain MemoryFsSync with the same files. */
async function guestRun(ops, mode) {
  let L;
  let blob;
  let refs = '[]';
  if (mode === 'layer') {
    L = IMPLS.v3.make();
    L.writeFileSync('/workspace/main.js', enc.encode(prog(ops)));
    const w = L.toWire();
    blob = R.snapshotFs(w.entries, OPTS);
    refs = JSON.stringify(w.refs);
  } else {
    L = flat();
    L.writeFileSync('/workspace/main.js', enc.encode(prog(ops)));
    blob = R.snapshotFs(L, OPTS);
  }
  const out = [];
  const g = {};
  const { functions, timeOrigin, close } = createHostBridge({
    write: (_fd, b) => out.push(Buffer.from(b).toString()),
    fire: (id) => g.fire.apply(undefined, [id]),
  });
  const iso = new ivm.Isolate({ memoryLimit: 128 });
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
    const gen = await context.global.get('__gen', { reference: true });
    g.fire = await entry.get('fire', { reference: true });
    if (mode === 'layer')
      await (await gen.get('install', { reference: true })).apply(
        undefined,
        [new Uint8Array(pack), JSON.stringify(rows), blob, refs],
        { arguments: { copy: true } },
      );
    else
      await (await gen.get('installFlat', { reference: true })).apply(undefined, [blob], {
        arguments: { copy: true },
      });
    await (await entry.get('runFile', { reference: true })).apply(
      undefined,
      ['/workspace/main.js', []],
      {
        arguments: { copy: true },
        result: { promise: true, copy: true },
      },
    );
    const cap = await (
      await gen.get(mode === 'layer' ? 'capture' : 'captureFlat', { reference: true })
    ).apply(undefined, [], { result: { copy: true } });
    const e = new R.MemoryFsSync();
    R.restoreFs(e, cap.blob, OPTS);
    const next =
      mode === 'layer'
        ? R.V3.LayeredFs.fromWire(R.V3.templateLayer(pack, rows), e, JSON.parse(cap.refs))
        : e;
    return { log: out.join('').trim(), tree: treeOfFs(next) };
  } finally {
    close();
    if (!iso.isDisposed) iso.dispose();
  }
}
let guestClass = 0;
let guestSame = 0;
let guestOracleFail = 0;
const guestDiff = new Map();
for (let seed = 1; seed <= GUEST; seed++) {
  const ops = sequence(10_000 + seed);
  const root = nodeRoot();
  try {
    nfs.writeFileSync(join(root, 'workspace/main.js'), prog(ops));
    const nodeLog = execFileSync(process.execPath, ['main.js', root], {
      cwd: join(root, 'workspace'),
      encoding: 'utf8',
    })
      .split(root)
      .join('')
      .trim();
    const nodeTree = treeOfNode(root);
    const g = await guestRun(ops, 'layer');
    const f = await guestRun(ops, 'flat');
    if (g.log === f.log && eq(g.tree, f.tree)) guestClass++;
    else console.log(`   guest layer ≠ flat, seed ${10_000 + seed}: ${JSON.stringify(ops)}`);
    if (g.log === nodeLog && eq(g.tree, nodeTree)) guestSame++;
    else if (f.log === nodeLog && eq(f.tree, nodeTree)) guestOracleFail++;
    else {
      const a = JSON.parse(f.log || '[]');
      const b = JSON.parse(nodeLog);
      const i = a.findIndex((x, j) => x !== b[j]);
      const key = i >= 0 ? `${ops[i][0]}: rifty ${a[i]} / node ${b[i]}` : 'tree (times)';
      guestDiff.set(key, (guestDiff.get(key) ?? 0) + 1);
    }
  } finally {
    nfs.rmSync(root, { recursive: true, force: true });
  }
}
console.log(
  `\n## guest sample (fresh isolate, rifty fs): layer = flat in ${guestClass}/${GUEST}; equal to node in ${guestSame}/${GUEST}; layer ≠ node where flat = node in ${guestOracleFail}/${GUEST}`,
);
for (const [k, n] of [...guestDiff].sort((a, b) => b[1] - a[1]))
  console.log(`   ${n} × rifty fs vs node (flat too), first difference ${k}`);
const intact = packHash() === packBefore;
console.log(`\nshared template bytes unchanged after all runs: ${intact}`);
process.exit(
  summary.v3.classFail === 0 &&
    summary.v3.oracleFail === 0 &&
    summary.v3.notMinimal === 0 &&
    guestClass === GUEST &&
    guestOracleFail === 0 &&
    intact
    ? 0
    : 1,
);
