// Existing parity cases (tools/node-parity-runner/cases/<dir>) on route A (rifty's streams today) and
// route B (Node's stream core verbatim), each against real Node (the runner's runInNode). Only plain
// CJS cases without stdin/workers/cli-eval run; the rest are counted as skipped.
// usage: node --import tsx parity.mjs REPO NODE_SRC DIR[,DIR…] [NAME_FILTER]   (stdout: one line per case)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [repo, nodeSrc, dirs, filter] = process.argv.slice(2);
// ROUTE_B_GEN (product/generate.mjs output): a third column, Bp = the same sources over product/bindings.ts.
const gen = process.env.ROUTE_B_GEN;
const here = dirname(fileURLToPath(import.meta.url));
const { runInNode } = await import(
  pathToFileURL(join(repo, 'tools/node-parity-runner/src/run-in-node.ts')).href
);
const tsx = pathToFileURL(join(repo, 'node_modules/tsx/dist/loader.mjs')).href;
const tmp = mkdtempSync(join(tmpdir(), 'nsg-parity-'));
const NOISE = /^\(node:\d+\) internal\/test\/binding|^\(Use `node --trace-warnings/;
const run = (c, routeB) => {
  const f = join(tmp, 'case.json');
  writeFileSync(
    f,
    JSON.stringify({ code: c.code, files: c.setup?.files, cwd: c.cwd, kind: c.kind }),
  );
  const r = spawnSync(
    process.execPath,
    [
      ...(routeB === true ? ['--expose-internals'] : []),
      '--import',
      tsx,
      join(here, 'parity-child.mts'),
      repo,
      f,
    ],
    {
      encoding: 'utf8',
      timeout: 60_000,
      env:
        routeB === 'product'
          ? { ROUTE_B: 'product', ROUTE_B_GEN: gen }
          : routeB
            ? { ROUTE_B: '1', NODE_SRC: nodeSrc }
            : {},
    },
  );
  return {
    out: r.stdout ?? '',
    // The thrown error's line (\`Name: message\`), else the first non-frame line; paths masked.
    err: (() => {
      const ls = (r.stderr ?? '')
        .split(repo)
        .join('<repo>')
        .split('\n')
        .filter((l) => l && !NOISE.test(l) && !l.startsWith('    at '));
      return ls.find((l) => /^[A-Za-z]*(Error|Exception)\b/.test(l)) ?? ls[0] ?? '';
    })(),
  };
};
const counts = { cases: 0, skipped: 0, A: 0, B: 0, Bp: 0 };
// A DIR that is an absolute path is read as is (this probe's own cases, `.case.mjs`).
const caseDir = (dir) =>
  dir.startsWith('/') ? dir : join(repo, 'tools/node-parity-runner/cases', dir);
for (const dir of dirs.split(',')) {
  for (const name of readdirSync(caseDir(dir))
    .filter((n) => n.endsWith('.case.ts') || n.endsWith('.case.mjs'))
    .sort()) {
    if (filter && !new RegExp(filter).test(name)) continue;
    const c = (await import(pathToFileURL(join(caseDir(dir), name)).href)).default;
    const plain =
      ['cjs', 'http'].includes(c.kind ?? 'cjs') &&
      !c.stdin &&
      !c.nodeCliEval &&
      !c.expectedPhysicalWorkers;
    if (!plain) {
      counts.skipped++;
      console.log(`${dir}/${name} | skipped (kind ${c.kind ?? 'cjs'}${c.stdin ? ', stdin' : ''})`);
      continue;
    }
    counts.cases++;
    let node;
    try {
      node = await runInNode(c);
    } catch (e) {
      node = `node threw ${e.message}`;
    }
    const a = run(c, false);
    const b = run(c, true);
    const bp = gen ? run(c, 'product') : undefined;
    if (a.out === node) counts.A++;
    if (b.out === node) counts.B++;
    if (bp?.out === node) counts.Bp++;
    const col = (r) => (r.out === node ? 'same' : `DIFF ${r.err.slice(0, 100)}`);
    console.log(`${dir}/${name} | A ${col(a)} | B ${col(b)}${bp ? ` | Bp ${col(bp)}` : ''}`);
    // VERBOSE=1: every column's stdout (and the first stderr line), for cases whose point is the output.
    if (process.env.VERBOSE === '1')
      for (const [k, v] of [
        ['node', { out: node, err: '' }],
        ['A', a],
        ['B', b],
        ['Bp', bp],
      ])
        if (v)
          console.log(
            `  ${k}: ${v.out.trim().split('\n').join(' ¦ ')}${v.err ? ` [stderr: ${v.err.slice(0, 80)}]` : ''}`,
          );
  }
}
console.log(
  `total plain cases ${counts.cases}, skipped ${counts.skipped}; equal to Node: route A ${counts.A}, route B ${counts.B}${gen ? `, route B product bindings ${counts.Bp}` : ''}`,
);
rmSync(tmp, { recursive: true, force: true });
process.exit(0);
