// Smallest isolate memoryLimit (MiB) at which each phase still succeeds, bin-crc format.
import { readFileSync } from 'node:fs';
import { createHostBridge } from '../../../../../packages/isolate-guest/dist/index.js';
import ivm from '../../../../../packages/isolate-host/node_modules/isolated-vm/isolated-vm.js';

const bundle = readFileSync(new URL('./spike.js', import.meta.url), 'utf8');
const pack = readFileSync(process.argv[2]);
const view = process.argv[3] === 'view';
const META_LEN = pack.readUInt32LE(0);
const META = JSON.parse(pack.subarray(4, 4 + META_LEN).toString());
async function isolateWith(memoryLimit) {
  const isolate = new ivm.Isolate({ memoryLimit });
  const context = await isolate.createContext();
  const { functions, timeOrigin } = createHostBridge({ write: () => {}, fire: () => {} });
  const names = Object.keys(functions);
  await context.evalClosure(
    `globalThis.__riftyIsolateHost = { timeOrigin: ${timeOrigin}, ${names.map((n, i) => `${n}: $${i}`).join(', ')} };`,
    names.map((n) => new ivm.Callback(functions[n])),
  );
  await (await isolate.compileScript(bundle)).run(context);
  return { isolate, context };
}
async function loaded(limit) {
  const x = await isolateWith(limit);
  // Feed the dataset in 8 MiB pieces so the feed itself does not set the floor.
  await x.context.eval('spike.begin()');
  await x.context.evalClosure(
    'spike.add($0, new Uint8Array(0))',
    [{ dirs: META.dirs, files: [] }],
    { arguments: { copy: true } },
  );
  let off = 4 + META_LEN;
  for (let i = 0; i < META.files.length; i += 500) {
    const files = META.files.slice(i, i + 500);
    const n = files.reduce((a, f) => a + f[1], 0);
    await x.context.evalClosure(
      'spike.add($0, $1)',
      [{ dirs: [], files }, new Uint8Array(pack.subarray(off, off + n))],
      { arguments: { copy: true } },
    );
    off += n;
  }
  return x;
}
async function phase(limit, which, blob) {
  let x;
  try {
    if (which === 'load') {
      x = await loaded(limit);
      return true;
    }
    if (which === 'export') {
      x = await loaded(limit);
      await x.context.eval("globalThis.__b = spike.exportBin('crc'); undefined");
      return true;
    }
    x = await isolateWith(limit);
    await x.context.evalClosure('globalThis.__b = $0; undefined', [blob], {
      arguments: { copy: true },
    });
    await x.context.eval(
      `spike.importBin(globalThis.__b, 'crc', ${view}); globalThis.__b = null; undefined`,
    );
    return true;
  } catch {
    return false;
  } finally {
    if (x && !x.isolate.isDisposed) x.isolate.dispose();
  }
}
const x = await loaded(4096);
await x.context.eval("globalThis.__b = spike.exportBin('crc'); undefined");
const blob = await (await x.context.global.get('__b', { reference: true })).copy();
x.isolate.dispose();
for (const which of ['load', 'export', 'import']) {
  let lo = 64;
  let hi = 4096;
  while (hi - lo > 8) {
    const mid = Math.floor((lo + hi) / 2);
    if (await phase(mid, which, blob)) hi = mid;
    else lo = mid;
  }
  console.log(which, 'min memoryLimit MiB ≈', hi, 'blob MiB', (blob.length / 1048576).toFixed(1));
}
