// Seam/ESM probe: every case = files + an entry, run by `sandbox.exec` (or `runCode` for -e) on
// the base dist and each variant (build-variants.mjs), and by real `node` over the same files in
// a temp dir (its path printed as /workspace). Prints a table; --json writes the raw results.
//   node docs/backlog/epics/isolate-guest-web-api/reference/seam-esm/run.mjs [--json out.json] [--nanoid <dir with package/>] [--only <case,...>]
//   node docs/backlog/epics/isolate-guest-web-api/reference/seam-esm/run.mjs --timing [--n 40]
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CASES } from './cases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../../..');
const hostPkg = join(root, 'packages/isolate-host');
const VARIANTS = {
  base: join(hostPkg, 'dist'),
  'url-first': join(hostPkg, 'node_modules/.web-api-probe/url-first/dist'),
  'url-esm': join(hostPkg, 'node_modules/.web-api-probe/url-esm/dist'),
  'ceilings-first': join(hostPkg, 'node_modules/.web-api-probe/ceilings-first/dist'),
  'ceilings-first-ports-late': join(
    hostPkg,
    'node_modules/.web-api-probe/ceilings-first-ports-late/dist',
  ),
  'ceilings-first-ports-subtle-late': join(
    hostPkg,
    'node_modules/.web-api-probe/ceilings-first-ports-subtle-late/dist',
  ),
};
const argv = process.argv.slice(2);
const opt = (n) => {
  const i = argv.indexOf(n);
  return i < 0 ? undefined : argv[i + 1];
};
const load = async (name) => import(pathToFileURL(join(VARIANTS[name], 'index.js')).href);

if (argv.includes('--timing')) {
  const n = Number(opt('--n') ?? 40);
  const rows = [];
  for (const name of ['base', 'url-first', 'url-esm', 'base', 'url-first', 'url-esm']) {
    const { runCode } = await load(name);
    for (let i = 0; i < 5; i++) await runCode('1'); // warm the pool + code cache
    const ms = [];
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      const r = await runCode('1');
      ms.push(performance.now() - t);
      if (r.exitCode !== 0) throw new Error(`${name}: ${JSON.stringify(r)}`);
    }
    ms.sort((a, b) => a - b);
    rows.push({
      variant: name,
      n,
      median: +ms[n >> 1].toFixed(2),
      p10: +ms[Math.floor(n * 0.1)].toFixed(2),
      p90: +ms[Math.floor(n * 0.9)].toFixed(2),
      loadavg: loadavg().map((x) => +x.toFixed(1)),
    });
    console.log(JSON.stringify(rows.at(-1)));
  }
  process.exit(0);
}

// nanoid: package/ dir of an `npm pack nanoid@5` tarball, laid into node_modules/nanoid.
const nanoidDir = opt('--nanoid');
const nanoidFiles = {};
if (nanoidDir) {
  const walk = (d, rel) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p, `${rel}${e}/`);
      else nanoidFiles[`node_modules/nanoid/${rel}${e}`] = readFileSync(p, 'utf8');
    }
  };
  walk(nanoidDir, '');
}
const only = opt('--only')?.split(',');
const cases = CASES.filter(
  (c) => (!only || only.includes(c.name)) && (!c.needsNanoid || nanoidDir),
);

const norm = (s, dir) =>
  s
    .split(pathToFileURL(dir).href)
    .join('file:///workspace')
    .split(dir)
    .join('/workspace')
    .replace(/\(node:\d+\)/g, '(node:PID)')
    .trimEnd();

function runNode(c) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seam-esm-')));
  const files = { ...c.files, ...(c.needsNanoid ? nanoidFiles : {}) };
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  const args = c.eval !== undefined ? ['-e', c.eval] : [c.entry];
  const r = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', env: {} });
  return { stdout: norm(r.stdout, dir), stderr: norm(r.stderr, dir), exitCode: r.status };
}

async function runGuest(name, c) {
  const mod = await load(name);
  if (c.eval !== undefined) {
    const r = await mod.runCode(c.eval);
    return { stdout: r.stdout.trimEnd(), stderr: r.stderr.trimEnd(), exitCode: r.exitCode };
  }
  const sb = await mod.createSandbox();
  try {
    const files = { ...c.files, ...(c.needsNanoid ? nanoidFiles : {}) };
    for (const [p, body] of Object.entries(files)) await sb.writeFile(p, body);
    const r = await sb.exec(c.entry);
    return { stdout: r.stdout.trimEnd(), stderr: r.stderr.trimEnd(), exitCode: r.exitCode };
  } finally {
    await sb.destroy();
  }
}

const first = (s) =>
  s
    .split('\n')
    .find(
      (l) => l.trim() && !l.startsWith('    at ') && !/^\/workspace\/|^file:|^\s*\^|^$/.test(l),
    ) ?? '';
const results = [];
for (const c of cases) {
  const row = { name: c.name, group: c.group, node: runNode(c) };
  for (const v of c.variants ?? Object.keys(VARIANTS)) {
    try {
      row[v] = await runGuest(v, c);
    } catch (e) {
      row[v] = {
        stdout: '',
        stderr: `HOST REJECT: ${String(e?.message ?? e).split('\n')[0]}`,
        exitCode: 'reject',
      };
    }
  }
  results.push(row);
  const show = (r) =>
    `${r.exitCode} | ${r.stdout.replace(/\n/g, ' ⏎ ').slice(0, 160)}${r.stderr ? ` | E: ${first(r.stderr).slice(0, 160)}` : ''}`;
  console.log(`\n## ${c.name}`);
  for (const k of ['node', ...Object.keys(VARIANTS)]) {
    if (!row[k]) continue;
    const same =
      k !== 'node' && row[k].stdout === row.node.stdout && row[k].exitCode === row.node.exitCode;
    console.log(`  ${k.padEnd(15)}${same ? '= ' : '  '}${show(row[k])}`);
  }
}
const json = opt('--json');
if (json)
  writeFileSync(
    json,
    `${JSON.stringify({ date: new Date().toISOString(), node: process.version, results }, null, 2)}\n`,
  );
process.exit(0);
