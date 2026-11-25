// Speed in Node's main realm: native node:zlib vs pako@3.0.3 vs wasm, 1 and 50 MiB, level 6.
// usage: node bench-node.mjs DEPS BUILD
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const [deps, build] = process.argv.slice(2);
vm.runInThisContext(readFileSync(join(deps, 'pako3/package/dist/browser/pako.umd.min.js'), 'utf8'));
globalThis.ZLIB_WASM = readFileSync(join(build, 'zlib.wasm'));
vm.runInThisContext(readFileSync(new URL('./bench-core.js', import.meta.url), 'utf8'));
const { zbench } = globalThis;
const best = (f, n) => {
  let b = Number.POSITIVE_INFINITY;
  let o;
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    o = f();
    b = Math.min(b, performance.now() - t);
  }
  return { ms: +b.toFixed(1), o };
};
console.log(`node ${process.version} ${process.arch}`);
for (const mib of [1, 50]) {
  const reps = mib === 1 ? 7 : 2;
  const d = zbench.data(mib * 1048576);
  const c = best(() => zlib.deflateSync(d, { level: 6 }), reps);
  const u = best(() => zlib.inflateSync(c.o), reps);
  console.log(
    JSON.stringify({
      engine: 'node:zlib',
      mib,
      deflateMs: c.ms,
      inflateMs: u.ms,
      ratio: +(d.length / c.o.length).toFixed(2),
    }),
  );
  for (const name of ['pako', 'wasm']) {
    const { compressed, ...r } = zbench.run(name, mib, reps);
    r.sameBytesAsNode = Buffer.compare(Buffer.from(compressed), c.o) === 0;
    console.log(JSON.stringify(r));
  }
}
