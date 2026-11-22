import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import ivm from '../../../../../packages/isolate-host/node_modules/isolated-vm/isolated-vm.js';
import { createHostBridge } from '../../../../../packages/isolate-guest/dist/index.js';

const [packFile, memoryLimit, only] = [process.argv[2], Number(process.argv[3] ?? 2048), process.argv[4]];
const bundle = readFileSync(new URL('./spike.js', import.meta.url), 'utf8');
async function isolateWith() {
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
const heap = (i) => {
  const s = i.getHeapStatisticsSync();
  return Math.round((s.used_heap_size + s.externally_allocated_size) / 1048576);
};
const pack = readFileSync(packFile);
const formats = only ? only.split(',') : ['bin-sha', 'bin-crc', 'bin-none', 'tar', 'tar-times', 'json'];
for (const fmt of formats) {
  const runs = [];
  for (let r = 0; r < 3; r++) {
    const { isolate, context } = await isolateWith();
    await context.evalClosure('globalThis.__pack = $0;', [
      new Uint8Array(pack.buffer.slice(pack.byteOffset, pack.byteOffset + pack.byteLength)),
    ], { arguments: { copy: true } });
    await context.eval('spike.load(globalThis.__pack); globalThis.__pack = null; undefined');
    const h0 = heap(isolate);
    const d0 = await context.eval('spike.digest()');
    const [kind, hash] = fmt.split('-');
    const call =
      kind === 'bin' ? `spike.exportBin('${hash}')` : kind === 'tar' ? `spike.exportTar(${hash === 'times'})` : 'spike.exportJson()';
    let t = Date.now();
    await context.eval(`globalThis.__blob = ${call}; undefined`);
    const tExport = Date.now() - t;
    const hExport = heap(isolate);
    t = Date.now();
    const blobRef = await context.global.get('__blob', { reference: true });
    const blob = await blobRef.copy();
    const tCopyOut = Date.now() - t;
    isolate.dispose();
    const b = await isolateWith();
    t = Date.now();
    await b.context.evalClosure('globalThis.__blob = $0; undefined', [blob], { arguments: { copy: true } });
    const tCopyIn = Date.now() - t;
    const imp =
      kind === 'bin' ? `spike.importBin(__blob, '${hash}', false)` : kind === 'tar' ? 'spike.importTar(__blob)' : 'spike.importJson(__blob)';
    t = Date.now();
    await b.context.eval(`${imp}; undefined`);
    const tImport = Date.now() - t;
    const hImport = heap(b.isolate);
    const d1 = await b.context.eval('spike.digest()');
    b.isolate.dispose();
    const g = gzipSync(blob);
    runs.push({ tExport, tImport, tCopyOut, tCopyIn, size: blob.length, gzip: g.length, hBefore: h0, hExport, hImport, same: d0 === d1 });
  }
  const med = (k) => runs.map((x) => x[k]).sort((a, b) => a - b)[1];
  console.log(
    fmt,
    JSON.stringify({
      exportMs: med('tExport'),
      importMs: med('tImport'),
      copyOutMs: med('tCopyOut'),
      copyInMs: med('tCopyIn'),
      bytes: runs[0].size,
      gzipBytes: runs[0].gzip,
      heapFsMiB: med('hBefore'),
      heapAfterExportMiB: med('hExport'),
      heapAfterImportMiB: med('hImport'),
      roundTripSame: runs.every((x) => x.same),
    }),
  );
}
