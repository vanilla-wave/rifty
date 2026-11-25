// isolated-vm (rifty's pinned 7.0.2): first-use cost in a fresh isolate, speed, memory accounting.
// usage: node bench-isolate.mjs DEPS BUILD REPO_ROOT
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [deps, build, repo] = process.argv.slice(2);
const ivm = createRequire(join(repo, 'packages/isolate-host/package.json'))('isolated-vm');
const PAKO = readFileSync(join(deps, 'pako3/package/dist/browser/pako.umd.min.js'), 'utf8');
const WASM = readFileSync(join(build, 'zlib.wasm'));
const CORE = readFileSync(new URL('./bench-core.js', import.meta.url), 'utf8');
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function isolate(memoryLimit, withPako, withWasm) {
  const iso = new ivm.Isolate({ memoryLimit });
  const ctx = await iso.createContext();
  await ctx.global.set('globalThis', ctx.global.derefInto());
  const t = performance.now();
  if (withPako) await (await iso.compileScript(PAKO)).run(ctx);
  const pakoLoadMs = performance.now() - t;
  if (withWasm)
    await ctx.global.set('ZLIB_WASM', new ivm.ExternalCopy(new Uint8Array(WASM)).copyInto());
  await (await iso.compileScript(CORE)).run(ctx);
  return { iso, ctx, pakoLoadMs };
}
const evalJson = (ctx, code) =>
  ctx.eval(`JSON.stringify(${code})`, { timeout: 600000 }).then(JSON.parse);

console.log(
  `node ${process.version} isolated-vm ${createRequire(join(repo, 'packages/isolate-host/package.json'))('isolated-vm/package.json').version}`,
);
// 1. First use in a fresh isolate (what a warm runCode call that touches zlib pays once).
const fu = { pako: [], pakoLoad: [], wasm: [], wasmCompile: [], wasmInst: [] };
for (let i = 0; i < 15; i++) {
  const a = await isolate(128, true, false);
  fu.pakoLoad.push(a.pakoLoadMs);
  let t = performance.now();
  await evalJson(a.ctx, `zbench.firstUse('pako')`);
  fu.pako.push(performance.now() - t); // host clock: the isolate has only Date.now
  a.iso.dispose();
  const b = await isolate(128, false, true);
  t = performance.now();
  await b.ctx.eval('globalThis.__m = new WebAssembly.Module(ZLIB_WASM)');
  fu.wasmCompile.push(performance.now() - t);
  t = performance.now();
  await b.ctx.eval('new WebAssembly.Instance(__m, {}).exports._initialize()');
  fu.wasmInst.push(performance.now() - t);
  t = performance.now();
  await evalJson(b.ctx, `zbench.firstUse('wasm')`);
  fu.wasm.push(performance.now() - t);
  b.iso.dispose();
}
const m = (k) => +median(fu[k]).toFixed(2);
console.log(
  JSON.stringify({
    firstUseMedianMs: {
      pakoScriptCompileAndRun: m('pakoLoad'),
      pakoFirstUse1KiBRoundTrip: m('pako'),
      wasmSyncCompile: m('wasmCompile'),
      wasmInstantiate: m('wasmInst'),
      wasmFirstUse1KiBRoundTripInclCompile: m('wasm'),
    },
    n: 15,
  }),
);
// 1b. Can a compiled module cross isolates (compile once per worker)?
try {
  const mod = new WebAssembly.Module(WASM);
  const c = new ivm.ExternalCopy(mod);
  const { iso, ctx } = await isolate(64, false, false);
  await ctx.global.set('M', c.copyInto());
  console.log(
    JSON.stringify({ moduleAcrossIsolates: await ctx.eval('M instanceof WebAssembly.Module') }),
  );
  iso.dispose();
} catch (e) {
  console.log(JSON.stringify({ moduleAcrossIsolates: false, error: e.message }));
}
// 2. Speed inside the isolate.
for (const mib of [1, 50]) {
  for (const name of ['pako', 'wasm']) {
    const { iso, ctx } = await isolate(1024, true, true);
    const r = await evalJson(
      ctx,
      `(() => { const { compressed, ...r } = zbench.run('${name}', ${mib}, ${mib === 1 ? 5 : 1}); return r; })()`,
    );
    const h = iso.getHeapStatisticsSync();
    console.log(
      JSON.stringify({
        realm: 'isolate',
        ...r,
        heapUsed: h.used_heap_size,
        externallyAllocated: h.externally_allocated_size,
      }),
    );
    iso.dispose();
  }
}
// 3. Memory accounting under memoryLimit 64 MiB.
async function limitProbe(label, code) {
  const { iso, ctx } = await isolate(64, true, true);
  let outcome;
  try {
    outcome = { ok: await ctx.eval(code, { timeout: 120000 }) };
  } catch (e) {
    outcome = { error: e.message.slice(0, 120) };
  }
  let h = null;
  try {
    h = iso.getHeapStatisticsSync();
  } catch {}
  console.log(
    JSON.stringify({
      memoryLimitMb: 64,
      probe: label,
      ...outcome,
      disposed: iso.isDisposed,
      externallyAllocated: h?.externally_allocated_size ?? null,
    }),
  );
  if (!iso.isDisposed) iso.dispose();
}
await limitProbe(
  'wasm memory.grow to 512 MiB',
  '(() => { const e = new WebAssembly.Instance(new WebAssembly.Module(ZLIB_WASM), {}).exports; e._initialize(); e.memory.grow(8192 - e.memory.buffer.byteLength / 65536); return e.memory.buffer.byteLength; })()',
);
await limitProbe(
  'wasm malloc 400 MiB and touch it',
  '(() => { const e = new WebAssembly.Instance(new WebAssembly.Module(ZLIB_WASM), {}).exports; e._initialize(); const p = e.malloc(400 << 20); new Uint8Array(e.memory.buffer).fill(1, p, p + (400 << 20)); return e.memory.buffer.byteLength; })()',
);
await limitProbe('Uint8Array 400 MiB (JS ArrayBuffer)', 'new Uint8Array(400 << 20).fill(1).length');
await limitProbe(
  'pako 50 MiB deflate',
  `(() => { const r = zbench.run('pako', 50, 1); return r.ratio; })()`,
);
await limitProbe(
  'wasm 50 MiB deflate',
  `(() => { const r = zbench.run('wasm', 50, 1); return r.ratio; })()`,
);
process.exit(0); // live isolate handles keep the loop alive
