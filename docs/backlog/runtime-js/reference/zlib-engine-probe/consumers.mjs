// Real consumers in real Node: native zlib vs each engine under Node's own lib/zlib.js
// (swap-binding.cjs). Same digest = same bytes out. usage: node consumers.mjs DEPS BUILD REPO
import { spawnSync } from 'node:child_process';
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
// A run counts only when the child exits 0 with no signal and prints one JSON line without `error`.
const run = (s, e) => {
  const args = [
    ...(e === 'native' ? [] : ['-r', here('./swap-binding.cjs')]),
    here('./consumer-scenarios.cjs'),
    s,
    repo,
    join(deps, 'consumers'),
  ];
  const r = spawnSync(process.execPath, args, {
    env: {
      ...process.env,
      ZLIB_PROBE_ENGINE: e,
      ZLIB_PROBE_DEPS: deps,
      ZLIB_PROBE_BUILD: build,
      NODE_NO_WARNINGS: '1',
    },
    encoding: 'utf8',
  });
  const out = (r.stdout || '').trim();
  let parsed = null;
  try {
    parsed = JSON.parse(out);
  } catch {}
  const ok =
    r.status === 0 &&
    r.signal === null &&
    parsed !== null &&
    !parsed.error &&
    Object.keys(parsed).length > 0;
  return {
    ok,
    out,
    status: `exit ${r.status}${r.signal ? ` signal ${r.signal}` : ''}`,
    err: (r.stderr || '').split('\n').find((l) => /Error/.test(l)),
  };
};
console.log(`node ${process.version}`);
for (const s of SCENARIOS) {
  const native = run(s, 'native');
  console.log(`${s} | native ${native.status} ${native.out.slice(0, 200)}`);
  if (!native.ok) {
    console.log(
      `${s} | NATIVE FAILED (${native.status} ${native.err ?? ''}) — scenario not measured`,
    );
    continue;
  }
  for (const e of ENGINES.slice(1)) {
    const got = run(s, e);
    const same = got.ok && got.out === native.out;
    console.log(
      `${s} | ${e} | ${same ? 'same as native' : `DIFF ${got.status} ${(got.out || got.err || '').slice(0, 300)}`}`,
    );
  }
}
