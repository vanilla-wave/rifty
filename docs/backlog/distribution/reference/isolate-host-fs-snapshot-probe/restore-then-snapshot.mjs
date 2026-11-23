// Smallest isolate memoryLimit (MiB) for restore → snapshot with no guest code
// between, against restore → run('0') → snapshot, at the requirements' template
// scale (the dataset of packages/isolate-guest/scripts/measure-snapshot.mjs).
// From this directory, after `pnpm --dir ../../../../../packages/isolate-guest run build`:
//   node --no-node-snapshot restore-then-snapshot.mjs [rounds]
import { lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkg = fileURLToPath(new URL('../../../../../packages/isolate-guest/', import.meta.url));
const { build } = createRequire(join(pkg, 'package.json'))('esbuild');
const { createHostBridge } = await import(pathToFileURL(join(pkg, 'dist/index.js')).href);
const ivm = createRequire(join(pkg, '../isolate-host/package.json'))('isolated-vm');
const bundle = readFileSync(join(pkg, 'dist/guest.js'), 'utf8');
const rounds = Number(process.argv[2] ?? 3);

const realmFile = join(tmpdir(), `restore-then-snapshot-${process.pid}.mjs`);
await build({
  stdin: {
    contents:
      "export { createMemoryFs } from '@riftydev/vfs/internal'; export { snapshotFs } from './src/snapshot.ts';",
    resolveDir: pkg,
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

// The template-scale tree: 23 654 real files ≤ 80 kB from the pnpm store, topped up with copies.
const store = join(pkg, '../../node_modules/.pnpm');
const files = [];
const walk = (abs, rel) => {
  for (const name of readdirSync(abs).sort()) {
    if (files.length >= 23_654) return;
    const path = join(abs, name);
    const st = lstatSync(path);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(path, `${rel}/${name}`);
    else if (st.isFile() && st.size <= 80 * 1024)
      files.push([`${rel}/${name}`, readFileSync(path)]);
  }
};
for (const p of readdirSync(store).sort()) {
  if (files.length >= 23_654) break;
  const nm = join(store, p, 'node_modules');
  let names;
  try {
    names = readdirSync(nm).sort();
  } catch {
    continue;
  }
  for (const n of names) {
    const scoped = n.startsWith('@') ? readdirSync(join(nm, n)).map((s) => `${n}/${s}`) : [n];
    for (const s of scoped)
      if (!lstatSync(join(nm, s)).isSymbolicLink())
        walk(join(nm, s), `/workspace/node_modules/${s}`);
  }
}
for (let i = 0; files.length < 23_654; i++) {
  const [path, data] = files[i];
  files.push([path.replace('/workspace/node_modules/', '/workspace/node_modules/.copy/'), data]);
}
const fs = createMemoryFs().fsSync;
for (const [path, data] of files) {
  fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(path, new Uint8Array(data));
}
const options = { template: null, maxBytes: 1 << 30 };
const blob = snapshotFs(fs, options);

async function fits(memoryLimit, withRun) {
  const guest = {};
  const { functions, timeOrigin, close } = createHostBridge({
    write: () => {},
    fire: (id) => guest.fire.apply(undefined, [id]),
  });
  const iso = new ivm.Isolate({ memoryLimit });
  try {
    const context = await iso.createContext();
    const names = Object.keys(functions);
    await context.evalClosure(
      `globalThis.__riftyIsolateHost = { timeOrigin: ${timeOrigin}, ${names.map((n, i) => `${n}: $${i}`).join(', ')} };`,
      names.map((n) => new ivm.Callback(functions[n])),
    );
    await (await iso.compileScript(bundle, { filename: 'rifty-isolate-guest.js' })).run(context);
    const entry = await context.global.get('__riftyGuest', { reference: true });
    for (const name of ['fire', 'run', 'snapshot', 'restore'])
      guest[name] = await entry.get(name, { reference: true });
    await guest.restore.apply(undefined, [new Uint8Array(blob), options], {
      arguments: { copy: true },
    });
    if (withRun)
      await guest.run.apply(undefined, ['0'], {
        arguments: { copy: true },
        result: { promise: true, copy: true },
      });
    await guest.snapshot.apply(undefined, [options], {
      arguments: { copy: true },
      result: { reference: true },
    });
    return true;
  } catch {
    return false;
  } finally {
    close();
    if (!iso.isDisposed) iso.dispose();
  }
}
async function floor(withRun) {
  let lo = 64;
  let hi = 1024;
  while (hi - lo > 4) {
    const mid = Math.floor((lo + hi) / 2);
    if (await fits(mid, withRun)) hi = mid;
    else lo = mid;
  }
  return hi;
}
console.log(
  `node ${process.version}; blob ${blob.length} B (${(blob.length / 1048576).toFixed(1)} MiB), ${files.length} files`,
);
for (let r = 0; r < rounds; r++)
  console.log(
    JSON.stringify({
      round: r + 1,
      restoreThenSnapshot: await floor(false),
      restoreRunSnapshot: await floor(true),
    }),
  );
