// Completeness probe (goal isolate-guest-web-api, manager question 3): sweep.cjs in live Node and
// in the isolate guest (sandbox `exec` of a file, and `runCode` = `node -e`), then a classified diff.
// From the repo root, after `pnpm install && pnpm --filter @riftydev/isolate-host build`:
//   node docs/backlog/epics/isolate-guest-web-api/reference/enumerate/enumerate.mjs
// Writes results-*.json and diff.json next to this file; prints the summary.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hostDist = join(here, '../../../../../../packages/isolate-host/dist');
const { createSandbox, runCode } = await import(pathToFileURL(join(hostDist, 'index.js')).href);
const sweep = readFileSync(join(here, 'sweep.cjs'), 'utf8');

// Node's own lists are the oracle's: the guest's would hide what it lacks.
const globalsRun = spawnSync(
  process.execPath,
  ['-e', 'console.log(JSON.stringify(Object.getOwnPropertyNames(globalThis).sort()))'],
  { encoding: 'utf8' },
);
const input = { modules: [...builtinModules].sort(), globals: JSON.parse(globalsRun.stdout) };
const LIMITS = { timeoutMs: 120_000, memoryLimitMb: 512, maxOutputBytes: 64 << 20 };
const timed = async (f) => {
  const t = performance.now();
  const r = await f();
  return [r, Math.round(performance.now() - t)];
};
const parse = (label, r) => {
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(
      `${label}: no JSON; exit ${r.exitCode ?? r.status}; stderr ${String(r.stderr).slice(0, 2000)}`,
    );
  }
};

const dir = mkdtempSync(join(tmpdir(), 'enumerate-'));
writeFileSync(join(dir, 'sweep.cjs'), sweep);
writeFileSync(join(dir, 'names.json'), JSON.stringify(input));
const [nodeFile, nodeFileMs] = await timed(() =>
  spawnSync(process.execPath, ['sweep.cjs'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 }),
);
const evalCode = `var __SWEEP_INPUT__ = ${JSON.stringify(input)};\n${sweep}`;
const [nodeEval, nodeEvalMs] = await timed(() =>
  spawnSync(process.execPath, ['-e', evalCode], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  }),
);
rmSync(dir, { recursive: true, force: true });

const sb = await createSandbox();
let guestFile;
let guestFileMs;
try {
  await sb.writeFile('sweep.cjs', sweep);
  await sb.writeFile('names.json', JSON.stringify(input));
  [guestFile, guestFileMs] = await timed(() => sb.exec('sweep.cjs', LIMITS));
} finally {
  await sb.destroy();
}
const [guestEval, guestEvalMs] = await timed(() => runCode(evalCode, LIMITS));

const runs = {
  'node-file': parse('node file', nodeFile),
  'node-eval': parse('node -e', nodeEval),
  'guest-file': parse('guest exec', guestFile),
  'guest-eval': parse('guest runCode', guestEval),
};
for (const [k, v] of Object.entries(runs))
  writeFileSync(join(here, `results-${k}.json`), `${JSON.stringify(v, null, 1)}\n`);

// Classes (one row = one module key, require or global where the guest's line differs from Node's):
// a1 an exported key holds `undefined` where Node holds a value — a host global read at load;
// a2 the read throws a NotImplementedError where Node's value is the same-named global (a named
//    gap, but not the global's: identity lost); a3 Node's value is the global, the guest's has
//    the same kind but another identity; b a declared loud gap (unregistered module, a loud read);
// c1 a key Node has and the guest lacks; c2 another typeof/prototype kind; c3 a key only the guest has.
function classify(_path, node, guest) {
  const nodeIsGlobal = node.endsWith(' =global');
  if (node === 'missing') return 'c3-extra';
  if (guest === 'undefined' || guest.startsWith('undefined '))
    return node === 'undefined' ? 'c2-kind' : 'a1-undefined-at-load';
  if (/NotImplementedError/.test(guest) && nodeIsGlobal) return 'a2-loud-not-the-global';
  if (/NotImplementedError|MODULE_NOT_FOUND|Cannot find module|is not implemented/.test(guest))
    return 'b-declared-loud';
  if (guest === 'missing') return 'c1-missing';
  if (nodeIsGlobal && guest.endsWith(' !=global') && guest.split(' ')[0] === node.split(' ')[0])
    return 'a3-identity';
  return 'c2-kind';
}
function diff(nodeRun, guestRun) {
  const rows = [];
  for (const [id, n] of Object.entries(nodeRun.modules)) {
    const gm = guestRun.modules[id];
    if (n.require !== gm.require)
      rows.push({ path: `require(${id})`, node: n.require, guest: gm.require });
    if (!gm.keys) continue;
    for (const [k, nv] of Object.entries(n.keys ?? {})) {
      const gv = gm.keys[k] ?? 'missing';
      if (nv !== gv) rows.push({ path: `${id} ${k}`, node: nv, guest: gv });
    }
    for (const k of Object.keys(gm.keys))
      if (!(k in (n.keys ?? {})))
        rows.push({ path: `${id} ${k}`, node: 'missing', guest: gm.keys[k] });
  }
  for (const [k, nv] of Object.entries(nodeRun.globals)) {
    const gv = guestRun.globals[k];
    if (nv !== gv) rows.push({ path: `globalThis ${k}`, node: nv, guest: gv });
  }
  for (const r of rows) r.class = classify(r.path, r.node, r.guest);
  return rows;
}
const result = {
  date: new Date().toISOString().slice(0, 10),
  node: process.version,
  modules: input.modules.length,
  globals: input.globals.length,
  exportsSwept: Object.values(runs['node-file'].modules).reduce(
    (s, m) => s + Object.keys(m.keys ?? {}).length,
    0,
  ),
  ms: {
    nodeFile: nodeFileMs,
    nodeEval: nodeEvalMs,
    guestFile: guestFileMs,
    guestEval: guestEvalMs,
  },
  file: diff(runs['node-file'], runs['guest-file']),
  eval: diff(runs['node-eval'], runs['guest-eval']),
};
writeFileSync(join(here, 'diff.json'), `${JSON.stringify(result, null, 1)}\n`);
const count = (rows) => {
  const m = {};
  for (const r of rows) m[r.class] = (m[r.class] ?? 0) + 1;
  return m;
};
console.log(
  JSON.stringify({ ...result, file: count(result.file), eval: count(result.eval) }, null, 1),
);
