import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { createModuleLoader } from '../module-loader/loader.ts';
import { evalInRepl } from '../repl/eval.ts';

const TOOLCHAIN_REALM = Symbol.for('rifty.runtime-js.sandbox-toolchain.v1');

// The identical program runs in native Node, REPL and both real module loaders.
const probe = `(() => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
  const oldBuffer = memory.buffer;
  const grew = memory.grow(1);
  const observe = (shared) => {
    const log = [];
    let reads = 0;
    const descriptor = Object.defineProperties({}, {
      initial: { get() { log.push('initial'); return 1; } },
      maximum: { get() { log.push('maximum'); return 2; } },
      shared: { get() { log.push('shared'); return shared(++reads); } },
    });
    const result = new WebAssembly.Memory(descriptor);
    return { log, reads, brand: Object.prototype.toString.call(result.buffer) };
  };
  const errors = [undefined, {}, { initial: -1 }, { initial: 1, shared: true }].map((descriptor) => {
    try { new WebAssembly.Memory(descriptor); return null; }
    catch (error) { return { name: error.name, message: error.message }; }
  });
  const order = [];
  const newTarget = new Proxy(function CustomMemory() {}, {
    get(target, key, receiver) {
      if (key === 'prototype') order.push('prototype');
      return Reflect.get(target, key, receiver);
    },
  });
  Reflect.construct(WebAssembly.Memory, [{ get initial() { order.push('initial'); return 1; } }], newTarget);
  class Derived extends WebAssembly.Memory {}
  const derived = new Derived({ initial: 1 });
  class Descriptor {
    initial = 1;
    #shared = false;
    get shared() { return this.#shared; }
  }
  return {
    namespace: WebAssembly === globalThis.WebAssembly,
    constructor: memory.constructor === WebAssembly.Memory,
    descriptor: Object.getOwnPropertyDescriptor(WebAssembly, 'Memory').value === WebAssembly.Memory,
    shorthand: ({ WebAssembly }).WebAssembly === globalThis.WebAssembly,
    instance: memory instanceof WebAssembly.Memory,
    derived: derived.constructor === Derived && derived instanceof Derived,
    bytes: memory.buffer.byteLength, grew, oldBufferBytes: oldBuffer.byteLength,
    receiver: new WebAssembly.Memory(new Descriptor()).buffer.byteLength,
    falseThenTrue: observe((read) => read > 1),
    shared: observe(() => 'truthy'), errors, order,
  };
})()`;

afterEach(() => {
  Reflect.deleteProperty(globalThis, TOOLCHAIN_REALM);
});

describe('native WebAssembly across toolchain guest entry points', () => {
  it.each(['repl', 'cjs', 'esm'] as const)('%s matches the real Node oracle', async (entry) => {
    const expected = new Function(`return ${probe}`)();
    expect(expected.namespace).toBe(true);
    expect(expected.constructor).toBe(true);
    expect(expected.descriptor).toBe(true);
    Object.defineProperty(globalThis, TOOLCHAIN_REALM, { value: true, configurable: true });
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/probe.cjs': `module.exports = ${probe};`,
      '/work/probe.mjs': `export const result = ${probe};`,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });
    const actual =
      entry === 'repl'
        ? await evalInRepl(probe)
        : entry === 'cjs'
          ? loader.require('./probe.cjs', '/work/entry.cjs')
          : (await loader.import('./probe.mjs', '/work/entry.mjs')).result;
    expect(actual).toEqual(expected);
  });
});
