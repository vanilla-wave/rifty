// Per-stream engine memory: 100 concurrent deflate + 100 inflate streams, then all closed.
// wasm: linear memory (never shrinks); pako: JS heap + array buffers (GC'd).
// usage: node --expose-gc memory.mjs DEPS BUILD
import { Context } from './driver.mjs';
import { loadEngines } from './engines.mjs';

const [deps, build] = process.argv.slice(2);
const engines = loadEngines(deps, build);
const data = new TextEncoder().encode('lorem ipsum dolor '.repeat(2000));
const mem = async () => {
  await new Promise((r) => setTimeout(r, 20));
  globalThis.gc();
  globalThis.gc();
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
};
for (const name of ['wasm-node-zlib', 'pako@3.0.3']) {
  const e = engines[name];
  const wasmBytes = () => e.exports?.memory.buffer.byteLength ?? 0;
  const js0 = await mem();
  const w0 = wasmBytes();
  const ctxs = [];
  for (let i = 0; i < 100; i++) {
    const d = new Context(e, 'DEFLATE', {});
    d.processChunkSync(data, 0);
    const z = new Context(e, 'INFLATE', {});
    const once = new Context(e, 'DEFLATE', {});
    z.processChunkSync(once.processChunkSync(data, 4), 0);
    once.close();
    ctxs.push(d, z);
  }
  const js1 = await mem();
  const w1 = wasmBytes();
  for (const c of ctxs) c.close();
  ctxs.length = 0;
  const js2 = await mem();
  const w2 = wasmBytes();
  const mb = (x) => +(x / 1048576).toFixed(1);
  // Reopen 200 after the close: does the freed wasm memory get reused?
  for (let i = 0; i < 100; i++) {
    ctxs.push(new Context(e, 'DEFLATE', {}), new Context(e, 'INFLATE', {}));
    ctxs.at(-2).processChunkSync(data, 0);
    ctxs.at(-1).initZlib();
  }
  const w3 = wasmBytes();
  for (const c of ctxs) c.close();
  console.log(
    JSON.stringify({
      engine: name,
      reopenWasmMiB: +((w3 - w0) / 1048576).toFixed(1),
      streams: '100 deflate + 100 inflate',
      openMiB: { js: mb(js1 - js0), wasm: mb(w1 - w0) },
      afterCloseMiB: { js: mb(js2 - js0), wasm: mb(w2 - w0) },
    }),
  );
}
