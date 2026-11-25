#!/usr/bin/env node --expose-gc
/**
 * Template probe H — the consumer's side of a template sandbox: a host op's cost and an idle
 * sandbox's memory, ~1 MB vs ~89 MB template (same T1/T95 as `layer.mjs`). rifty's MemoryFsSync
 * and the ADR-0567 codec from source; the sandbox's own logic is the probe's (not a design).
 *
 * Arms:
 *   views   — each sandbox is a MemoryFsSync holding every template entry as a view into one
 *             shared buffer (an index per sandbox); the cap check walks the tree and encodes the
 *             entries that are not template views (O(template entries) per write).
 *   overlay — one immutable template index per process (path → entry, children), shared; a
 *             sandbox is its own MemoryFsSync of the difference + a set of deleted template paths;
 *             the cap check encodes the difference only (O(write + difference)). Hand-written
 *             host-op semantics (the review's N1/S-a: a second tree) — kept for the numbers only.
 *   layered — the chosen construction (`layered.ts`, the same code as the guest's run): rifty's
 *             MemoryFsSync with template entries materialized lazily on touch; the cap check
 *             encodes the derived difference (O(touched + difference)).
 *
 * Usage (repo root): node --expose-gc <this> <libs node_modules dir>   (as layer.mjs)
 */
import { lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repo = fileURLToPath(new URL('../../../../..', import.meta.url));
const guestPkg = join(repo, 'packages/isolate-guest');
const LIBS = process.argv[2];
if (!LIBS) throw new Error('usage: host.mjs <libs node_modules dir>');
const realmFile = join(tmpdir(), `host-realm-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `export { createMemoryFs } from '@riftydev/vfs/internal'; export { snapshotFs } from './src/snapshot.ts';
export { LayeredFs, templateLayer } from ${JSON.stringify(join(fileURLToPath(new URL('.', import.meta.url)), 'layered.ts'))};`,
    resolveDir: guestPkg,
    loader: 'ts',
  },
  nodePaths: [join(guestPkg, 'node_modules')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: realmFile,
  logLevel: 'warning',
});
const { createMemoryFs, snapshotFs, LayeredFs, templateLayer } = await import(
  pathToFileURL(realmFile).href
);
rmSync(realmFile);

// ---- templates (as layer.mjs) ----------------------------------------------------
function walkFiles(abs, rel, out, accept = () => true, enough = () => false) {
  for (const name of readdirSync(abs).sort()) {
    if (enough(out)) return out;
    const p = join(abs, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walkFiles(p, `${rel}/${name}`, out, accept, enough);
    else if (st.isFile() && accept(st.size)) out.push([`${rel}/${name}`, readFileSync(p)]);
  }
  return out;
}
const bytesOf = (files) => files.reduce((n, [, d]) => n + d.length, 0);
function filler(accept, enough) {
  const store = join(repo, 'node_modules/.pnpm');
  const out = [];
  for (const pkg of readdirSync(store).sort()) {
    if (enough(out)) break;
    try {
      walkFiles(
        join(store, pkg, 'node_modules'),
        `/node_modules/.filler/${pkg}`,
        out,
        accept,
        enough,
      );
    } catch {}
  }
  return out;
}
const semverFiles = walkFiles(join(LIBS, 'semver'), '/node_modules/semver', []);
const allLibFiles = walkFiles(LIBS, '/node_modules', []).filter(
  ([p]) => !p.includes('/.package-lock.json'),
);
const T1 = [
  ...semverFiles,
  ...filler(
    (s) => s <= 80 * 1024,
    (o) => bytesOf(semverFiles) + bytesOf(o) >= 1_000_000,
  ),
];
const T95 = [
  ...allLibFiles,
  ...filler(
    (s) => s <= 28 * 1024,
    (o) => allLibFiles.length + o.length >= 23_654 || bytesOf(allLibFiles) + bytesOf(o) >= 95e6,
  ),
];
for (let i = 0; T95.length < 23_654; i++)
  T95.push([T95[i][0].replace('/node_modules/', '/node_modules/.copy/'), T95[i][1]]);

function dirsOf(files) {
  const dirs = new Set(['/']);
  for (const [p] of files) {
    const parts = p.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) dirs.add(`/${parts.slice(0, i).join('/')}`);
  }
  return [...dirs].sort();
}
const parentOf = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
const T0 = 1_700_000_000_000;
const TIMES = { mtimeMs: T0, atimeMs: T0, ctimeMs: T0, birthtimeMs: T0 };
const BUDGET = { template: null, maxBytes: 1 << 30 };

/** One process-wide template: a packed buffer and an immutable index. */
function templateOf(files) {
  const pack = new Uint8Array(bytesOf(files));
  const entries = new Map();
  const children = new Map();
  for (const d of dirsOf(files)) {
    entries.set(d, { dir: true });
    children.set(d, []);
  }
  let off = 0;
  for (const [p, d] of files) {
    pack.set(d, off);
    entries.set(p, { dir: false, bytes: pack.subarray(off, off + d.length) });
    off += d.length;
  }
  for (const [p, e] of entries) {
    if (p === '/') continue;
    children.get(parentOf(p)).push({
      name: p.slice(parentOf(p).length + (parentOf(p) === '/' ? 0 : 1)),
      isDirectory: e.dir,
    });
  }
  const rows = [];
  for (const [p, e] of entries) {
    if (p === '/') continue;
    rows.push(
      e.dir
        ? [1, p, 0, 0, T0, T0, T0, T0]
        : [2, p, e.bytes.byteOffset, e.bytes.length, T0, T0, T0, T0],
    );
  }
  return { files, pack, entries, children, layer: templateLayer(pack, rows) };
}

// ---- arm: layered (the chosen construction) ------------------------------------------
function layeredSandbox(tpl) {
  const fs = new LayeredFs(tpl.layer);
  for (const d of ['/workspace', '/tmp']) fs.mkdirSync(d, { recursive: true });
  const capCheck = () => snapshotFs(fs.difference().entries, BUDGET).length;
  return {
    writeFile(p, data) {
      fs.mkdirSync(parentOf(p), { recursive: true });
      fs.writeFileSync(p, data);
      capCheck();
    },
    readFile: (p) => fs.readFileBytesSync(p),
    list: (p) => fs.readdirSync(p).map((d) => d.name),
    remove: (p) => fs.rmSync(p, { recursive: true }),
  };
}

// ---- arm: views ---------------------------------------------------------------------
function viewsSandbox(tpl) {
  const fs = createMemoryFs().fsSync;
  const own = new WeakSet();
  for (const [p, e] of tpl.entries) {
    if (p === '/') continue;
    if (e.dir) fs.mkdirSync(p, { recursive: true });
    else {
      fs.writeFileSync(p, e.bytes);
      own.add(fs.readFileBytesSync(p));
    }
    fs.restoreStatSync(p, TIMES);
  }
  for (const d of ['/workspace', '/tmp']) fs.mkdirSync(d, { recursive: true });
  const capCheck = () => {
    const diff = createMemoryFs().fsSync;
    const walk = (dir) => {
      for (const d of fs.readdirSync(dir)) {
        const p = `${dir === '/' ? '' : dir}/${d.name}`;
        if (d.isDirectory) walk(p);
        else if (!own.has(fs.readFileBytesSync(p))) {
          diff.mkdirSync(parentOf(p), { recursive: true });
          diff.writeFileSync(p, fs.readFileBytesSync(p));
        }
      }
    };
    walk('/');
    return snapshotFs(diff, BUDGET).length;
  };
  return {
    writeFile(p, data) {
      fs.mkdirSync(parentOf(p), { recursive: true });
      fs.writeFileSync(p, data);
      capCheck();
    },
    readFile: (p) => fs.readFileBytesSync(p),
    list: (p) => fs.readdirSync(p).map((d) => d.name),
    remove: (p) => fs.rmSync(p, { recursive: true }),
  };
}

// ---- arm: overlay ---------------------------------------------------------------------
function overlaySandbox(tpl) {
  const up = createMemoryFs().fsSync;
  for (const d of ['/workspace', '/tmp']) up.mkdirSync(d, { recursive: true });
  const deleted = new Set();
  const gone = (p) => {
    for (let q = p; ; q = parentOf(q)) {
      if (deleted.has(q)) return true;
      if (q === '/') return false;
    }
  };
  const low = (p) => (gone(p) ? undefined : tpl.entries.get(p));
  const copyUp = (d) => {
    if (up.existsSync(d)) return;
    copyUp(parentOf(d));
    up.mkdirSync(d, {});
  };
  const capCheck = () => snapshotFs(up, BUDGET).length + deleted.size * 400;
  return {
    writeFile(p, data) {
      const parent = parentOf(p);
      if (!up.existsSync(parent)) copyUp(parent);
      up.writeFileSync(p, data);
      capCheck();
    },
    readFile: (p) => (up.existsSync(p) ? up.readFileBytesSync(p) : low(p).bytes),
    list(p) {
      const names = new Set(low(p)?.dir ? tpl.children.get(p).map((c) => c.name) : []);
      for (const n of [...names]) if (gone(`${p}/${n}`)) names.delete(n);
      if (up.existsSync(p)) for (const d of up.readdirSync(p)) names.add(d.name);
      return [...names].sort();
    },
    remove(p) {
      if (up.existsSync(p)) up.rmSync(p, { recursive: true });
      if (tpl.entries.has(p)) deleted.add(p);
    },
  };
}

// ---- measure ---------------------------------------------------------------------------
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const r1 = (x) => Math.round(x * 100) / 100;
function time(fn, n = 21) {
  const xs = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    fn(i);
    xs.push(performance.now() - t);
  }
  return r1(median(xs));
}
const heap = () => {
  globalThis.gc();
  globalThis.gc();
  return process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers;
};

console.log(`node ${process.version}, ${process.platform}/${process.arch}`);
const chunk = new Uint8Array(10 * 1024).fill(7);
for (const [label, files] of [
  ['T1', T1],
  ['T95', T95],
]) {
  const tpl = templateOf(files);
  console.log(`\n## ${label}: ${files.length} files, ${(bytesOf(files) / 1e6).toFixed(1)} MB`);
  for (const [arm, make] of [
    ['views', viewsSandbox],
    ['overlay', overlaySandbox],
    ['layered', layeredSandbox],
  ]) {
    const t = performance.now();
    const sb = make(tpl);
    const create = r1(performance.now() - t);
    const tplFile = files.find(
      ([p]) => p.startsWith('/node_modules/semver/') && p.endsWith('.js'),
    )[0];
    const row = {
      tpl: label,
      arm,
      createMs: create,
      writeFile10KiBMs: time((i) => sb.writeFile(`/workspace/out/f${i}.bin`, chunk)),
      writeTemplateFileMs: time(() => sb.writeFile(tplFile, chunk)),
      readTemplateFileMs: time(() => sb.readFile(tplFile)),
      listNodeModulesMs: time(() => sb.list('/node_modules')),
      removeMs: time((i) => sb.remove(`/workspace/out/f${i}.bin`)),
    };
    // Idle memory per sandbox: 20 sandboxes, one small own file each, held.
    const before = heap();
    const held = [];
    for (let i = 0; i < 20; i++) {
      const s = make(tpl);
      s.writeFile('/workspace/main.js', chunk);
      held.push(s);
    }
    row.idleKiBPerSandbox = Math.round((heap() - before) / 20 / 1024);
    held.length = 0;
    console.log(JSON.stringify(row));
  }
}
process.exit(0);
