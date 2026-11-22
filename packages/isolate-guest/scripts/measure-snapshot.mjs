#!/usr/bin/env node --no-node-snapshot
/**
 * Cost of the FS snapshot (README §Snapshot, ADR-0567). Usage, from the package
 * directory after `pnpm run build`:
 *
 *   node --no-node-snapshot scripts/measure-snapshot.mjs
 *
 * Two trees of real files from the workspace's `node_modules/.pnpm`: ~10 files /
 * ~1 MB and the requirements' template scale (23 654 files ≤ 80 kB, topped up
 * with copies of real files when the store holds fewer). For each: blob
 * bytes; snapshot and restore in the consumer's Node realm and in a real
 * isolated-vm isolate (in-isolate time, then the ivm copy of the blob); the
 * smallest isolate `memoryLimit` at which restore, and restore → `run` →
 * snapshot (a sandbox run), still succeed. Median of 5 for times.
 */
import { lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createHostBridge } from '../dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const ivm = createRequire(join(root, '../isolate-host/package.json'))('isolated-vm');
const bundle = readFileSync(join(root, 'dist/guest.js'), 'utf8');

// The Node-realm codec and rifty MemoryFs, from source.
const realmFile = join(tmpdir(), `measure-snapshot-${process.pid}.mjs`);
await build({
  stdin: {
    contents:
      "export { createMemoryFs } from '@riftydev/vfs/internal'; export { snapshotFs, restoreFs } from './src/snapshot.ts';",
    resolveDir: root,
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

/** Real files under the workspace's pnpm store, in a stable order. */
function realFiles(accept, enough) {
  const store = join(root, '../../node_modules/.pnpm');
  const out = [];
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs).sort()) {
      if (enough(out)) return;
      const path = join(abs, name);
      const st = lstatSync(path);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(path, `${rel}/${name}`);
      else if (st.isFile() && accept(st.size)) out.push([`${rel}/${name}`, readFileSync(path)]);
    }
  };
  for (const pkg of readdirSync(store).sort()) {
    if (enough(out)) break;
    const nm = join(store, pkg, 'node_modules');
    let names;
    try {
      names = readdirSync(nm).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const scoped = name.startsWith('@')
        ? readdirSync(join(nm, name)).map((s) => `${name}/${s}`)
        : [name];
      for (const s of scoped) {
        if (lstatSync(join(nm, s)).isSymbolicLink()) continue;
        walk(join(nm, s), `/workspace/node_modules/${s}`);
      }
    }
  }
  return out;
}

function treeOf(files) {
  const fs = createMemoryFs().fsSync;
  for (const [path, data] of files) {
    fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    fs.writeFileSync(path, new Uint8Array(data));
  }
  return fs;
}

async function isolate(memoryLimit) {
  const guest = {};
  const { functions, timeOrigin, close } = createHostBridge({
    write: () => {},
    fire: (id) => guest.fire.apply(undefined, [id]),
  });
  const iso = new ivm.Isolate({ memoryLimit });
  const context = await iso.createContext();
  const names = Object.keys(functions);
  await context.evalClosure(
    `globalThis.__riftyIsolateHost = { timeOrigin: ${timeOrigin}, ${names.map((n, i) => `${n}: $${i}`).join(', ')} };`,
    names.map((n) => new ivm.Callback(functions[n])),
  );
  await (await iso.compileScript(bundle, { filename: 'rifty-isolate-guest.js' })).run(context);
  const entry = await context.global.get('__riftyGuest', { reference: true });
  Object.assign(guest, {
    fire: await entry.get('fire', { reference: true }),
    run: await entry.get('run', { reference: true }),
    snapshot: await entry.get('snapshot', { reference: true }),
    restore: await entry.get('restore', { reference: true }),
  });
  const dispose = () => {
    close();
    if (!iso.isDisposed) iso.dispose();
  };
  return { guest, dispose };
}

/** The guest code between restore and snapshot (argv: `RUN=<code>`); default an empty program. */
const RUN = process.argv.find((a) => a.startsWith('RUN='))?.slice(4) ?? '0';
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (t) => Number((performance.now() - t).toFixed(1));

