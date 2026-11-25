// One program per case, four runs: real Node, rifty's browser-host modules in this Node (memory VFS with
// and without its async surface), rifty's isolate host sandbox `exec`. Exit status is kept apart
// from stdout; a row is `same` only when the line and the exit status both match Node's.
// With NODE_SRC (an extracted node-v24.16.0 source tree) a fifth run, rifty-inproc-B: route B, Node's stream
// core and fs stream classes verbatim over rifty's modules (route-b/verbatim.cjs).
// usage: [ROUTE_B_GEN=…/node-streams.js] node --import tsx run.mjs REPO [NODE_SRC]   (writes results/<program>.txt, results/summary.txt)
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [repo, nodeSrc] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
// RESULTS: another output dir (default results/).
const results = process.env.RESULTS ?? join(here, 'results');
const { closureFiles, inSandbox } = await import(
  pathToFileURL(join(repo, 'packages/isolate-host/tests/package-closure.ts')).href
);
const head = spawnSync('git', ['-C', repo, 'rev-parse', '--short=9', 'HEAD'], {
  encoding: 'utf8',
}).stdout.trim();
const exceljs = closureFiles(
  'exceljs',
  realpathSync(join(repo, 'packages/isolate-host/node_modules/exceljs')),
);
const HOOKS = join(
  repo,
  'docs/backlog/runtime-js/reference/stream-destroy-construct-hooks/matrix.cjs',
);
const programs = [
  ...readdirSync(join(here, 'programs'))
    .filter((n) => n.endsWith('.cjs'))
    .sort()
    .map((n) => [n, join(here, 'programs', n)]),
  ['m1-hooks-matrix.cjs', HOOKS],
];
const only = process.env.ONLY;

function materialize(files) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'nsg-')));
  for (const [rel, data] of files) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), data);
  }
  return dir;
}
const clean = (s, dir) =>
  s
    .split(dir)
    .join('<dir>')
    .split('/workspace')
    .join('<dir>')
    .split(repo)
    .join('<repo>')
    .split(tmpdir())
    .join('<tmp>');
function spawnIn(files, cmd, args, env, name) {
  const dir = materialize(files);
  try {
    const r = spawnSync(cmd, args(dir, name), {
      cwd: dir,
      env,
      encoding: 'utf8',
      timeout: 180_000,
    });
    return {
      stdout: clean(r.stdout ?? '', dir),
      stderr: clean(r.stderr ?? '', dir),
      status: r.status ?? `signal ${r.signal}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const tsx = (dir, name) => [
  '--import',
  pathToFileURL(join(repo, 'node_modules/tsx/dist/loader.mjs')).href,
  join(here, 'inproc.mts'),
  repo,
  dir,
  name,
];
const runs = {
  node: (files, name) => spawnIn(files, process.execPath, (_d, n) => [n], {}, name),
  'rifty-inproc': (files, name) => spawnIn(files, process.execPath, tsx, {}, name),
  'rifty-inproc-sync': (files, name) =>
    spawnIn(files, process.execPath, tsx, { SYNC_ONLY: '1' }, name),
  'rifty-isolate': async (files, name) => {
    const r = await inSandbox(files, name, 'none');
    return {
      stdout: clean(r.stdout, '/workspace'),
      stderr: clean(r.stderr, '/workspace'),
      status: r.exitCode,
    };
  },
};
const routeBUsed = { rifty: new Set(), node: new Set() };
if (nodeSrc) {
  runs['rifty-inproc-B'] = (files, name) => {
    const r = spawnIn(
      files,
      process.execPath,
      (d, n) => ['--expose-internals', ...tsx(d, n)],
      { ROUTE_B: '1', ROUTE_B_USED: '1', NODE_SRC: nodeSrc },
      name,
    );
    const keep = [];
    for (const l of r.stderr.split('\n')) {
      if (l.startsWith('route-b used ')) {
        const u = JSON.parse(l.slice('route-b used '.length));
        for (const k of ['rifty', 'node']) for (const id of u[k]) routeBUsed[k].add(id);
      } else if (!/^\(node:\d+\) internal\/test\/binding|^\(Use `node --trace-warnings/.test(l))
        keep.push(l);
    }
    return { ...r, stderr: keep.join('\n') };
  };
}
// ROUTE_B_GEN (route-b/product/generate.mjs output): rifty-inproc-Bp, the same sources over product bindings.
if (process.env.ROUTE_B_GEN)
  runs['rifty-inproc-Bp'] = (files, name) =>
    spawnIn(
      files,
      process.execPath,
      tsx,
      { ROUTE_B: 'product', ROUTE_B_GEN: process.env.ROUTE_B_GEN },
      name,
    );
