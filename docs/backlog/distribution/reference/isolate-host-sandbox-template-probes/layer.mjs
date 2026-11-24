#!/usr/bin/env node --no-node-snapshot --expose-gc
/**
 * Template probe L — how a fresh isolate sees a template, per `exec`: memory and
 * latency on a ~1 MB and a ~95 MB template. Worker-side only (a fresh isolate
 * per run, the guest bundle from a V8 code cache, as `child/main.ts` does);
 * the consumer's encode/decode is measured separately (`consumer` rows).
 *
 * Arms:
 *   full   — today: the template is part of the state; restore(template ∪ diff)
 *            → runFile → snapshot of the whole FS (ADR-0567 codec).
 *   views  — materialize in the heap at the lowest cost: one ivm copy of a packed
 *            buffer, every entry a view into it (no per-file copy), diff restored
 *            by the codec; capture walks the tree and snapshots non-template files.
 *   lazy   — the isolate holds only the diff; template files read on demand
 *            through 3 sync host functions over a worker-side Map (overlay).
 *   worker — the worker owns the whole FS (template lower + diff upper, rifty's
 *            MemoryFs in the worker realm); every guest FsSync call is one sync
 *            host call; the end state is the worker's own snapshot of the upper.
 *
 * Usage (repo root, after building isolate-guest and isolate-host):
 *   node --no-node-snapshot --expose-gc docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/layer.mjs <libs node_modules dir>
 * where the libs dir holds `npm install pdf-lib@1.17.1 semver@7.7.2` (scripts ignored).
 */
import { lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repo = fileURLToPath(new URL('../../../../..', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
const guestPkg = join(repo, 'packages/isolate-guest');
const hostReq = createRequire(join(repo, 'packages/isolate-host/package.json'));
const ivm = hostReq('isolated-vm');
const { createHostBridge } = await import(join(guestPkg, 'dist/index.js'));
const LIBS = process.argv[2];
if (!LIBS) throw new Error('usage: layer.mjs <libs node_modules dir>');

// Probe guest bundle: the real entry + probe-guest.ts, resolved from the entry's dir.
const bundleFile = join(tmpdir(), `layer-guest-${process.pid}.js`);
await build({
  absWorkingDir: guestPkg,
  stdin: {
    contents: readFileSync(join(here, 'probe-guest.ts'), 'utf8'),
    resolveDir: join(guestPkg, 'src/guest'),
    loader: 'ts',
    sourcefile: 'probe-guest.ts',
  },
  inject: ['src/guest/web-shim.ts'],
  // The guest package declares sideEffects:false; the entry's side effects are the point here.
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
// Consumer-realm codec, from source.
const realmFile = join(tmpdir(), `layer-realm-${process.pid}.mjs`);
await build({
  stdin: {
    contents:
      "export { createMemoryFs } from '@riftydev/vfs/internal'; export { snapshotFs, restoreFs } from './src/snapshot.ts';",
    resolveDir: guestPkg,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: realmFile,
  logLevel: 'warning',
});
const { createMemoryFs, snapshotFs, restoreFs } = await import(pathToFileURL(realmFile).href);
rmSync(realmFile);

// ---- templates ---------------------------------------------------------------
function walkFiles(abs, rel, out, accept = () => true, enough = () => false) {
  for (const name of readdirSync(abs).sort()) {
    if (enough(out)) return;
    const p = join(abs, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walkFiles(p, `${rel}/${name}`, out, accept, enough);
    else if (st.isFile() && accept(st.size)) out.push([`${rel}/${name}`, readFileSync(p)]);
  }
  return out;
}
const bytesOf = (files) => files.reduce((n, [, d]) => n + d.length, 0);
/** Real filler files from the workspace's pnpm store, under `/node_modules/.filler`. */
function filler(accept, enough) {
  const store = join(repo, 'node_modules/.pnpm');
  const out = [];
  for (const pkg of readdirSync(store).sort()) {
    if (enough(out)) break;
    const nm = join(store, pkg, 'node_modules');
    try {
      walkFiles(nm, `/node_modules/.filler/${pkg}`, out, accept, enough);
    } catch {}
  }
  return out;
}
const semverFiles = walkFiles(join(LIBS, 'semver'), '/node_modules/semver', []);
const allLibFiles = walkFiles(LIBS, '/node_modules', []).filter(([p]) => !p.includes('/.package-lock.json'));
const T1 = [
  ...semverFiles,
  ...filler(
    (s) => s <= 80 * 1024,
    (o) => bytesOf(semverFiles) + bytesOf(o) >= 1_000_000,
  ),
];
const T95_FILES = 23_654;
const T95_BYTES = 95_000_000;
const t95fill = filler(
  (s) => s <= 28 * 1024,
  (o) => allLibFiles.length + o.length >= T95_FILES || bytesOf(allLibFiles) + bytesOf(o) >= T95_BYTES,
);
const T95 = [...allLibFiles, ...t95fill];
for (let i = 0; T95.length < T95_FILES; i++) T95.push([T95[i][0].replace('/node_modules/', '/node_modules/.copy/'), T95[i][1]]);

/** Directory set of a file list (with `/`). */
function dirsOf(files) {
  const dirs = new Set(['/']);
  for (const [p] of files) {
    const parts = p.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) dirs.add(`/${parts.slice(0, i).join('/')}`);
  }
  return [...dirs].sort();
}
const T0 = 1_700_000_000_000;
function treeOf(files) {
  const { fsSync } = createMemoryFs();
  for (const d of dirsOf(files)) if (d !== '/') fsSync.mkdirSync(d, { recursive: true });
  for (const [p, d] of files) fsSync.writeFileSync(p, new Uint8Array(d));
  for (const p of [...dirsOf(files), ...files.map(([p]) => p)])
    fsSync.restoreStatSync(p, { mtimeMs: T0, atimeMs: T0, ctimeMs: T0, birthtimeMs: T0 });
  return fsSync;
}
/** Worker-side store for the lazy arm. */
function storeOf(files) {
  const entries = new Map();
  const children = new Map();
  for (const d of dirsOf(files)) {
    entries.set(d, { dir: true });
    children.set(d, []);
  }
  for (const [p, d] of files) entries.set(p, { dir: false, bytes: new Uint8Array(d) });
  for (const p of entries.keys()) {
    if (p === '/') continue;
    const parent = p.slice(0, p.lastIndexOf('/')) || '/';
    children.get(parent).push([p.slice(parent === '/' ? 1 : parent.length + 1), entries.get(p).dir ? 1 : 0]);
  }
  for (const list of children.values()) list.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { entries, children };
}
/** Packed buffer + index for the views arm. */
function packOf(files) {
  const pack = new Uint8Array(bytesOf(files));
  const rows = dirsOf(files)
    .filter((d) => d !== '/')
    .map((d) => [1, d, 0, 0, T0, T0, T0, T0]);
  let off = 0;
  for (const [p, d] of files) {
    pack.set(d, off);
    rows.push([2, p, off, d.length, T0, T0, T0, T0]);
    off += d.length;
  }
  return { pack, index: JSON.stringify(rows) };
}

/** The worker-realm FS of the `worker` arm: upper (restored diff) over the template store. */
function workerFs(tpl, diffBlob) {
  const upper = createMemoryFs().fsSync;
  restoreFs(upper, diffBlob, { template: null, maxBytes: 1 << 30 });
  const low = (p) => tpl.store.entries.get(p);
  const parentOf = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
  const copyUp = (d) => {
    if (upper.existsSync(d)) return;
    copyUp(parentOf(d));
    upper.mkdirSync(d, {});
  };
  const stat = (p) => {
    const u = upper.statSyncOrNull(p);
    if (u)
      return [u.isDirectory ? 1 : 0, u.size ?? 0, u.mtime, u.atime, u.metadata.ctime, u.metadata.birthtime, u.nlink ?? 1];
    const e = low(p);
    return e ? [e.dir ? 1 : 0, e.dir ? 0 : e.bytes.length, T0, T0, T0, T0, 1] : null;
  };
  const ops = {
    exists: (p) => upper.existsSync(p) || low(p) !== undefined,
    stat,
    read: (p) => {
      if (upper.existsSync(p)) return upper.readFileBytesSync(p);
      const e = low(p);
      if (!e) return { e: 'ENOENT' };
      if (e.dir) return { e: 'EISDIR' };
      return e.bytes;
    },
    write: (p, data) => {
      if (!(data instanceof Uint8Array)) return { e: 'EINVAL' };
      if (!upper.existsSync(parentOf(p)) && low(parentOf(p))?.dir) copyUp(parentOf(p));
      upper.writeFileSync(p, new Uint8Array(data));
    },
    readdir: (p) => {
      const out = new Map();
      if (low(p)?.dir) for (const [n, d] of tpl.store.children.get(p)) out.set(n, d);
      if (upper.existsSync(p)) for (const d of upper.readdirSync(p)) out.set(d.name, d.isDirectory ? 1 : 0);
      else if (out.size === 0) return { e: 'ENOENT' };
      return [...out].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    },
    mkdir: (p, recursive) => {
      if (low(p)?.dir && !upper.existsSync(p)) return recursive ? copyUp(p) : { e: 'EEXIST' };
      if (!upper.existsSync(parentOf(p)) && low(parentOf(p))?.dir) copyUp(parentOf(p));
      upper.mkdirSync(p, { recursive });
    },
    rm: (p, recursive, force) => upper.rmSync(p, { recursive, force }),
    utimes: (p, a, m) => upper.utimes(p, a, m),
    rename: (a, b) => upper.renameSync(a, b),
    copy: (a, b) => ops.write(b, ops.read(a)),
  };
  const call = (op, a, b, c) => {
    try {
      return ops[op](a, b, c) ?? null;
    } catch (e) {
      return { e: typeof e?.code === 'string' ? e.code : 'EIO' };
    }
  };
  return { call, capture: () => snapshotFs(upper, { template: null, maxBytes: 1 << 30 }) };
}

// ---- workloads -----------------------------------------------------------------
const W = {
  semver: `const semver = require('semver');
require('fs').writeFileSync('out.txt', String(semver.satisfies('1.2.3', '^1.0.0')));
console.log('ok');`,
  pdf: `const { PDFDocument, StandardFonts } = require('pdf-lib');
(async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  page.drawText('hello', { font: await doc.embedFont(StandardFonts.Helvetica) });
  require('fs').writeFileSync('out.pdf', await doc.save());
  console.log('ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });`,
};
W.many = `const fs = require('fs');
fs.mkdirSync('many', { recursive: true });
const chunk = Buffer.alloc(1024, 120);
for (let i = 0; i < 1000; i++) fs.writeFileSync('many/f' + i + '.txt', chunk);
let n = 0;
for (const name of fs.readdirSync('many')) n += fs.readFileSync('many/' + name).length;
console.log('ok', n);`;
// Chunked I/O on the agent's own files: 8 MiB through a write stream (64 KiB chunks), then a
// read stream and 128 appendFileSync of 64 KiB (each fd write reads + rewrites the whole file).
W.stream = `const fs = require('fs');
const chunk = Buffer.alloc(65536, 97);
const ws = fs.createWriteStream('big.bin');
for (let i = 0; i < 128; i++) ws.write(chunk);
ws.end(() => {
  let n = 0;
  fs.createReadStream('big.bin').on('data', (d) => { n += d.length; }).on('end', () => {
    for (let i = 0; i < 128; i++) fs.appendFileSync('app.bin', chunk);
    console.log('ok', n, fs.statSync('app.bin').size);
  });
});`;
// A difference near the requirements' 16 MB budget: a 16 MiB input the run only stats.
W.bigdiff = `console.log('ok', require('fs').statSync('input.bin').size);`;
const diffFiles = (w) => [
  ['/workspace/main.js', Buffer.from(W[w])],
  ['/tmp/.keep', Buffer.alloc(0)],
  ...(w === 'bigdiff' ? [['/workspace/input.bin', Buffer.alloc(16 << 20, 7)]] : []),
];

// ---- one run -------------------------------------------------------------------
let cachedData;
async function run(arm, tpl, w, memoryLimit) {
  const out = [];
  const guest = {};
  const { functions, timeOrigin, close } = createHostBridge({
    write: (fd, b) => out.push(Buffer.from(b).toString()),
    fire: (id) => guest.fire.apply(undefined, [id]),
  });
  const iso = new ivm.Isolate({ memoryLimit });
  const t = { start: performance.now() };
  try {
    const context = await iso.createContext();
    const names = Object.keys(functions);
    const host = names.map((n) => new ivm.Callback(functions[n]));
    // The worker arm's FS (its diff restored in the worker realm) is built in the restore phase.
    let wfs;
    const tplFns =
      arm === 'worker'
        ? [new ivm.Callback((op, a, b, c) => wfs.call(op, a, b, c))]
        : arm === 'lazy'
        ? [
            new ivm.Callback((p) => {
              const e = tpl.store.entries.get(p);
              if (!e) return null;
              return [e.dir ? 1 : 0, e.dir ? 0 : e.bytes.length, T0, T0, T0, T0];
            }),
            new ivm.Callback((p) => tpl.store.entries.get(p).bytes),
            new ivm.Callback((p) => tpl.store.children.get(p) ?? []),
          ]
        : [];
    await context.evalClosure(
      `globalThis.__riftyIsolateHost = { timeOrigin: ${timeOrigin}, ${names.map((n, i) => `${n}: $${i}`).join(', ')} };` +
        (arm === 'lazy'
          ? `globalThis.__probeTpl = { stat: $${names.length}, read: $${names.length + 1}, readdir: $${names.length + 2} };`
          : arm === 'worker'
            ? `globalThis.__probeFs = $${names.length};`
            : ''),
      [...host, ...tplFns],
    );
    const script = await iso.compileScript(bundle, {
      filename: 'rifty-isolate-guest.js',
      ...(cachedData ? { cachedData } : { produceCachedData: true }),
    });
    if (!cachedData) cachedData = script.cachedData;
    await script.run(context);
    t.boot = performance.now();
    const entry = await context.global.get('__riftyGuest', { reference: true });
    const probe = await context.global.get('__probe', { reference: true });
    guest.fire = await entry.get('fire', { reference: true });
    const options = { template: null, maxBytes: 1 << 30 };
    const state = arm === 'full' ? tpl.fullBlob[w] : tpl.diffBlob[w];
    const restore = await entry.get('restore', { reference: true });
    if (arm !== 'worker')
      await restore.apply(undefined, [new ivm.ExternalCopy(state).copyInto({ release: true }), options], {
        arguments: { copy: true },
      });
    if (arm === 'views') {
      const mat = await probe.get('materialize', { reference: true });
      await mat.apply(undefined, [new ivm.ExternalCopy(tpl.packed.pack).copyInto({ release: true }), tpl.packed.index], {
        arguments: { copy: true },
      });
    }
    if (arm === 'lazy') await (await probe.get('overlay', { reference: true })).apply(undefined, []);
    if (arm === 'worker') {
      wfs = workerFs(tpl, tpl.diffBlob[w]);
      await (await probe.get('remote', { reference: true })).apply(undefined, []);
    }
    t.restore = performance.now();
    const runFile = await entry.get('runFile', { reference: true });
    const code = await runFile.apply(undefined, ['/workspace/main.js', []], {
      arguments: { copy: true },
      result: { promise: true, copy: true },
    });
    t.run = performance.now();
    const heap = iso.getHeapStatisticsSync();
    let end;
    if (arm === 'worker') end = wfs.capture();
    else if (arm === 'views') {
      end = await (await probe.get('captureDiff', { reference: true })).apply(undefined, [1 << 30], {
        result: { copy: true },
      });
    } else {
      const snap = await entry.get('snapshot', { reference: true });
      end = await snap.apply(undefined, [options], { arguments: { copy: true }, result: { copy: true } });
    }
    t.capture = performance.now();
    const counters = arm === 'lazy' || arm === 'worker' ? JSON.parse(await (await probe.get('counters', { reference: true })).apply(undefined, [])) : undefined;
    const peakHeap = iso.getHeapStatisticsSync();
    return {
      ok: code === 0,
      code,
      out: out.join('').slice(0, 200),
      ms: {
        boot: t.boot - t.start,
        restore: t.restore - t.boot,
        run: t.run - t.restore,
        capture: t.capture - t.run,
        total: t.capture - t.start,
      },
      heapMiB: {
        usedAfterRun: heap.used_heap_size / 2 ** 20,
        external: peakHeap.externally_allocated_size / 2 ** 20,
        totalAfterCapture: peakHeap.total_heap_size / 2 ** 20,
      },
      endBytes: end.byteLength,
      counters,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  } finally {
    close();
    if (!iso.isDisposed) iso.dispose();
  }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));

async function floor(arm, tpl, w) {
  let lo = 8;
  let hi = 2048;
  while (hi - lo > 4) {
    const mid = Math.floor((lo + hi) / 2);
    const r = await run(arm, tpl, w, mid);
    if (r.ok) hi = mid;
    else lo = mid;
  }
  return hi;
}

function prepare(label, files, workloads) {
  const opts = { template: null, maxBytes: 1 << 30 };
  const fullBlob = {};
  const diffBlob = {};
  const consumer = {};
  for (const w of workloads) {
    const full = treeOf([...files, ...diffFiles(w), ['/tmp/.keep', Buffer.alloc(0)]]);
    let t = performance.now();
    fullBlob[w] = snapshotFs(full, opts);
    const encode = performance.now() - t;
    t = performance.now();
    restoreFs(createMemoryFs().fsSync, fullBlob[w], opts);
    const decode = performance.now() - t;
    diffBlob[w] = snapshotFs(treeOf(diffFiles(w)), opts);
    consumer[w] = round({ encodeFull: encode, decodeFull: decode });
  }
  return {
    label,
    files: files.length,
    bytes: bytesOf(files),
    fullBlob,
    diffBlob,
    consumer,
    store: storeOf(files),
    packed: packOf(files),
  };
}

console.log(`node ${process.version}, isolated-vm ${hostReq('isolated-vm/package.json').version}, ${process.platform}/${process.arch}`);
const plans = [
  [prepare('T1', T1, ['semver', 'many', 'stream', 'bigdiff']), ['semver', 'many', 'stream', 'bigdiff']],
  [prepare('T95', T95, ['semver', 'pdf', 'many']), ['semver', 'pdf', 'many']],
];
const ARMS = ['full', 'views', 'lazy', 'worker'];
const REPS = 7;
for (const [tpl, workloads] of plans) {
  console.log(`\n## ${tpl.label}: ${tpl.files} files, ${(tpl.bytes / 1e6).toFixed(1)} MB; consumer full-state encode/decode ms ${JSON.stringify(tpl.consumer)}`);
  for (const w of workloads) {
    for (const arm of ARMS) {
      await run(arm, tpl, w, 1024); // warm
      const runs = [];
      for (let i = 0; i < REPS; i++) {
        globalThis.gc?.();
        runs.push(await run(arm, tpl, w, 1024));
      }
      const bad = runs.find((r) => !r.ok);
      if (bad) {
        console.log(JSON.stringify({ tpl: tpl.label, w, arm, failed: bad }));
        continue;
      }
      const ms = {};
      for (const k of Object.keys(runs[0].ms)) ms[k] = median(runs.map((r) => r.ms[k]));
      const heap = {};
      for (const k of Object.keys(runs[0].heapMiB)) heap[k] = median(runs.map((r) => r.heapMiB[k]));
      console.log(
        JSON.stringify({
          tpl: tpl.label,
          w,
          arm,
          msMedian: round(ms),
          heapMiB: round(heap),
          minMemoryLimitMiB: await floor(arm, tpl, w),
          endStateBytes: runs[0].endBytes,
          bridge: runs[0].counters,
        }),
      );
    }
  }
}
// Four runs at once in one process (a worker's 4 slots): sync host calls share its one thread.
const t95 = plans[1][0];
console.log('\n## concurrency: 4 runs at once, T95');
for (const w of ['pdf', 'many'])
  for (const arm of ARMS) {
    await Promise.all([0, 1, 2, 3].map(() => run(arm, t95, w, 1024)));
    const walls = [];
    const per = [];
    for (let i = 0; i < 5; i++) {
      globalThis.gc?.();
      const t = performance.now();
      const rs = await Promise.all([0, 1, 2, 3].map(() => run(arm, t95, w, 1024)));
      walls.push(performance.now() - t);
      if (rs.some((r) => !r.ok)) throw new Error(`${arm} ${w}: ${JSON.stringify(rs.find((r) => !r.ok))}`);
      per.push(...rs.map((r) => r.ms.total));
    }
    console.log(JSON.stringify({ w, arm, wallMedianMs: Math.round(median(walls)), perRunMedianMs: Math.round(median(per)) }));
  }
process.exit(0);
