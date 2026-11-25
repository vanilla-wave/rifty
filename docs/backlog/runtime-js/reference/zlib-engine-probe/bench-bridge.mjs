// Host-bridge candidate (isolate only): the guest calls the embedder's node:zlib through a sync
// ivm.Callback, bytes copied each way. Measures per-call cost and where the memory lands.
// usage: node bench-bridge.mjs REPO_ROOT
import { createRequire } from 'node:module';
import { join } from 'node:path';
import zlib from 'node:zlib';

const [repo] = process.argv.slice(2);
const ivm = createRequire(join(repo, 'packages/isolate-host/package.json'))('isolated-vm');
const iso = new ivm.Isolate({ memoryLimit: 64 });
const ctx = await iso.createContext();
// One sync primitive per handle op would be the real shape; one-shot is enough to price a crossing.
await ctx.global.set(
  'hostZlib',
  new ivm.Callback((op, bytes) => {
    const out = op === 'deflate' ? zlib.deflateSync(bytes) : zlib.inflateSync(bytes);
    return new ivm.ExternalCopy(new Uint8Array(out.buffer, out.byteOffset, out.length)).copyInto();
  }),
);
const ms = (code) => ctx.eval(code, { timeout: 600000 });
console.log(`node ${process.version}`);
for (const size of [0, 16384, 1 << 20, 50 << 20]) {
  const n = size >= 1 << 20 ? 3 : 2000;
  const r = await ms(`(() => {
    const d = new Uint8Array(${size}); for (let i = 0; i < d.length; i++) d[i] = (i * 31) % 251;
    const c = hostZlib('deflate', d);
    let t = Date.now();
    for (let i = 0; i < ${n}; i++) hostZlib('deflate', d);
    const dt = (Date.now() - t) / ${n};
    t = Date.now();
    for (let i = 0; i < ${n}; i++) hostZlib('inflate', c);
    return JSON.stringify({ bytes: ${size}, deflateMsPerCall: dt, inflateMsPerCall: (Date.now() - t) / ${n} });
  })()`).catch((e) => JSON.stringify({ bytes: size, error: e.message }));
  console.log(r);
}
const native = (() => {
  const d = Buffer.alloc(16384);
  const t = performance.now();
  for (let i = 0; i < 2000; i++) zlib.deflateSync(d);
  return (performance.now() - t) / 2000;
})();
console.log(JSON.stringify({ hostNativeDeflate16KiBMsPerCall: +native.toFixed(4) }));
// Bomb: 1 KiB of guest input inflating to 512 MiB in the host, guest memoryLimit 64 MiB.
const bomb = zlib.deflateSync(Buffer.alloc(512 << 20));
await ctx.global.set('BOMB', new ivm.ExternalCopy(new Uint8Array(bomb)).copyInto());
const before = process.memoryUsage().rss;
let peak = before;
const iv = setInterval(() => {
  peak = Math.max(peak, process.memoryUsage().rss);
}, 5);
const r = await ms(
  `(() => { try { return 'ok ' + hostZlib('inflate', BOMB).length; } catch (e) { return 'guest error: ' + e.message; } })()`,
).catch((e) => `isolate error: ${e.message}`);
clearInterval(iv);
console.log(
  JSON.stringify({
    bomb: {
      compressedBytes: bomb.length,
      guestMemoryLimitMb: 64,
      outcome: r,
      hostRssGrowthMb: Math.round((peak - before) / 1048576),
    },
  }),
);
process.exit(0);
