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
for (const [label, files] of [
  ['small', small],
  ['template scale', template],
])
  console.log(JSON.stringify(await measure(label, files)));