async function measure(label, files) {
  const options = { template: null, maxBytes: 1 << 30 };
  const source = treeOf(files);
  const bytes = files.reduce((n, [, d]) => n + d.length, 0);
  const runs = {
    nodeSnapshot: [],
    nodeRestore: [],
    isoRestore: [],
    copyIn: [],
    isoSnapshot: [],
    copyOut: [],
  };
  let blob;
  for (let r = 0; r < 5; r++) {
    let t = performance.now();
    blob = snapshotFs(source, options);
    runs.nodeSnapshot.push(ms(t));
    t = performance.now();
    restoreFs(createMemoryFs().fsSync, blob, options);
    runs.nodeRestore.push(ms(t));
    const { guest, dispose } = await isolate(4096);
    // Host → isolate: the blob's own range (an exact copy), then restore inside.
    t = performance.now();
    const inside = new ivm.ExternalCopy(new Uint8Array(blob)).copyInto({ release: true });
    runs.copyIn.push(ms(t));
    t = performance.now();
    await guest.restore.apply(undefined, [inside, options], { arguments: { copy: true } });
    runs.isoRestore.push(ms(t));
    t = performance.now();
    const ref = await guest.snapshot.apply(undefined, [options], {
      arguments: { copy: true },
      result: { reference: true },
    });
    runs.isoSnapshot.push(ms(t));
    t = performance.now();
    const out = await ref.copy();
    runs.copyOut.push(ms(t));
    if (!Buffer.from(out).equals(Buffer.from(blob)))
      throw new Error(`${label}: isolate re-snapshot differs`);
    dispose();
  }
  const floor = async (phase) => {
    let lo = 16;
    let hi = 4096;
    while (hi - lo > 4) {
      const mid = Math.floor((lo + hi) / 2);
      const { guest, dispose } = await isolate(mid);
      let ok = true;
      try {
        await guest.restore.apply(undefined, [new Uint8Array(blob), options], {
          arguments: { copy: true },
        });
        // As a sandbox run goes: restore → guest code → snapshot.
        if (phase === 'snapshot') {
          await guest.run.apply(undefined, [RUN], {
            arguments: { copy: true },
            result: { promise: true, copy: true },
          });
          await guest.snapshot.apply(undefined, [options], {
            arguments: { copy: true },
            result: { reference: true },
          });
        }
      } catch {
        ok = false;
      }
      dispose();
      if (ok) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  const empty = await (async () => {
    let lo = 4;
    let hi = 256;
    while (hi - lo > 2) {
      const mid = Math.floor((lo + hi) / 2);
      try {
        const { dispose } = await isolate(mid);
        dispose();
        hi = mid;
      } catch {
        lo = mid;
      }
    }
    return hi;
  })();
  return {
    label,
    files: files.length,
    fileBytes: bytes,
    blobBytes: blob.length,
    ms: Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, median(v)])),
    memoryLimitMiB: {
      emptyGuest: empty,
      restore: await floor('restore'),
      restoreRunSnapshot: await floor('snapshot'),
    },
  };
}

const small = realFiles(
  (size) => size >= 64 * 1024 && size <= 160 * 1024,
  (out) => out.reduce((n, [, d]) => n + d.length, 0) >= 1_000_000 || out.length >= 10,
);
const TEMPLATE_FILES = 23_654;
const template = realFiles(
  (size) => size <= 80 * 1024,
  (out) => out.length >= TEMPLATE_FILES,
);
// The store may hold fewer small files: top up with copies of real ones under another dir.
for (let i = 0; template.length < TEMPLATE_FILES; i++) {
  const [path, data] = template[i];
  template.push([path.replace('/workspace/node_modules/', '/workspace/node_modules/.copy/'), data]);
}
console.log(
  `node ${process.version}, isolated-vm ${createRequire(join(root, '../isolate-host/package.json'))('isolated-vm/package.json').version}`,
);
const ONLY_BUDGET = process.argv.includes('--budget-only');
if (!ONLY_BUDGET)
  for (const [label, files] of [
    ['small', small],
    ['template scale', template],
  ])
    console.log(JSON.stringify(await measure(label, files)));

/**
 * The densest blob a budget admits (empty directories, short names): the worst
 * case a consumer pays for bytes a guest wrote. Node: restore time and retained
 * heap (run with `--expose-gc` for a clean heap figure); isolate: restore time
 * and memory floor.
 */
