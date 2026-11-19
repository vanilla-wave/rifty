import { expect, it } from 'vitest';
import { runCode } from '../src/index.ts';
import { consumer, nodeEval } from './support.ts';

const off = { allowSharedArrayBuffer: false, timeoutMs: 30_000 };
const ok = (stdout: string) => ({ stdout, stderr: '', exitCode: 0 });
const gap = 'NotImplementedError isolate-host.SharedArrayBuffer\n';

const wasmMemory = 'new WebAssembly.Memory({initial: 1, maximum: 2, shared: true})';
// (module (memory (export "m") 1 2 shared))
const exportedMemory =
  'new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.of(0,97,115,109,1,0,0,0,5,4,1,3,1,2,7,5,1,1,109,2,0))).exports.m';

const sources = {
  global: 'new SharedArrayBuffer(8)',
  growable: 'new SharedArrayBuffer(8, {maxByteLength: 16})',
  'wasm memory': `${wasmMemory}.buffer`,
  'grown exported memory': `(() => { const m = ${exportedMemory}; m.grow(1); return m.buffer })()`,
};

for (const [name, expression] of Object.entries(sources)) {
  it(`denies ${name}`, async () => {
    const code = `try { console.log(Object.prototype.toString.call(${expression})) }
      catch (e) { console.log(e.name, e.feature) }`;
    expect(nodeEval(code).stdout).toBe('[object SharedArrayBuffer]\n');
    expect(await runCode(code, off)).toEqual(ok(gap));
  });
}

const behavior = `
  const b = new SharedArrayBuffer(4, {maxByteLength: 8}); b.grow(8);
  const v = new Int32Array(b);
  console.log(b.byteLength, Atomics.store(v, 0, 3), Atomics.wait(v, 0, 0, 0),
    Object.getPrototypeOf(b).constructor === SharedArrayBuffer, ${wasmMemory}.buffer.byteLength);
`;
it('keeps explicit allow and the default at live Node behavior', async () => {
  const raw = nodeEval(behavior);
  expect(raw.code).toBe(0);
  for (const options of [undefined, { ...off, allowSharedArrayBuffer: true }]) {
    expect(await runCode(behavior, options)).toEqual(ok(raw.stdout));
  }
});

it('ordinary backing stores and their prototype constructors stay unshared', async () => {
  const code = `const m = new WebAssembly.Memory({initial: 1, maximum: 2}); m.grow(1);
    const getBuffer = Object.getOwnPropertyDescriptor(WebAssembly.Memory.prototype, 'buffer').get;
    console.log(getBuffer.name, Object.hasOwn(getBuffer, 'prototype'));
    try { Reflect.construct(Object, [], getBuffer); console.log('constructable') }
    catch (e) { console.log(e.name) }
    for (const b of [m.buffer, new Uint8Array(8).buffer, new DataView(new ArrayBuffer(8)).buffer, Buffer.alloc(8).buffer,
        new TextEncoder().encode('x').buffer, crypto.getRandomValues(new Uint8Array(4)).buffer]) {
      const ctor = Object.getPrototypeOf(b).constructor;
      console.log(ctor === ArrayBuffer, Object.prototype.toString.call(new ctor(4)));
    }
    const v = new Int32Array(1);
    for (const f of ['wait', 'waitAsync']) try { console.log(Atomics[f](v, 0, 0, 0)) }
      catch (e) { console.log(e.name) }
    console.log(Atomics.store(v, 0, 42), Atomics.load(v, 0), Atomics.notify(v, 0), m.buffer.byteLength);`;
  const raw = nodeEval(code);
  expect(raw.code).toBe(0);
  expect(await runCode(code, off)).toEqual(ok(raw.stdout));
});

const checkPolicy =
  "try { new SharedArrayBuffer(4); console.log('on') } catch (e) { console.log(e.name, e.feature) }";
it('keeps alternating policies on the same worker, sequentially and concurrently', async () => {
  const { value } = await consumer(`
    const code = ${JSON.stringify(checkPolicy)};
    const call = (flag, delay) => runCode('setTimeout(() => {' + code + '}, ' + delay + ')',
      {allowSharedArrayBuffer: flag});
    const first = await call(false, 0);
    const warm = children();
    const batch = await Promise.all([true, false, undefined, false].map(flag => call(flag, 200)));
    out([first, batch, await call(true, 0), warm.length, String(warm) === String(children())]);`);
  expect(value).toEqual([ok(gap), [ok('on\n'), ok(gap), ok('on\n'), ok(gap)], ok('on\n'), 1, true]);
});

it('retains a restriction on a solo retry', async () => {
  const { value } = await consumer(`
    await runCode('0');
    const [worker] = children();
    const pending = runCode(${JSON.stringify(`setTimeout(() => {${checkPolicy}}, 300)`)},
      {allowSharedArrayBuffer: false});
    kill(worker);
    out(await pending);`);
  expect(value).toEqual(ok(gap));
});

it('rejects invalid policy values before starting guest code', async () => {
  for (const flag of [0, null, 'false']) {
    await expect(
      runCode('0', { ...off, allowSharedArrayBuffer: flag } as unknown as typeof off),
    ).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_TYPE' });
  }
});
