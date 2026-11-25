// Node v24.16.0's own test/parallel/test-zlib*.js, run on this Node natively and with the native
// zlib handle swapped for each engine (swap-binding.cjs). usage: node node-suite.mjs DEPS BUILD [--json OUT]
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [deps, build] = process.argv.slice(2);
const jsonOut = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : null;
const dir = join(deps, 'node-src/node-v24.16.0/test/parallel');
const files = readdirSync(dir)
  .filter((f) => /^test-zlib.*\.js$/.test(f))
  .sort();
const swap = fileURLToPath(new URL('./swap-binding.cjs', import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), 'zlib-suite-'));
const ENGINES = [
  'native',
  'pako@1.0.11',
  'pako@2.2.0',
  'pako@3.0.3',
  'pako@3.0.3+params',
  'wasm-node-zlib',
];

let serial = 0;
function run(file, engine) {
  const src = readFileSync(join(dir, file), 'utf8');
  const flags = (src.match(/^\/\/ Flags: (.*)$/m)?.[1] ?? '').split(/\s+/).filter(Boolean);
  const args = [...flags, ...(engine === 'native' ? [] : ['-r', swap]), join(dir, file)];
  const env = {
    ...process.env,
    ZLIB_PROBE_ENGINE: engine,
    ZLIB_PROBE_DEPS: deps,
    ZLIB_PROBE_BUILD: build,
    NODE_NO_WARNINGS: '1',
    TEST_SERIAL_ID: String(++serial),
  }; // own tmpdir per run
  return new Promise((res) => {
    execFile(
      process.execPath,
      args,
      { cwd, env, timeout: 180_000, maxBuffer: 64 << 20 },
      (err, _o, stderr) => {
        const why = err
          ? (
              stderr.split('\n').find((l) => /Error|assert|not ok|Unsupported/.test(l)) ??
              `exit ${err.code ?? err.signal}`
            )
              .trim()
              .slice(0, 160)
          : null;
        res({ ok: !err, why });
      },
    );
  });
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}
const jobs = files.flatMap((f) => ENGINES.map((e) => [f, e]));
const res = await pool(jobs, 8, ([f, e]) => run(f, e));
const table = {};
jobs.forEach(([f, e], k) => {
  table[f] ??= {};
  table[f][e] = res[k];
});
const nativeOk = files.filter((f) => table[f].native.ok);
console.log(
  `node ${process.version}; ${files.length} test-zlib*.js, ${nativeOk.length} pass natively`,
);
for (const e of ENGINES.slice(1)) {
  const fails = nativeOk.filter((f) => !table[f][e].ok);
  console.log(
    `${e}: ${nativeOk.length - fails.length}/${nativeOk.length}${fails.length ? ` — fails: ${fails.map((f) => `${f} (${table[f][e].why})`).join('; ')}` : ''}`,
  );
}
const nativeFails = files.filter((f) => !table[f].native.ok);
if (nativeFails.length)
  console.log(
    `native fails (excluded): ${nativeFails.map((f) => `${f} (${table[f].native.why})`).join('; ')}`,
  );
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(table, null, 1));
