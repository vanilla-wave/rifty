#!/usr/bin/env node --no-node-snapshot --expose-gc
/**
 * Template probe F — the F1 return condition's metric on real programs (review S2): the four
 * libraries' canonical generators (`../isolate-library-probe/gen/*.cjs`) over the four-library
 * `node_modules` (npm ci of `../isolate-library-probe/deps`), worker side, fresh isolate per run:
 *   layered — the template as `layered.ts` (ADR-0572 §2–3): restore (template copy + index +
 *             the sandbox's own files) + run + capture;
 *   state   — no template: the same files inside the sandbox's state (today's path); only its run
 *             phase is counted (its restore/capture are the O(state) cost the template removes),
 *             so `layered − state` = what the template mechanism adds to a real program.
 * Plus an empty file (the fixed cost), the smallest passing `memoryLimit` (4 MiB steps), and four
 * runs at once.
 *
 *   node --no-node-snapshot --expose-gc <this> <node_modules of npm ci ../isolate-library-probe/deps>
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
const ivm = createRequire(join(repo, 'packages/isolate-host/package.json'))('isolated-vm');
const { createHostBridge } = await import(join(guestPkg, 'dist/index.js'));
const NM = process.argv[2];
if (!NM) throw new Error('usage: gens.mjs <four-library node_modules>');
const nodePaths = [join(guestPkg, 'node_modules')];

const bundleFile = join(tmpdir(), `gens-guest-${process.pid}.js`);
await build({
  absWorkingDir: guestPkg,
  stdin: {
    contents: readFileSync(join(here, 'probe-guest.ts'), 'utf8').replace(
      '__LAYERED__',
      join(here, 'layered.ts'),
    ),
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
const realmFile = join(tmpdir(), `gens-realm-${process.pid}.mjs`);
await build({
  stdin: {
    contents:
      "export { createMemoryFs } from '@riftydev/vfs/internal'; export { snapshotFs } from './src/snapshot.ts';",
    resolveDir: guestPkg,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: realmFile,
  logLevel: 'warning',
});
const { createMemoryFs, snapshotFs } = await import(pathToFileURL(realmFile).href);
rmSync(realmFile);

// ---- the template: the four libraries' node_modules ------------------------------------------
const files = [];
(function walk(abs, rel) {
  for (const name of readdirSync(abs).sort()) {
    const p = join(abs, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(p, `${rel}/${name}`);
    else if (st.isFile() && !p.endsWith('/.package-lock.json'))
      files.push([`${rel}/${name}`, readFileSync(p)]);
  }
})(NM, '/node_modules');
const T0 = 1_700_000_000_000;
const TIMES = { mtimeMs: T0, atimeMs: T0, ctimeMs: T0, birthtimeMs: T0 };
const dirsOf = (fs) => {
  const dirs = new Set(['/']);
  for (const [p] of fs) {
    const parts = p.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) dirs.add(`/${parts.slice(0, i).join('/')}`);
  }
  return [...dirs].sort();
};
const pack = new Uint8Array(files.reduce((n, [, d]) => n + d.length, 0));
const rows = dirsOf(files)
  .filter((d) => d !== '/')
  .map((d) => [1, d, 0, 0, T0, T0, T0, T0]);
{
  let off = 0;
  for (const [p, d] of files) {
    pack.set(d, off);
    rows.push([2, p, off, d.length, T0, T0, T0, T0]);
    off += d.length;
  }
}
const index = JSON.stringify(rows);
const refs = JSON.stringify([['/node_modules', 'lazy', '/node_modules', TIMES]]);
const OPTS = { template: null, maxBytes: 1 << 30 };
function blobOf(list) {
  const { fsSync } = createMemoryFs();
  for (const d of dirsOf(list)) if (d !== '/') fsSync.mkdirSync(d, { recursive: true });
  for (const [p, d] of list) fsSync.writeFileSync(p, new Uint8Array(d));
  for (const p of [...dirsOf(list), ...list.map(([q]) => q)]) fsSync.restoreStatSync(p, TIMES);
  return snapshotFs(fsSync, OPTS);
}
const GEN = join(here, '../isolate-library-probe/gen');
const W = {
  empty: '',
  pdf: readFileSync(join(GEN, 'pdf.cjs'), 'utf8'),
  docx: readFileSync(join(GEN, 'docx.cjs'), 'utf8'),
  pptx: readFileSync(join(GEN, 'pptx.cjs'), 'utf8'),
  xlsx: readFileSync(join(GEN, 'xlsx.cjs'), 'utf8'),
};
const own = (w) => [
  ['/workspace/main.js', Buffer.from(W[w])],
  ['/tmp/.keep', Buffer.alloc(0)],
];
const blobs = {};
for (const w of Object.keys(W)) {
  blobs[w] = { own: blobOf(own(w)), state: blobOf([...files, ...own(w)]) };
}

let cachedData;
async function run(arm, w, memoryLimit) {
  const out = [];
  const g = {};
  const { functions, timeOrigin, close } = createHostBridge({
    write: (_fd, b) => out.push(Buffer.from(b).toString()),
    fire: (id) => g.fire.apply(undefined, [id]),
  });
  const iso = new ivm.Isolate({ memoryLimit });
  const t = { start: performance.now() };
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
    t.boot = performance.now();
    const entry = await context.global.get('__riftyGuest', { reference: true });
    const probe = await context.global.get('__probe', { reference: true });
    g.fire = await entry.get('fire', { reference: true });
    const restore = await entry.get('restore', { reference: true });
    await restore.apply(
      undefined,
      [
        new ivm.ExternalCopy(arm === 'state' ? blobs[w].state : blobs[w].own).copyInto({
          release: true,
        }),
        OPTS,
      ],
      {
        arguments: { copy: true },
      },
    );
    if (arm === 'layered')
      await (await probe.get('layered', { reference: true })).apply(
        undefined,
        [new ivm.ExternalCopy(pack).copyInto({ release: true }), index, refs],
        { arguments: { copy: true } },
      );
    t.restore = performance.now();
    const code = await (await entry.get('runFile', { reference: true })).apply(
      undefined,
      ['/workspace/main.js', ['/workspace/out.bin']],
      {
        arguments: { copy: true },
        result: { promise: true, copy: true },
      },
    );
    t.run = performance.now();
    if (arm === 'layered')
      await (await probe.get('layeredCapture', { reference: true })).apply(undefined, [1 << 30], {
        result: { copy: true },
      });
    t.capture = performance.now();
    const ms = arm === 'layered' ? t.capture - t.boot : t.run - t.restore;
    return { ok: code === 0, ms, out: out.join('').slice(0, 300) };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  } finally {
    close();
    if (!iso.isDisposed) iso.dispose();
  }
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function floor(arm, w) {
  let lo = 8;
  let hi = 1024;
  while (hi - lo > 4) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await run(arm, w, mid)).ok) hi = mid;
    else lo = mid;
  }
  return hi;
}

console.log(
  `node ${process.version}, isolated-vm 7.0.2, ${process.platform}/${process.arch}; template: ${files.length} files, ${(pack.length / 1e6).toFixed(1)} MB`,
);
for (const w of Object.keys(W)) {
  const row = { w };
  for (const arm of ['state', 'layered']) {
    const first = await run(arm, w, 1024);
    if (!first.ok) {
      row[arm] = { failed: first };
      continue;
    }
    const xs = [];
    for (let i = 0; i < 7; i++) {
      globalThis.gc?.();
      xs.push((await run(arm, w, 1024)).ms);
    }
    row[arm] = Math.round(median(xs));
  }
  if (typeof row.state === 'number' && typeof row.layered === 'number')
    row.added = row.layered - row.state;
  if (w === 'empty') {
    row.floorStateMiB = await floor('state', w);
    row.floorLayeredMiB = await floor('layered', w);
  }
  console.log(JSON.stringify(row));
}
console.log('\n## four runs at once (wall, ms; state = its run phases only, the longest)');
for (const w of ['pdf', 'xlsx']) {
  const res = {};
  for (const arm of ['state', 'layered']) {
    const walls = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      const rs = await Promise.all([0, 1, 2, 3].map(() => run(arm, w, 1024)));
      walls.push(arm === 'state' ? Math.max(...rs.map((r) => r.ms)) : performance.now() - t);
    }
    res[arm] = Math.round(median(walls));
  }
  console.log(JSON.stringify({ w, ...res }));
}
process.exit(0);
