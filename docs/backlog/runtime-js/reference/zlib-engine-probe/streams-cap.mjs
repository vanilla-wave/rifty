// Per-stream wasm memory (allocator growth per open stream) and where a realm's 4 GiB wasm32 space
// runs out: open deflate (default, memLevel 9) / inflate streams until init fails. usage: node streams-cap.mjs DEPS BUILD
import zlib from 'node:zlib';
import { Context } from './driver.mjs';
import { loadEngines } from './engines.mjs';

const [deps, build] = process.argv.slice(2);
const data = new TextEncoder().encode('lorem ipsum dolor '.repeat(100));
for (const [mode, opts] of [
  ['DEFLATE', {}],
  ['DEFLATE', { memLevel: 9 }],
  ['INFLATE', {}],
]) {
  const e = loadEngines(deps, build)['wasm-node-zlib']; // fresh instance per row
  const bytes = () => e.exports.memory.buffer.byteLength;
  const z = new Context(e, 'DEFLATE', {}).processChunkSync(data, 4);
  const w0 = bytes();
  const open = [];
  let per = null;
  let at10k = null;
  let error = null;
  while (!error && open.length < 20000) {
    const c = new Context(e, mode, opts);
    try {
      c.processChunkSync(mode === 'INFLATE' ? z.subarray(0, 20) : data, 0);
      open.push(c);
    } catch (err) {
      error = `${err.message} [${err.code}]`;
    }
    if (open.length === 100) per = (bytes() - w0) / 100;
    if (open.length === 10000) at10k = bytes();
  }
  console.log(
    JSON.stringify({
      mode,
      opts,
      bytesPerStream: Math.round(per),
      wasmMiBAt10000: at10k ? Math.round(at10k / 1048576) : null,
      opened: open.length,
      wasmMiBAtStop: Math.round(bytes() / 1048576),
      error,
    }),
  );
}
// Real Node: 10000 open deflate streams, one written chunk each (native memory, no wasm32 cap).
{
  const rss0 = process.memoryUsage().rss;
  const open = [];
  for (let i = 0; i < 10000; i++) {
    const d = zlib.createDeflate();
    d.on('error', (e) => console.log(JSON.stringify({ native: e.message, code: e.code })));
    d.write(data);
    open.push(d);
  }
  await new Promise((r) => setTimeout(r, 2000));
  console.log(
    JSON.stringify({
      mode: 'node:zlib createDeflate',
      opened: open.length,
      rssGrowthMiB: Math.round((process.memoryUsage().rss - rss0) / 1048576),
    }),
  );
  process.exit(0);
}
