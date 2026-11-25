// Where do the isolate guest's JS-backed Web APIs come from? Builds each candidate as one IIFE,
// runs the same differential cases (cases.js) under live Node and in a bare isolated-vm isolate
// over the guest's base (guest-base.js), and with --timing measures the per-isolate cost of
// evaluating a candidate the way the worker evaluates the guest bundle (code cache, fresh isolate).
// From the repo root, after `pnpm install`:
//   node docs/backlog/epics/isolate-guest-web-api/reference/sources-js/probe.mjs [--timing] [--json out.json]
// Network: raw.githubusercontent.com (Node v24.16.0 lib/, sha256-checked) and the npm registry.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../../../..');
const requireRepo = createRequire(join(repo, 'package.json'));
const { build } = requireRepo('esbuild');
const ivm = createRequire(join(repo, 'packages/isolate-host/package.json'))('isolated-vm');
const argv = process.argv.slice(2);
const timing = argv.includes('--timing');
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : undefined;
if (process.version !== 'v24.16.0')
  throw new Error(`oracle must be Node v24.16.0, got ${process.version}`);

// 1. Node v24.16.0 lib/internal sources, pinned by sha256.
const pins = JSON.parse(readFileSync(join(here, 'node-src.sha256.json'), 'utf8'));
const lib = join(tmpdir(), 'rifty-node-v24.16.0-lib');
for (const [path, sha] of Object.entries(pins)) {
  const file = join(lib, path);
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    const res = await fetch(
      `https://raw.githubusercontent.com/nodejs/node/v24.16.0/lib/internal/${path}`,
    );
    if (!res.ok) throw new Error(`fetch ${path}: ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const got = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (got !== sha) throw new Error(`${path}: sha256 ${got} != pinned ${sha}`);
}

// 2. npm candidates.
const work = mkdtempSync(join(tmpdir(), 'web-api-sources-js-'));
cpSync(join(here, 'npm'), join(work, 'npm'), { recursive: true });
execFileSync('npm', ['ci', '--silent', '--no-audit', '--no-fund'], {
  cwd: join(work, 'npm'),
  stdio: 'inherit',
});

// 3. Bundles.
const iife = async (entryPoints, out, extra = {}) => {
  const r = await build({
    entryPoints,
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'neutral',
    target: 'es2022',
    minify: true,
    keepNames: true,
    logLevel: 'error',
    mainFields: ['main'],
    ...extra,
  });
  writeFileSync(join(work, out), r.outputFiles[0].text);
  return r.outputFiles[0].text;
};
const base = await iife([join(here, 'guest-base.js')], 'base.js');
const port = (name, ...only) => {
  execFileSync(
    process.execPath,
    [join(here, 'node-port/build.mjs'), lib, join(work, `${name}.js`), ...only],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  return readFileSync(join(work, `${name}.js`), 'utf8');
};
const npmBundle = (entry, out) =>
  iife([join(work, 'npm', entry)], out, { nodePaths: [join(work, 'npm/node_modules')] });
const casesSrc = readFileSync(join(here, 'cases.js'), 'utf8');
// `group`: the case group a variant covers (events = EventTarget/Event/Abort*).
const VARIANTS = {
  'node-port': { src: port('node-port'), global: '__nodePort' },
  'node-port-events': {
    src: port('node-port-events', 'events'),
    global: '__nodePort',
    group: 'events',
  },
  npm: { src: await npmBundle('entry.js', 'npm.js'), global: '__npm' },
  'npm-events': {
    src: await npmBundle('entry-events.js', 'npm-events.js'),
    global: '__npm',
    group: 'events',
  },
};
const size = (s) => ({ bytes: Buffer.byteLength(s), gzip: gzipSync(s).length });

// 4. Oracle: live Node, its own globals.
const nodeCtx = vm.createContext({});
// The cases run in a fresh Node context so they see only Node's own web globals.
for (const k of [
  'EventTarget',
  'Event',
  'CustomEvent',
  'AbortController',
  'AbortSignal',
  'DOMException',
  'ReadableStream',
  'ReadableStreamDefaultReader',
  'ReadableStreamBYOBReader',
  'ReadableStreamBYOBRequest',
  'ReadableByteStreamController',
  'ReadableStreamDefaultController',
  'WritableStream',
  'WritableStreamDefaultWriter',
  'WritableStreamDefaultController',
  'TransformStream',
  'TransformStreamDefaultController',
  'ByteLengthQueuingStrategy',
  'CountQueuingStrategy',
  'TextEncoderStream',
  'TextDecoderStream',
  'setTimeout',
])
  nodeCtx[k] = globalThis[k];
vm.runInContext(casesSrc, nodeCtx);
// Node's AbortSignal.timeout timer is unref'd: keep the loop alive while the cases run.
const keepAlive = setInterval(() => {}, 1000);
const oracle = JSON.parse(await vm.runInContext('__runCases(globalThis)', nodeCtx));

// 5. Each candidate in a bare isolate over the guest base.
async function inIsolate(src, global, group) {
  const isolate = new ivm.Isolate({ memoryLimit: 128 });
  const context = await isolate.createContext();
  const jail = context.global;
  await jail.set('globalThis', jail.derefInto());
  // biome-ignore lint/style/useConst: set after the base defines __fire, read by the timer callback.
  let fire;
  await jail.set(
    '__hostTimer',
    new ivm.Callback((id, ms) => {
      setTimeout(() => fire.apply(undefined, [id]).catch(() => {}), Math.max(0, ms));
    }),
  );
  await context.eval(base);
  fire = await jail.get('__fire', { reference: true });
  await context.eval(src);
  await context.eval(casesSrc);
  const out = await context.eval(`__runCases(${global}, ${JSON.stringify(group ?? null)})`, {
    promise: true,
    copy: true,
  });
  isolate.dispose();
  return JSON.parse(out);
}
const results = {};
for (const [name, { src, global, group }] of Object.entries(VARIANTS)) {
  const got = await inIsolate(src, global, group);
  const diffs = {};
  for (const id of Object.keys(got))
    if (got[id] !== oracle[id]) diffs[id] = { node: oracle[id], candidate: got[id] };
  const byGroup = {};
  for (const { group: g, id } of vm.runInContext(
    '__cases.cases.map(({group,id})=>({group,id}))',
    nodeCtx,
  )) {
    if (!(id in got)) continue;
    const group = g;
    byGroup[group] ??= { cases: 0, differ: 0 };
    byGroup[group].cases++;
    if (diffs[id]) byGroup[group].differ++;
  }
  results[name] = { size: size(src), byGroup, diffs };
}

// 6. --timing: per fresh isolate, compile with the worker's code cache + run (child/main.ts).
async function evalCost(src, n = 40) {
  let cachedData;
  const samples = [];
  for (let i = 0; i < n + 3; i++) {
    const isolate = new ivm.Isolate({ memoryLimit: 128 });
    const context = await isolate.createContext();
    await context.eval(base);
    const t0 = process.hrtime.bigint();
    const script = await isolate.compileScript(
      src,
      cachedData ? { cachedData } : { produceCachedData: true },
    );
    cachedData ??= script.cachedData;
    await script.run(context);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    isolate.dispose();
    if (i >= 3) samples.push(ms);
  }
  samples.sort((a, b) => a - b);
  return {
    medianMs: +samples[samples.length >> 1].toFixed(3),
    p90Ms: +samples[Math.floor(samples.length * 0.9)].toFixed(3),
    n,
  };
}
let timings;
if (timing) {
  timings = { load: loadavg().map((x) => +x.toFixed(1)), empty: await evalCost('void 0') };
  for (const [name, { src }] of Object.entries(VARIANTS)) timings[name] = await evalCost(src);
  // Breakdown of the Node port's fixed cost: Node's primordials alone, primordials + errors.js.
  for (const part of ['primordials', 'errors']) {
    const src = port(`node-port-${part}`, part);
    timings[`node-port:${part}-only`] = { ...(await evalCost(src)), ...size(src) };
  }
  timings.load.push(...loadavg().map((x) => +x.toFixed(1)));
}

const summary = {
  date: new Date().toISOString(),
  node: process.version,
  isolatedVm: createRequire(join(repo, 'packages/isolate-host/package.json'))(
    'isolated-vm/package.json',
  ).version,
  esbuild: requireRepo('esbuild/package.json').version,
  npm: JSON.parse(readFileSync(join(here, 'npm/package.json'), 'utf8')).dependencies,
  cases: Object.keys(oracle).length,
  results,
  timings,
};
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(summary).map(([k, v]) => [
        k,
        k === 'results'
          ? Object.fromEntries(
              Object.entries(v).map(([n, r]) => [
                n,
                { size: r.size, byGroup: r.byGroup, differ: Object.keys(r.diffs) },
              ]),
            )
          : v,
      ]),
    ),
    null,
    1,
  ),
);
clearInterval(keepAlive);
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(summary, null, 1)}\n`);
