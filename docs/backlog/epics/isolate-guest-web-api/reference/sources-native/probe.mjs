// Probe: where do URL/URLSearchParams, Blob/File and structuredClone come from in the isolate guest?
// Candidates (npm packages, a host bridge) are bundled like the guest (esbuild IIFE, browser) and
// evaluated in a bare isolated-vm isolate after the guest's own TextEncoder/TextDecoder/DOMException
// (src/prelude.js); cases.js runs there and in live Node, results compared as text.
//
// From the repo root (network: registry.npmjs.org and raw.githubusercontent.com):
//   node docs/backlog/epics/isolate-guest-web-api/reference/sources-native/probe.mjs [--json out.json]
//   node docs/backlog/epics/isolate-guest-web-api/reference/sources-native/probe.mjs --timing [--json t.json]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../../..');
const require = createRequire(join(root, 'packages/isolate-host/package.json'));
const ivm = require('isolated-vm');
const { build } = createRequire(join(root, 'packages/isolate-guest/package.json'))('esbuild');

const argv = process.argv.slice(2);
const timing = argv.includes('--timing');
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : undefined;
const NODE_TAG = 'v24.16.0';
const FIXTURES = {
  urltestdata: ['urltestdata.json', 'cdccbdd24648f8b6935f2271f4f5ea285bf036ad1a8a7727e77a76d0287aa019'],
  setters: ['setters_tests.json', '3eb50af867645b1c1fc9818d82a53ac40ca8d448d0625f08b8f68c3b8b729c21'],
};

