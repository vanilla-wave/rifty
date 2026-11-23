// Does a guest output view cross the bridge as its range or as its whole backing buffer?
import { readFileSync } from 'node:fs';
import { createHostBridge } from '../../../../../packages/isolate-guest/dist/index.js';
import ivm from '../../../../../packages/isolate-host/node_modules/isolated-vm/isolated-vm.js';

const bundle = readFileSync('../../../../../packages/isolate-guest/dist/guest.js', 'utf8');
const seen = [];
const { functions, timeOrigin, close } = createHostBridge({
  write: (_fd, bytes) => seen.push([bytes.byteLength, bytes.buffer.byteLength]),
  fire: () => {},
});
const isolate = new ivm.Isolate({ memoryLimit: 512 });
const context = await isolate.createContext();
const names = Object.keys(functions);
await context.evalClosure(
  `globalThis.__riftyIsolateHost = { timeOrigin: ${timeOrigin}, ${names.map((n, i) => `${n}: $${i}`).join(', ')} };`,
  names.map((n) => new ivm.Callback(functions[n])),
);
await (await isolate.compileScript(bundle)).run(context);
const entry = await context.global.get('__riftyGuest', { reference: true });
const start = await entry.get('run', { reference: true });
const rss0 = process.memoryUsage().rss;
const t = Date.now();
const code =
  'const big = new Uint8Array(256 * 1024 * 1024); for (let i = 0; i < 8; i++) process.stdout.write(big.subarray(i, i + 1)); fs.writeSync(1, Buffer.from(big.buffer, 0, 1))';
start
  .apply(undefined, [code], { arguments: { copy: true }, result: { promise: true, copy: true } })
  .then(
    (s) => console.log('status', s),
    (e) => console.log('rej', e.message),
  );
await new Promise((r) => setTimeout(r, 4000));
console.log(
  JSON.stringify(seen),
  'ms',
  Date.now() - t,
  'host rss +MiB',
  Math.round((process.memoryUsage().rss - rss0) / 1048576),
);
close();
isolate.dispose();
