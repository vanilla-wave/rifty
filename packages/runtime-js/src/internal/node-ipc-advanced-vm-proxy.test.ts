import nativeVm from 'node:vm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { setVmEngineOverride } from '../builtins/vm/engine-config.ts';
import vm from '../builtins/vm/index.ts';
import { ensureVmEngineReady } from '../builtins/vm/quickjs-loader.ts';
import { deserializeNodeIpcMessage, serializeNodeIpcMessage } from './node-ipc-serialization.ts';

beforeAll(async () => {
  setVmEngineOverride('quickjs');
  await ensureVmEngineReady();
});

afterAll(() => setVmEngineOverride(undefined));

it('rejects VM plain/array/Proxy wrappers through the native clone boundary, retaining host origins', () => {
  const original = { value: 1 };
  const context = vm.createContext({ original });
  expect(vm.runInContext('original', context)).toBe(original);
  for (const source of ['({value:2})', '[1,2]', 'new Proxy(original,{})']) {
    const value = vm.runInContext(source, context);
    expect(() => structuredClone(value)).toThrow();
    expect(() => serializeNodeIpcMessage({ value }, 'advanced')).toThrow(/could not be cloned/);
  }
  const wire = structuredClone(serializeNodeIpcMessage({ original }, 'advanced'));
  expect(deserializeNodeIpcMessage(wire, 'advanced')).toEqual({ original });
});

for (const source of ['new Map([["x",1]])', 'new Set([1,2])', 'new Date(0)']) {
  it(`retains VM exotic slots through advanced IPC: ${source}`, () => {
    const expected = nativeVm.runInNewContext(source);
    const actual = deserializeNodeIpcMessage(
      structuredClone(serializeNodeIpcMessage(vm.runInNewContext(source), 'advanced')),
      'advanced',
    );
    expect(Object.prototype.toString.call(actual)).toBe(Object.prototype.toString.call(expected));
    if (source.includes('Date')) expect(Date.prototype.getTime.call(actual)).toBe(0);
    else expect(Array.from(actual as Iterable<unknown>)).toEqual(Array.from(expected));
  });
}

it('rejects revoked VM proxies without inspecting them', () => {
  let value: unknown;
  try {
    value = vm.runInNewContext(
      '(() => { const p=Proxy.revocable({},{});p.revoke();return p.proxy;})()',
    );
  } catch (error) {
    throw new Error(String(error));
  }
  expect(() => serializeNodeIpcMessage(value, 'advanced')).toThrow(/could not be cloned/);
});

it('retains individually cloneable VM RegExp and Error slots', () => {
  for (const source of ['/hello/gi', 'new TypeError("broken", {cause: 7})']) {
    const expected = structuredClone(nativeVm.runInNewContext(source));
    const actual = deserializeNodeIpcMessage(
      structuredClone(serializeNodeIpcMessage(vm.runInNewContext(source), 'advanced')),
      'advanced',
    );
    expect(actual).toEqual(expected);
  }
});

it('retains cloneable VM Error cycles and rejects a VM plain-object cause', () => {
  const cycle = vm.runInNewContext(
    `(() => { const error=new Error('cycle'); error.cause=error; return error; })()`,
  );
  const actual = deserializeNodeIpcMessage(
    structuredClone(serializeNodeIpcMessage(cycle, 'advanced')),
    'advanced',
  ) as Error;
  expect(actual.cause).toBe(actual);
  const error = vm.runInNewContext('new Error("x", {cause: {value: 7}})');
  expect(() => serializeNodeIpcMessage(error, 'advanced')).toThrow(/could not be cloned/);
});

for (const target of [
  '{}',
  '[]',
  'new Map()',
  'new Set()',
  'new Date(0)',
  'new Uint8Array([1])',
  'function f() {}',
]) {
  it(`rejects VM Proxy without traps: ${target}`, () => {
    const source = `globalThis.traps=[]; new Proxy((${target}), {get(){traps.push('get');throw 1}, ownKeys(){traps.push('keys');throw 2}, getPrototypeOf(){traps.push('proto');throw 3}})`;
    const context = vm.createContext({});
    const value = vm.runInContext(source, context);
    expect(() => serializeNodeIpcMessage({ value }, 'advanced')).toThrow(/could not be cloned/);
    expect(vm.runInContext('JSON.stringify(traps)', context)).toBe('[]');
  });
}

it('retains cyclic Map/Set identity and ignores guest iterator overrides', () => {
  const source = `(() => {const m=new Map(),s=new Set();m.set('self',m);m.set('set',s);s.add(m);s.add(s);m[Symbol.iterator]=()=>{throw 1};s[Symbol.iterator]=()=>{throw 2};return m;})()`;
  const actual = deserializeNodeIpcMessage(
    structuredClone(serializeNodeIpcMessage(vm.runInNewContext(source), 'advanced')),
    'advanced',
  ) as Map<string, unknown>;
  expect(actual.get('self')).toBe(actual);
  const set = actual.get('set') as Set<unknown>;
  expect(set.has(set)).toBe(true);
  expect(set.has(actual)).toBe(true);
});

it('rejects Proxy data tags without evaluating tag getters or Proxy prototypes', () => {
  for (const target of [
    '{[Symbol.toStringTag]:"Fake"}',
    '{get [Symbol.toStringTag](){throw 1}}',
    'Object.create(new Proxy({},{get(){throw 2},getOwnPropertyDescriptor(){throw 3}}))',
  ]) {
    const source = `new Proxy((${target}),{})`;
    const value = vm.runInNewContext(source);
    expect(() => serializeNodeIpcMessage(value, 'advanced')).toThrow(/could not be cloned/);
  }
});