// With ROUTE_B_GEN also rifty-inproc-Bp9r: product bindings, Node's ReadStream, rifty's WriteStream (unit 9r alone).
if (process.env.ROUTE_B_GEN)
  runs['rifty-inproc-Bp9r'] = (files, name) =>
    spawnIn(
      files,
      process.execPath,
      tsx,
      { ROUTE_B: 'product', ROUTE_B_GEN: process.env.ROUTE_B_GEN, ROUTE_B_FS: 'read' },
      name,
    );
const COLS = Object.keys(runs);
// The thrown error's line (`Name: message`), else the first non-frame line.
const firstLine = (s) => {
  const ls = s.split('\n').filter((l) => l.trim() && !l.startsWith('    at '));
  return ls.find((l) => /^[A-Za-z]*(Error|Exception)\b/.test(l)) ?? ls[0] ?? '';
};
const rowsOf = (stdout) => {
  const m = new Map();
  stdout
    .split('\n')
    .filter(Boolean)
    .forEach((l, i) => {
      const at = l.indexOf(' => ');
      m.set(at > 0 ? l.slice(0, at) : `line ${i + 1}`, at > 0 ? l.slice(at + 4) : l);
    });
  return m;
};
mkdirSync(results, { recursive: true });
const summary = [
  `node ${process.version}; rifty ${head}; columns: ${COLS.join(' | ')}`,
  'program | Node rows | same as Node per rifty column (+ lines only that run printed)',
];
for (const [name, path] of programs) {
  if (only && !name.includes(only)) continue;
  const files = new Map(name.startsWith('c-') ? exceljs : []).set(name, readFileSync(path));
  const out = {};
  for (const col of COLS) out[col] = await runs[col](files, name);
  const rows = COLS.map((c) => rowsOf(out[c].stdout));
  const keys = [...new Set(rows.flatMap((m) => [...m.keys()]))];
  const lines = [
    `# ${name} — node ${process.version}, rifty ${head}`,
    `columns: ${COLS.join(' | ')}`,
    '',
  ];
  lines.push(`exit: ${COLS.map((c) => `${c} ${out[c].status}`).join(' | ')}`);
  for (const c of COLS)
    if (out[c].stderr.trim()) lines.push(`stderr ${c}: ${firstLine(out[c].stderr).slice(0, 200)}`);
  lines.push('');
  // Rows are Node's lines; a line only a rifty run printed (e.g. an uncaught error) counts as extra.
  const same = COLS.slice(1).map(() => 0);
  const extra = COLS.slice(1).map(() => 0);
  const nodeRows = rows[0].size;
  for (const k of keys) {
    const vals = rows.map((m) => (m.has(k) ? m.get(k) : '(no line)'));
    lines.push(`## ${k}`);
    vals.forEach((v, i) => {
      const ok =
        i > 0 && rows[0].has(k) && v === vals[0] && out[COLS[i]].status === out.node.status;
      if (ok) same[i - 1]++;
      if (i > 0 && !rows[0].has(k) && rows[i].has(k)) extra[i - 1]++;
      const tag = i === 0 || (!rows[0].has(k) && !rows[i].has(k)) ? '' : ok ? ' (same)' : ' (DIFF)';
      lines.push(`${COLS[i]}${tag}: ${v}`);
    });
  }
  writeFileSync(join(results, `${name.replace(/\.cjs$/, '')}.txt`), `${lines.join('\n')}\n`);
  summary.push(
    `${name} | ${nodeRows} | ${COLS.slice(1)
      .map((c, i) => `${c} ${same[i]}/${nodeRows}${extra[i] ? ` +${extra[i]} extra` : ''}`)
      .join(' | ')}`,
  );
  console.log(summary.at(-1));
}
if (!only) writeFileSync(join(results, 'summary.txt'), `${summary.join('\n')}\n`);
if (nodeSrc && !only)
  writeFileSync(
    join(results, 'route-b-bindings.txt'),
    `route B, ids the verbatim files required over all programs\nrifty: ${[...routeBUsed.rifty].sort().join(' ')}\nnode internals: ${[...routeBUsed.node].sort().join(' ')}\n`,
  );
process.exit(0);