/** The largest `grow(k)` tree that snapshots within the budget (bisection on k). */
function largest(grow, max, options) {
  let lo = 1;
  let hi = max;
  let blob = snapshotFs(grow(1), options);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    try {
      blob = snapshotFs(grow(mid), options);
      lo = mid;
    } catch {
      hi = mid;
    }
  }
  return blob;
}
const flatDirs = (k) => {
  const fs = createMemoryFs().fsSync;
  for (let i = 0; i < k; i++) fs.mkdirSync(`/${i.toString(36)}`, { recursive: false });
  return fs;
};
const chain = (depth, leaves = 0) => {
  const fs = createMemoryFs().fsSync;
  let path = '';
  for (let i = 0; i < depth; i++) {
    path += '/a';
    fs.mkdirSync(path, { recursive: false });
  }
  for (let i = 0; i < leaves; i++) fs.mkdirSync(`${path}/${i.toString(36)}`, { recursive: false });
  return fs;
};

async function measureDense(label, maxBytes, grow, max) {
  const options = { template: null, maxBytes };
  const blob = largest(grow, max, options);
  const n = new DataView(blob.buffer).getUint32(0, true) && countEntries(blob);
  globalThis.gc?.();
  const heap0 = process.memoryUsage().heapUsed;
  let t = performance.now();
  const kept = createMemoryFs().fsSync;
  restoreFs(kept, blob, options);
  const nodeRestore = ms(t);
  globalThis.gc?.();
  const nodeHeapMiB = Math.round((process.memoryUsage().heapUsed - heap0) / 1048576);
  const { guest, dispose } = await isolate(4096);
  t = performance.now();
  await guest.restore.apply(undefined, [blob, options], { arguments: { copy: true } });
  const isoRestore = ms(t);
  dispose();
  let lo = 16;
  let hi = 4096;
  while (hi - lo > 4) {
    const mid = Math.floor((lo + hi) / 2);
    const x = await isolate(mid);
    let ok = true;
    try {
      await x.guest.restore.apply(undefined, [blob, options], { arguments: { copy: true } });
    } catch {
      ok = false;
    }
    x.dispose();
    if (ok) hi = mid;
    else lo = mid;
  }
  return {
    label: `${label} within maxBytes ${maxBytes >> 20} MiB`,
    entries: n,
    blobBytes: blob.length,
    ms: { nodeRestore, isoRestore },
    nodeRetainedHeapMiB: nodeHeapMiB,
    isolateRestoreFloorMiB: hi,
  };
}
/** Entries in a v1 blob without a template: walk the records. */
function countEntries(blob) {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  let o = 13;
  let n = 0;
  for (;;) {
    const kind = blob[o++];
    if (kind === 0) return n;
    n++;
    const units = view.getUint32(o, true);
    o += 4 + 2 * units + 32;
    if (kind === 2) o += 8 + view.getFloat64(o, true);
  }
}
for (const [label, grow, max] of ONLY_BUDGET
  ? []
  : [
      ['flat empty dirs', flatDirs, 400_000],
      ['deepest chain /a/a/…', chain, 20_000],
      ['chain of 300 + leaves at its bottom', (k) => chain(300, k), 400_000],
      [
        'files with 16 383-unit names under a dir with one too',
        (k) => {
          const fs = createMemoryFs().fsSync;
          const deep = `/${'d'.repeat(16_383)}`;
          fs.mkdirSync(deep, { recursive: false });
          for (let i = 0; i < k; i++)
            fs.writeFileSync(
              `${deep}/${String(i).padStart(5, '0')}${'n'.repeat(16_378)}`,
              new Uint8Array(0),
            );
          return fs;
        },
        4_000,
      ],
    ])
  console.log(JSON.stringify(await measureDense(label, 64 << 20, grow, max)));
// Budget the template-scale tree needs: bytes + 384 per entry + 8 per path unit + 80 per level.
{
  const entries = new Map([['/', 0]]);
  for (const [path] of template) {
    const parts = path.split('/').slice(1);
    for (let i = 1; i <= parts.length; i++) entries.set(`/${parts.slice(0, i).join('/')}`, i);
  }
  const depthSum = [...entries.values()].reduce((a, b) => a + b, 0);
  const unitSum = [...entries.keys()].reduce((a, p) => a + p.length, 0);
  const blob = snapshotFs(treeOf(template), { template: null, maxBytes: 1 << 30 });
  console.log(
    JSON.stringify({
      label: 'template-scale budget',
      entries: entries.size,
      blobBytes: blob.length,
      budgetBytes: blob.length + 384 * entries.size + 8 * unitSum + 80 * depthSum,
    }),
  );
}
