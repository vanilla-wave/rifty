// The zlib goal's zlib-diff.mjs (main: docs/backlog/runtime-js/reference/zlib-engine-probe/), its port/R
// column re-pointed from rifty's @riftydev/io Transform to route B: Node's stream core verbatim
// (verbatim.cjs) over rifty's events/buffer/string_decoder. Output keeps its table; "port/R" = route B.
// usage: node zlib-diff-b.mjs PROBE_DIR DEPS BUILD REPO NODE_SRC   (PROBE_DIR: a copy of that probe dir)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [probe, deps, build, repo, nodeSrc] = process.argv.slice(2);
const src = readFileSync(join(probe, 'zlib-diff.mjs'), 'utf8');
const from =
  "'port/R': { z: loadLibZlib({ Transform: rifty.Transform, finished: rifty.finished }), S: rifty },";
if (!src.includes(from)) throw new Error('zlib-diff.mjs changed: port/R line not found');
const routeB = `const routeB = await (async () => {
  const load = (p) => import(pathToFileURL(join(repo, p)).href);
  const { installMemoryFs } = await load('packages/vfs/src/internal/index.ts');
  const { syncMirror } = await load('packages/vfs/src/index.ts');
  const { createModuleLoader } = await load('packages/runtime-js/src/module-loader/index.ts');
  installMemoryFs();
  const loader = createModuleLoader(syncMirror(), { cwd: '/' });
  const { loadVerbatim } = require(${JSON.stringify(join(import.meta.dirname, 'verbatim.cjs'))});
  return loadVerbatim({ lib: ${JSON.stringify(join(nodeSrc, 'lib'))}, riftyRequire: (id) => loader.require(id, '/[main].cjs'), nodeRequire: require, process }).stream;
})();
`;
const out = src
  .replace('const COLS = {', `${routeB}const COLS = {`)
  .replace(
    from,
    "'port/R': { z: loadLibZlib({ Transform: routeB.Transform, finished: routeB.finished }), S: routeB },",
  )
  .replace(
    'rifty Transform from packages/io/src (main)',
    'port/R = route B: Node stream core verbatim over rifty bindings',
  );
const gen = join(probe, 'zlib-diff-b.gen.mjs');
writeFileSync(gen, out);
const r = spawnSync(
  process.execPath,
  ['--expose-internals', '--no-warnings', '--import', 'tsx', gen, deps, build, repo],
  { cwd: repo, encoding: 'utf8', timeout: 600_000 },
);
process.stdout.write(r.stdout);
process.stderr.write(r.stderr.split('\n').slice(0, 5).join('\n'));
process.exit(r.status ?? 1);
