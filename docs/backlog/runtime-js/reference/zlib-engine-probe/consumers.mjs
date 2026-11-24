// Real consumers in real Node: native zlib vs each engine under Node's own lib/zlib.js
// (swap-binding.cjs). Same digest = same bytes out. usage: node consumers.mjs DEPS BUILD REPO
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [deps, build, repo] = process.argv.slice(2);
const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const SCENARIOS = [
  'exceljs-stream-writer',
  'unzipper',
  'ws-permessage-deflate',
  'pngjs-sync',
  'pdfkit',
];
const ENGINES = ['native', 'pako@3.0.3', 'pako@3.0.3+params', 'wasm-node-zlib'];
const run = (s, e) => {
  const args = [
    ...(e === 'native' ? [] : ['-r', here('./swap-binding.cjs')]),
    here('./consumer-scenarios.cjs'),
    s,
    repo,
    join(deps, 'consumers'),
  ];
  try {
    return execFileSync(process.execPath, args, {
      env: {
        ...process.env,
        ZLIB_PROBE_ENGINE: e,
        ZLIB_PROBE_DEPS: deps,
        ZLIB_PROBE_BUILD: build,
        NODE_NO_WARNINGS: '1',
      },
      encoding: 'utf8',
    }).trim();
  } catch (err) {
    return (
      (err.stdout || '').trim() ||
      JSON.stringify({
        error: String(err.stderr)
          .split('\n')
          .find((l) => /Error/.test(l)),
      })
    );
  }
};
console.log(`node ${process.version}`);
for (const s of SCENARIOS) {
  const native = run(s, 'native');
  console.log(`${s} | native ${native.slice(0, 200)}`);
  if (JSON.parse(native).error) {
    console.log(`${s} | NATIVE FAILED — scenario not measured`);
    continue;
  }
  for (const e of ENGINES.slice(1)) {
    const got = run(s, e);
    console.log(`${s} | ${e} | ${got === native ? 'same as native' : `DIFF ${got.slice(0, 300)}`}`);
  }
}
