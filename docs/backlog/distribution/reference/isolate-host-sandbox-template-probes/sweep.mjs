#!/usr/bin/env node --expose-gc
/**
 * Template probe W — the cost sweep (fourth review, Б1: every «does not grow with the template»
 * claim is a row here with slope ≈ 0; every non-zero slope is a named dependency). Consumer side,
 * `layered.ts` (ADR-0572 §2), synthetic templates `/node_modules/pkg-NNNNN/…`, one axis at a time
 * from a base (100 packages × 5 files × 4 KiB, package depth 2):
 *   bytes  — file size 4 KiB → 64 KiB (×16 bytes, same entries);
 *   width  — packages 10 / 100 / 1 000 / 5 000 (the fan-out of `/node_modules`);
 *   files  — files per package 5 → 50 (entries ×10, same width);
 *   depth  — package depth 2 → 6 → 12.
 * Operations × places: a host `writeFile` (10 B), `readFile`, `list`, `remove` (of the file just
 * written) at `/workspace/x.js`, `/node_modules/new.js` (a template directory at depth 0),
 * `/node_modules/pkg-00000/new.js` (depth 1), `/node_modules/pkg-00000/lib/new.js` (depth 2); and
 * what one `exec` then carries: the state on the wire (rows, JSON bytes of rows + blob bytes) and
 * the cap's count. Median of 21 for times; each cell on a fresh sandbox.
 *
 *   node --expose-gc docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/sweep.mjs
 */
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repo = fileURLToPath(new URL('../../../../..', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
const guestPkg = join(repo, 'packages/isolate-guest');
const realmFile = join(tmpdir(), `sweep-realm-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `export { LayeredFs, templateLayer } from ${JSON.stringify(join(here, 'layered.ts'))};
export { snapshotFs } from './src/snapshot.ts';`,
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
const R = await import(pathToFileURL(realmFile).href);
rmSync(realmFile);

const T0 = 1_700_000_000_000;
function template({ width, files, size, depth }) {
  const dirs = new Set(['/node_modules']);
  const list = [];
  for (let i = 0; i < width; i++) {
    let d = `/node_modules/pkg-${String(i).padStart(5, '0')}`;
    dirs.add(d);
    for (let k = 1; k < depth; k++) {
      d = `${d}/${k === 1 ? 'lib' : `l${k}`}`;
      dirs.add(d);
    }
    for (let f = 0; f < files; f++) list.push(`${d}/f${f}.js`);
  }
  const pack = new Uint8Array(list.length * size).fill(97);
  const rows = [...dirs].sort().map((d) => [1, d, 0, 0, T0, T0, T0, T0]);
  list.forEach((p, i) => rows.push([2, p, i * size, size, T0, T0, T0, T0]));
  return {
    layer: R.templateLayer(pack, rows),
    entries: dirs.size + list.length,
    bytes: pack.length,
  };
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const OPTS = { template: null, maxBytes: 1 << 30 };
const PLACES = {
  workspace: '/workspace/x.js',
  'tpl depth 0': '/node_modules/new.js',
  'tpl depth 1': '/node_modules/pkg-00000/new.js',
  'tpl depth 2': '/node_modules/pkg-00000/lib/new.js',
};
const data = new Uint8Array(10).fill(1);
function fresh(t) {
  const L = new R.LayeredFs(t.layer);
  for (const d of ['/workspace', '/tmp']) L.mkdirSync(d, { recursive: true });
  return L;
}
/** Host ops as sandbox.ts does them, the cap check included in writes. */
const host = {
  write(L, p) {
    L.mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true });
    L.writeFileSync(p, data);
    L.budget();
  },
  read: (L, p) => L.readFileBytesSync(p),
  list: (L, p) => L.readdirSync(p.slice(0, p.lastIndexOf('/')) || '/'),
  remove(L, p) {
    L.rmSync(p, { recursive: true });
    L.budget();
  },
};
function cell(t, place) {
  const p = PLACES[place];
  const out = {};
  for (const op of Object.keys(host)) {
    const xs = [];
    for (let i = 0; i < 21; i++) {
      const L = fresh(t);
      if (op !== 'write') host.write(L, p);
      const s = performance.now();
      host[op](L, p);
      xs.push(performance.now() - s);
    }
    out[`${op}Ms`] = Math.round(median(xs) * 1000) / 1000;
  }
  const L = fresh(t);
  host.write(L, p);
  const w = L.toWire();
  out.rows = w.refs.length;
  out.wireBytes = R.snapshotFs(w.entries, OPTS).length + JSON.stringify(w.refs).length;
  out.budget = L.budget();
  return out;
}

const BASE = { width: 100, files: 5, size: 4096, depth: 2 };
const AXES = [
  ['bytes', [{ size: 4096 }, { size: 65_536 }]],
  ['width', [{ width: 10 }, { width: 100 }, { width: 1000 }, { width: 5000 }]],
  ['files', [{ files: 5 }, { files: 50 }]],
  ['depth', [{ depth: 2 }, { depth: 6 }, { depth: 12 }]],
];
console.log(
  `node ${process.version}, ${process.platform}/${process.arch}; base ${JSON.stringify(BASE)}`,
);
const all = [];
for (const [axis, values] of AXES) {
  console.log(`\n## axis ${axis}`);
  for (const v of values) {
    const shape = { ...BASE, ...v };
    const t = template(shape);
    for (const place of Object.keys(PLACES)) {
      const c = cell(t, place);
      const row = {
        axis,
        ...v,
        entries: t.entries,
        templateMB: +(t.bytes / 1e6).toFixed(1),
        place,
        ...c,
      };
      all.push(row);
      console.log(JSON.stringify(row));
    }
  }
}
// Slopes: for each axis × place × metric, last value / first value (≈ 1 = flat).
console.log('\n## ratio last / first value along each axis (≈ 1: does not grow)');
for (const [axis] of AXES) {
  for (const place of Object.keys(PLACES)) {
    const rs = all.filter((r) => r.axis === axis && r.place === place);
    const a = rs[0];
    const b = rs[rs.length - 1];
    const ratio = {};
    for (const k of ['writeMs', 'readMs', 'listMs', 'removeMs', 'rows', 'wireBytes', 'budget'])
      ratio[k] = a[k] === 0 ? (b[k] === 0 ? 1 : 'inf') : Math.round((b[k] / a[k]) * 100) / 100;
    console.log(JSON.stringify({ axis, place, ...ratio }));
  }
}
process.exit(0);