// 1. Candidates into a temp dir; WPT fixtures of the oracle's Node tag.
const work = mkdtempSync(join(tmpdir(), 'isolate-web-api-native-'));
cpSync(join(here, 'deps'), join(work, 'deps'), { recursive: true });
execFileSync('npm', ['ci', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'], { cwd: join(work, 'deps'), stdio: 'ignore' });
const nm = join(work, 'deps/node_modules');
const DATA = {};
for (const [key, [file, sha]] of Object.entries(FIXTURES)) {
  const url = `https://raw.githubusercontent.com/nodejs/node/${NODE_TAG}/test/fixtures/wpt/url/resources/${file}`;
  const text = await (await fetch(url)).text();
  const got = createHash('sha256').update(text).digest('hex');
  if (got !== sha) throw new Error(`${file}: sha256 ${got}, expected ${sha}`);
  DATA[key] = JSON.parse(text);
}

// 2. Variants: an entry installing globals, bundled as the guest bundles (esbuild IIFE, browser).
const src = (f) => JSON.stringify(join(here, 'src', f));
const pkg = (p) => JSON.stringify(join(nm, p));
const VARIANTS = {
  'url:whatwg-url': { suites: ['url', 'urlSetters', 'urlShape', 'usp'], entry: `import { URL, URLSearchParams } from ${pkg('whatwg-url/index.js')}; Object.assign(globalThis, { URL, URLSearchParams });` },
  'url:whatwg-url@15': { suites: ['url', 'urlSetters', 'urlShape', 'usp'], entry: `import { URL, URLSearchParams } from ${pkg('whatwg-url-15/index.js')}; Object.assign(globalThis, { URL, URLSearchParams });` },
  // Same package, evaluated on first read of the global (a self-replacing accessor, as Node's lazy globals).
  'url:whatwg-url@15 lazy': { suites: ['url', 'urlShape', 'usp'], entry: `let m; const load = () => (m ??= require(${pkg('whatwg-url-15/index.js')}));
    for (const k of ['URL', 'URLSearchParams']) Object.defineProperty(globalThis, k, { configurable: true, enumerable: false, get() { const v = load()[k]; Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true, enumerable: false }); return v; } });` },
  // Same package, its UTS #46 table (tr46) loaded on the first host that needs domain-to-ASCII.
  'url:whatwg-url@15 lazy-tr46': { suites: ['url', 'urlSetters', 'usp'], plugins: 'lazyTr46', entry: `import { URL, URLSearchParams } from ${pkg('whatwg-url-15/index.js')}; Object.assign(globalThis, { URL, URLSearchParams });` },
  'url:core-js': { suites: ['url', 'urlSetters', 'urlShape', 'usp'], entry: `import ${pkg('core-js/actual/url/index.js')}; import ${pkg('core-js/actual/url-search-params/index.js')};` },
  'url:bridge': { suites: ['url', 'urlSetters', 'urlShape'], entry: `import ${src('url-bridge.js')};`, bridge: true },
  'clone:@ungap': { suites: ['clone'], entry: `import sc from ${pkg('@ungap/structured-clone/esm/index.js')}; globalThis.structuredClone = sc;` },
  'clone:core-js': { suites: ['clone'], entry: `import ${pkg('core-js/actual/structured-clone.js')};` },
  'clone:bridge': { suites: ['clone'], entry: `import ${src('clone-bridge.js')};`, bridge: true },
  'blob:formdata-node': { suites: ['blob'], entry: `import { Blob, File } from ${pkg('formdata-node/lib/form-data.js')}; Object.assign(globalThis, { Blob, File });` },
  'blob:blob-polyfill': { suites: ['blob'], entry: `import m from ${pkg('blob-polyfill/Blob.js')}; Object.assign(globalThis, { Blob: m.Blob, File: m.File });` },
  'blob:fetch-blob': { suites: ['blob'], entry: `import Blob from ${pkg('fetch-blob/index.js')}; import File from ${pkg('fetch-blob/file.js')}; Object.assign(globalThis, { Blob, File });` },
};
const PLUGINS = {
  lazyTr46: [{
    name: 'lazy-tr46',
    setup(b) {
      b.onLoad({ filter: /whatwg-url-15\/lib\/url-state-machine\.js$/ }, async (a) => {
        const text = readFileSync(a.path, 'utf8');
        const eager = 'const tr46 = require("tr46");';
        if (!text.includes(eager)) throw new Error('lazy-tr46: anchor missing');
        return { contents: text.replace(eager, 'let tr46_; const tr46 = { toASCII: (...a) => (tr46_ ??= require("tr46")).toASCII(...a) };'), loader: 'js' };
      });
    },
  }],
};
const bundle = async (contents, minify, sizes, plugins) => {
  const r = await build({
    plugins: plugins ? PLUGINS[plugins] : [],
    stdin: { contents, resolveDir: here, loader: 'js' },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify, legalComments: 'none', logLevel: 'silent', metafile: true,
  });
  if (sizes) {
    // Unminified output bytes per package (the biggest shares of a variant).
    for (const [k, v] of Object.entries(Object.values(r.metafile.outputs)[0].inputs)) {
      const key = k.match(/.*node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1] ?? 'probe/guest source';
      sizes[key] = (sizes[key] ?? 0) + v.bytesInOutput;
    }
  }
  return r.outputFiles[0].text;
};
const prelude = await bundle(`import ${src('prelude.js')};`, false);
const cases = readFileSync(join(here, 'cases.js'), 'utf8');
for (const [name, v] of Object.entries(VARIANTS)) {
  try {
    // Unminified, as the guest bundle is built (scripts/build-guest.mjs); minified size for reference.
    v.byPackage = {};
    v.code = await bundle(v.entry, false, v.byPackage, v.plugins);
    v.bytes = Buffer.byteLength(v.code);
    v.gzip = gzipSync(v.code).length;
    v.minBytes = Buffer.byteLength(await bundle(v.entry, true, undefined, v.plugins));
  } catch (e) {
    v.buildError = String(e.errors?.[0]?.text ?? e.message);
  }
}

// Host side of the bridges: ada through Node's URL; ExternalCopy copies for structuredClone.
const F = ['href', 'origin', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'];
const fields = (u) => F.map((f) => u[f]);
function hostUrl(op, a, b, c) {
  if (op === 'parse') {
    const u = URL.parse(a, b);
    return u === null ? null : fields(u);
  }
  const u = new URL(a);
  try {
    u[b] = c;
  } catch {
    return null;
  }
  return fields(u);
}
async function isolateWith(v) {
  const isolate = new ivm.Isolate({ memoryLimit: 128 });
  const context = await isolate.createContext();
  const jail = context.global;
  if (v.bridge) {
    await jail.set('__hostUrl', new ivm.Callback(hostUrl));
    await jail.set('__hostClone', new ivm.Callback((x) => x));
  }
  await (await isolate.compileScript(prelude)).run(context);
  await (await isolate.compileScript(v.code)).run(context);
  return { isolate, context };
}

// 3. Parity: every case's description in the isolate vs live Node.
async function parity() {
  globalThis.__DATA = DATA;
  vm.runInThisContext(cases);
  const report = {};
  for (const [name, v] of Object.entries(VARIANTS)) {
    if (v.buildError) {
      report[name] = { buildError: v.buildError };
      continue;
    }
    const node = JSON.parse(await globalThis.__runCases(v.suites));
    let isolate;
    let context;
    try {
      ({ isolate, context } = await isolateWith(v));
    } catch (e) {
      report[name] = { bytes: v.bytes, gzip: v.gzip, minBytes: v.minBytes, byPackage: v.byPackage, installError: String(e.message) };
      continue;
    }
    await context.global.set('__DATA', new ivm.ExternalCopy(DATA).copyInto());
    await (await isolate.compileScript(cases)).run(context);
    const guest = JSON.parse(await context.eval(`__runCases(${JSON.stringify(v.suites)})`, { promise: true, timeout: 60_000 }));
    isolate.dispose();
    report[name] = { bytes: v.bytes, gzip: v.gzip, minBytes: v.minBytes, byPackage: v.byPackage, suites: {} };
    for (const suite of v.suites) {
      const n = node[suite];
      const g = guest[suite];
      if (!n.ok || !g.ok) {
        report[name].suites[suite] = { suiteError: { node: n, guest: g } };
        continue;
      }
      const diffs = [];
      let errorShapeOnly = 0;
      n.ok.forEach(([label, res], i) => {
        const gres = g.ok[i][1];
        if (JSON.stringify(res) === JSON.stringify(gres)) return;
        if (res.threw && gres.threw) errorShapeOnly++;
        diffs.push({ case: label, node: res, guest: gres });
      });
      const valueDiffs = diffs.filter((d) => !(d.node.threw && d.guest.threw));
      report[name].suites[suite] = {
        cases: n.ok.length,
        differ: diffs.length,
        valueDiffs: valueDiffs.length,
        errorShapeOnly,
        valueExamples: valueDiffs.slice(0, 6),
        errorExamples: diffs.filter((d) => d.node.threw && d.guest.threw).slice(0, 3),
      };
      report[name].suites[suite].allDiffs = diffs.map((d) => d.case);
    }
  }
  return report;
}

// 4. Timing (run alone: other load skews it). Fresh isolate per sample, code cache as the child does.
const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
const ms = (t) => Number(t) / 1e6;
const FIRST_USE = {
  url: `new URL('https://user:pw@example.com:8080/a/../b?c=d#e', undefined).href`,
  urlFile: `new URL('./m.mjs', 'file:///workspace/main.mjs').href`,
  clone: `structuredClone({ a: [1, new Date(0), new Map([[1, 2]])] }).a.length`,
  blob: `new Blob(['ab', new Uint8Array([1])]).size`,
};
const LOOP = {
  url: `(() => { let n = 0; for (let i = 0; i < 10000; i++) n += new URL('/p' + i + '?q=' + i, 'https://example.com/a/b').href.length; return n; })()`,
  clone: `(() => { let n = 0; const v = { a: [1, 'x', { b: 2 }], d: new Date(0) }; for (let i = 0; i < 10000; i++) n += structuredClone(v).a.length; return n; })()`,
};
async function timingRun() {
  const out = { loadavg: loadavg().map((x) => x.toFixed(1)), samples: 40 };
  const sample = async (code, cache, withPrelude = true) => {
    const isolate = new ivm.Isolate({ memoryLimit: 128 });
    const context = await isolate.createContext();
    await context.global.set('__hostUrl', new ivm.Callback(hostUrl));
    await context.global.set('__hostClone', new ivm.Callback((x) => x));
    if (withPrelude) await (await isolate.compileScript(prelude)).run(context);
    const t0 = process.hrtime.bigint();
    const script = await isolate.compileScript(code, cache ? { cachedData: cache } : { produceCachedData: true });
    await script.run(context);
    const t1 = process.hrtime.bigint();
    isolate.dispose();
    return { evalMs: ms(t1 - t0), cachedData: script.cachedData };
  };
  const measure = async (code) => {
    const { cachedData } = await sample(code);
    const xs = [];
    for (let i = 0; i < out.samples; i++) xs.push((await sample(code, cachedData)).evalMs);
    return median(xs);
  };
  const base = await measure('void 0');
  out.baselineEmptyScriptMs = base;
  out.variants = {};
  for (const [name, v] of Object.entries(VARIANTS)) {
    if (v.buildError) continue;
    const kind = name.split(':')[0];
    let installMs;
    try {
      installMs = (await measure(v.code)) - base;
    } catch (e) {
      out.variants[name] = { installError: String(e.message) };
      continue;
    }
    const firstUseMs = (await measure(`${v.code};${FIRST_USE[kind]}`)) - base - installMs;
    const r = { installMs: +installMs.toFixed(2), firstUseMs: +firstUseMs.toFixed(2) };
    if (kind === 'url') r.firstUseFileUrlMs = +((await measure(`${v.code};${FIRST_USE.urlFile}`)) - base - installMs).toFixed(2);
    if (LOOP[kind]) {
      const isolate = new ivm.Isolate({ memoryLimit: 256 });
      const context = await isolate.createContext();
      await context.global.set('__hostUrl', new ivm.Callback(hostUrl));
      await context.global.set('__hostClone', new ivm.Callback((x) => x));
      await (await isolate.compileScript(prelude)).run(context);
      await (await isolate.compileScript(v.code)).run(context);
      const xs = [];
      for (let i = 0; i < 5; i++) {
        const t0 = process.hrtime.bigint();
        await context.eval(LOOP[kind], { timeout: 60_000 });
        xs.push(ms(process.hrtime.bigint() - t0));
      }
      isolate.dispose();
      r.loop10kMs = +median(xs).toFixed(1);
    }
    out.variants[name] = r;
  }
  const nodeLoop = {};
  for (const [kind, code] of Object.entries(LOOP)) {
    const xs = [];
    for (let i = 0; i < 5; i++) {
      const t0 = process.hrtime.bigint();
      vm.runInThisContext(code);
      xs.push(ms(process.hrtime.bigint() - t0));
    }
    nodeLoop[kind] = +median(xs).toFixed(1);
  }
  out.nodeNativeLoop10kMs = nodeLoop;
  return out;
}

const result = {
  date: new Date().toISOString(),
  node: process.version,
  isolatedVm: require('isolated-vm/package.json').version,
  esbuild: createRequire(join(root, 'packages/isolate-guest/package.json'))('esbuild/package.json').version,
  loadavg: loadavg().map((x) => x.toFixed(1)),
  preludeBytes: Buffer.byteLength(prelude),
  ...(timing ? { timing: await timingRun() } : { parity: await parity() }),
};
const text = JSON.stringify(result, null, 2);
if (jsonOut) writeFileSync(jsonOut, `${text}\n`);
else console.log(text);
