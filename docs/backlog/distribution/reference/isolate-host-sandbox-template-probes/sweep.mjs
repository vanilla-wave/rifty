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
 * Scenarios (each timed on a fresh sandbox, median of 21; after it: what the next `exec` carries —
 * rows, wire bytes = blob + rows' JSON — and the cap's count): host writes at `/workspace` and in
 * template directories of depth 0/1/2, a removal, a FIRST read / list / stat of template entries,
 * a rename of a template directory, a copy into one, a `/workspace` write after one template
 * write (rows already on the wire), and an idle sandbox's memory, fresh and after one listing.
 * Review 5, Б-П — the sum axis: the host touching k directories (10 packages, every directory:
 * the ceiling — a whole walk, `readdir` + `stat` of every entry), what the next `exec` carries and
 * the cap after it, and idle memory after the whole walk; idle memory after a run boundary (the
 * sandbox rebuilt from its wire, as the consumer does after a run) following the whole walk, and
 * following one write in a package. Review 6: `/workspace` write / remove / rename and a no-op
 * `mkdir -p` timed 201 times on one sandbox, fresh and after the whole walk; idle memory measured
 * in a child process per template point.
 *
 *   node --expose-gc docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/sweep.mjs [REAL_NODE_MODULES]
 *
 * With REAL_NODE_MODULES (npm ci of ../isolate-library-probe/deps): the same scenarios on the
 * real four-library tree, package = `pdf-lib`, absolute figures for the consumer's template.
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
export { MemoryFsSync } from '@riftydev/vfs/internal';
export { snapshotFs, restoreFs } from './src/snapshot.ts';`,
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
    firstFile: list[0],
    pkg: '/node_modules/pkg-00000',
  };
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const OPTS = { template: null, maxBytes: 1 << 30 };
const FILE0 = (t) => t.firstFile;
const data = new Uint8Array(10).fill(1);
function fresh(t) {
  const L = new R.LayeredFs(t.layer);
  for (const d of ['/workspace', '/tmp']) L.mkdirSync(d, { recursive: true });
  return L;
}
function hostWrite(L, p) {
  L.mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true });
  L.writeFileSync(p, data);
  L.budget();
}
/** Every directory under `from`, the template's included, `readdir` + `stat` of each entry. */
function walk(L, from) {
  for (const n of L.readdirSync(from)) {
    const q = `${from}/${n.name}`;
    L.statSync(q);
    if (n.isDirectory) walk(L, q);
  }
}
/** A run boundary: the sandbox rebuilt from its wire on a fresh view (ADR-0572 §3). */
function rebuild(L, t) {
  const w = L.toWire();
  const e = new R.MemoryFsSync();
  R.restoreFs(e, R.snapshotFs(w.entries, OPTS), OPTS);
  return R.LayeredFs.fromWire(t.layer, e, JSON.parse(JSON.stringify(w.refs)));
}
const packages = (L, k) =>
  L.readdirSync('/node_modules')
    .filter((n) => n.isDirectory)
    .slice(0, k)
    .map((n) => `/node_modules/${n.name}`);
const SCENARIOS = {
  'write /workspace': { op: (L) => hostWrite(L, '/workspace/x.js') },
  'write tpl depth 0': { op: (L) => hostWrite(L, '/node_modules/new.js') },
  'write tpl depth 1': { op: (L, t) => hostWrite(L, `${t.pkg}/new.js`) },
  'write tpl depth 2': { op: (L, t) => hostWrite(L, `${t.pkg}/lib/new.js`) },
  'remove tpl depth 1': {
    setup: (L, t) => hostWrite(L, `${t.pkg}/new.js`),
    op: (L, t) => {
      L.rmSync(`${t.pkg}/new.js`, { recursive: true });
      L.budget();
    },
  },
  'first read of a tpl file': { op: (L, t) => L.readFileBytesSync(FILE0(t)) },
  'first list /node_modules': { op: (L) => L.readdirSync('/node_modules') },
  'first stat /node_modules': { op: (L) => L.statSync('/node_modules') },
  'rename a tpl package': {
    op: (L, t) => {
      L.renameSync(t.pkg, '/node_modules/pkg-moved');
      L.budget();
    },
  },
  'cp 1 file into a tpl package': {
    setup: (L) => hostWrite(L, '/workspace/src/one.js'),
    op: (L, t) => {
      L.cpSync('/workspace/src', t.pkg, { recursive: true });
      L.budget();
    },
  },
  'remove a tpl file (fresh)': {
    op: (L, t) => {
      L.rmSync(t.firstFile, { recursive: true });
      L.budget();
    },
  },
  // After the host listed every template directory it can reach in one level (records held).
  'remove /workspace file after listing the template': {
    setup: (L) => {
      hostWrite(L, '/workspace/z.js');
      for (const n of L.readdirSync('/node_modules'))
        if (n.isDirectory) L.readdirSync(`/node_modules/${n.name}`);
    },
    op: (L) => {
      L.rmSync('/workspace/z.js', { recursive: true });
      L.budget();
    },
  },
  'rename /workspace file after listing the template': {
    setup: (L) => {
      hostWrite(L, '/workspace/z.js');
      for (const n of L.readdirSync('/node_modules'))
        if (n.isDirectory) L.readdirSync(`/node_modules/${n.name}`);
    },
    op: (L) => {
      L.renameSync('/workspace/z.js', '/workspace/z2.js');
      L.budget();
    },
  },
  'walk 10 packages': {
    op: (L) => {
      for (const q of packages(L, 10)) walk(L, q);
      L.budget();
    },
  },
  'walk the whole template (ceiling)': {
    op: (L) => {
      walk(L, '/node_modules');
      L.budget();
    },
  },
  // `reps`: the op timed 201 times on ONE sandbox after its setup (`pre` untimed before each) —
  // review 6, S1: a first op right after a 32 ms walk times the walk's aftermath, not the op.
  'write /workspace, repeated': { reps: true, op: (L) => hostWrite(L, '/workspace/y.js') },
  'write /workspace after the whole walk, repeated': {
    reps: true,
    setup: (L) => walk(L, '/node_modules'),
    op: (L) => hostWrite(L, '/workspace/y.js'),
  },
  'write tpl depth 1 after the whole walk, repeated': {
    reps: true,
    setup: (L) => walk(L, '/node_modules'),
    op: (L, t) => hostWrite(L, `${t.pkg}/new.js`),
  },
  'mkdir -p /workspace (no-op), repeated': {
    reps: true,
    op: (L) => L.mkdirSync('/workspace', { recursive: true }),
  },
  'mkdir -p /workspace (no-op) after the whole walk, repeated': {
    reps: true,
    setup: (L) => walk(L, '/node_modules'),
    op: (L) => L.mkdirSync('/workspace', { recursive: true }),
  },
  'remove /workspace file, repeated': {
    reps: true,
    pre: (L) => hostWrite(L, '/workspace/z.js'),
    op: (L) => {
      L.rmSync('/workspace/z.js', { recursive: true });
      L.budget();
    },
  },
  'remove /workspace file after the whole walk, repeated': {
    reps: true,
    setup: (L) => walk(L, '/node_modules'),
    pre: (L) => hostWrite(L, '/workspace/z.js'),
    op: (L) => {
      L.rmSync('/workspace/z.js', { recursive: true });
      L.budget();
    },
  },
  'rename /workspace file, repeated': {
    reps: true,
    pre: (L) => hostWrite(L, '/workspace/z.js'),
    op: (L) => {
      L.renameSync('/workspace/z.js', '/workspace/z2.js');
      L.budget();
    },
  },
  'rename /workspace file after the whole walk, repeated': {
    reps: true,
    setup: (L) => walk(L, '/node_modules'),
    pre: (L) => hostWrite(L, '/workspace/z.js'),
    op: (L) => {
      L.renameSync('/workspace/z.js', '/workspace/z2.js');
      L.budget();
    },
  },
  'write /workspace after one tpl write': {
    setup: (L, t) => hostWrite(L, `${t.pkg}/new.js`),
    op: (L) => hostWrite(L, '/workspace/y.js'),
  },
};
const heap = () => {
  globalThis.gc();
  globalThis.gc();
  return process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers;
};
const IDLE = {
  'idle fresh': () => {},
  'idle after list /node_modules': (L) => L.readdirSync('/node_modules'),
  'idle after the whole walk (ceiling)': (L) => walk(L, '/node_modules'),
  'idle after the whole walk + a run boundary': (L, t) => {
    walk(L, '/node_modules');
    return rebuild(L, t);
  },
  'idle after one tpl write + a run boundary': (L, t) => {
    hostWrite(L, `${t.pkg}/new.js`);
    return rebuild(L, t);
  },
};
/**
 * Memory held by 20 idle sandboxes, per sandbox: the heap holding them minus the heap after they
 * are dropped, median of 3, each template point in its own process (review 6, S1: in one long
 * process the heap's history showed as up to ~1 MiB per sandbox that the sandboxes do not hold).
 */
function idleOnce(t, touch) {
  const held = [];
  for (let i = 0; i < 20; i++) {
    const L = fresh(t);
    const r = touch(L, t);
    held.push(r instanceof R.LayeredFs ? r : L);
  }
  const holding = heap();
  held.length = 0;
  return (holding - heap()) / 20 / 1024;
}
const idleKiB = (t, touch) => Math.round(median([0, 1, 2].map(() => idleOnce(t, touch))));
function cell(t, name) {
  const sc = SCENARIOS[name];
  const xs = [];
  if (sc.reps) {
    const L = fresh(t);
    sc.setup?.(L, t);
    for (let i = 0; i < 201; i++) {
      sc.pre?.(L, t);
      const s0 = performance.now();
      sc.op(L, t);
      xs.push(performance.now() - s0);
    }
    const w = L.toWire();
    return {
      ms: Math.round(median(xs) * 10_000) / 10_000,
      rows: w.refs.length,
      wireBytes: R.snapshotFs(w.entries, OPTS).length + JSON.stringify(w.refs).length,
      budget: L.budget(),
    };
  }
  for (let i = 0; i < 21; i++) {
    const L = fresh(t);
    sc.setup?.(L, t);
    const s0 = performance.now();
    sc.op(L, t);
    xs.push(performance.now() - s0);
  }
  const L = fresh(t);
  sc.setup?.(L, t);
  sc.op(L, t);
  const w = L.toWire();
  return {
    ms: Math.round(median(xs) * 1000) / 1000,
    rows: w.refs.length,
    wireBytes: R.snapshotFs(w.entries, OPTS).length + JSON.stringify(w.refs).length,
    budget: L.budget(),
  };
}

function realTemplate(dir) {
  const files = [];
  const dirs = new Set(['/node_modules']);
  (function walkDisk(abs, rel) {
    for (const name of readdirSync(abs).sort()) {
      const q = join(abs, name);
      const st = lstatSync(q);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        dirs.add(`${rel}/${name}`);
        walkDisk(q, `${rel}/${name}`);
      } else if (st.isFile() && !q.endsWith('/.package-lock.json'))
        files.push([`${rel}/${name}`, readFileSync(q)]);
    }
  })(dir, '/node_modules');
  const pack = new Uint8Array(files.reduce((n, [, d]) => n + d.length, 0));
  const rows = [...dirs].sort().map((d) => [1, d, 0, 0, T0, T0, T0, T0]);
  let off = 0;
  for (const [q, d] of files) {
    pack.set(d, off);
    rows.push([2, q, off, d.length, T0, T0, T0, T0]);
    off += d.length;
  }
  return {
    layer: R.templateLayer(pack, rows),
    entries: dirs.size + files.length,
    bytes: pack.length,
    firstFile: '/node_modules/pdf-lib/package.json',
    pkg: '/node_modules/pdf-lib',
  };
}
const IDLE_ARG = process.argv.find((a) => a.startsWith('--idle='))?.slice(7);
if (IDLE_ARG !== undefined) {
  const spec = JSON.parse(IDLE_ARG);
  const t = spec.real ? realTemplate(spec.real) : template(spec);
  const out = {};
  for (const [name, touch] of Object.entries(IDLE)) out[name] = idleKiB(t, touch);
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
const idleIn = (spec) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      ['--expose-gc', fileURLToPath(import.meta.url), `--idle=${JSON.stringify(spec)}`],
      { encoding: 'utf8', maxBuffer: 1 << 24 },
    ),
  );

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
    const base = { axis, ...v, entries: t.entries, templateMB: +(t.bytes / 1e6).toFixed(1) };
    for (const name of Object.keys(SCENARIOS)) {
      const row = { ...base, scenario: name, ...cell(t, name) };
      all.push(row);
      console.log(JSON.stringify(row));
    }
    const idle = idleIn(shape);
    for (const name of Object.keys(IDLE)) {
      const row = { ...base, scenario: name, idleKiB: idle[name] };
      all.push(row);
      console.log(JSON.stringify(row));
    }
  }
}
console.log(
  '\n## ratio last / first value along each axis (≈ 1: does not grow; small times are noisy)',
);
for (const [axis] of AXES) {
  for (const name of [...Object.keys(SCENARIOS), ...Object.keys(IDLE)]) {
    const rs = all.filter((r) => r.axis === axis && r.scenario === name);
    const a = rs[0];
    const b = rs[rs.length - 1];
    const ratio = {};
    for (const k of ['ms', 'rows', 'wireBytes', 'budget', 'idleKiB'])
      if (a[k] !== undefined)
        ratio[k] = a[k] === 0 ? (b[k] === 0 ? 1 : 'inf') : Math.round((b[k] / a[k]) * 100) / 100;
    console.log(JSON.stringify({ axis, scenario: name, ...ratio }));
  }
}
const REAL = process.argv[2];
if (REAL) {
  const t = realTemplate(REAL);
  const width = readdirSync(REAL).filter((n) => !n.startsWith('.')).length;
  console.log(
    `\n## the four-library template: ${t.entries} entries, ${(t.bytes / 1e6).toFixed(1)} MB, /node_modules width ${width}`,
  );
  const base = { axis: 'real', entries: t.entries, templateMB: +(t.bytes / 1e6).toFixed(1), width };
  for (const name of Object.keys(SCENARIOS))
    console.log(JSON.stringify({ ...base, scenario: name, ...cell(t, name) }));
  const idle = idleIn({ real: REAL });
  for (const name of Object.keys(IDLE))
    console.log(JSON.stringify({ ...base, scenario: name, idleKiB: idle[name] }));
}
process.exit(0);
