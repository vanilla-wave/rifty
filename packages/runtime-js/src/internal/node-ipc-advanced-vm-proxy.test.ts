import { serialize } from 'node:v8';
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

it('rejects guest-created vm Proxy while preserving ordinary wrappers and host origins', () => {
  const original = { value: 1 };
  const context = vm.createContext({ original });
  expect(vm.runInContext('original', context)).toBe(original);
  const plain = vm.runInContext('({value:2})', context);
  const guestProxy = vm.runInContext('new Proxy(original,{})', context);
  const nativeProxy = nativeVm.runInNewContext('new Proxy(original,{})', { original });
  let nativeError: unknown;
  try {
    serialize({ value: nativeProxy });
  } catch (error) {
    nativeError = error;
  }
  expect(nativeError).toBeInstanceOf(Error);
  expect(() => serializeNodeIpcMessage({ value: guestProxy }, 'advanced')).toThrow(
    (nativeError as Error).message,
  );
  const wire = structuredClone(serializeNodeIpcMessage({ plain, original }, 'advanced'));
  expect(deserializeNodeIpcMessage(wire, 'advanced')).toEqual({ plain: { value: 2 }, original });
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
  expect(() => serializeNodeIpcMessage(value, 'advanced')).toThrow('null could not be cloned.');
});

it('retains VM RegExp and Error slots through advanced IPC', () => {
  const source = '({ regexp: /hello/gi, error: new TypeError("broken", {cause: {value: 7}}) })';
  const expected = nativeVm.runInNewContext(source);
  const actual = deserializeNodeIpcMessage(
    structuredClone(serializeNodeIpcMessage(vm.runInNewContext(source), 'advanced')),
    'advanced',
  ) as { regexp: RegExp; error: Error };
  expect(actual.regexp).toBeInstanceOf(RegExp);
  expect([actual.regexp.source, actual.regexp.flags]).toEqual([
    expected.regexp.source,
    expected.regexp.flags,
  ]);
  expect(actual.error).toBeInstanceOf(TypeError);
  expect([actual.error.name, actual.error.message, actual.error.cause]).toEqual([
    expected.error.name,
    expected.error.message,
    expected.error.cause,
  ]);
});

it('retains VM Error cause cycles and aliases without reading cause accessors', () => {
  const source = `(() => { const shared={value:7},error=new Error('x',{cause:shared}),cycle=new Error('cycle'); cycle.cause=cycle; const accessor=new Error('accessor'); Object.defineProperty(accessor,'cause',{get(){throw new Error('cause getter ran')}}); return {shared,error,cycle,accessor}; })()`;
  const actual = deserializeNodeIpcMessage(
    structuredClone(serializeNodeIpcMessage(vm.runInNewContext(source), 'advanced')),
    'advanced',
  ) as { shared: object; error: Error; cycle: Error; accessor: Error };
  expect(actual.error.cause).toBe(actual.shared);
  expect(actual.cycle.cause).toBe(actual.cycle);
  expect(Object.hasOwn(actual.accessor, 'cause')).toBe(false);
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
    let expected = '';
    try {
      serialize({ value: nativeVm.runInNewContext(source) });
    } catch (error) {
      expected = (error as Error).message;
    }
    expect(() => serializeNodeIpcMessage({ value }, 'advanced')).toThrow(expected);
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

it('formats Proxy data tags without evaluating tag getters or Proxy prototypes', () => {
  for (const target of [
    '{[Symbol.toStringTag]:"Fake"}',
    '{get [Symbol.toStringTag](){throw 1}}',
    'Object.create(new Proxy({},{get(){throw 2},getOwnPropertyDescriptor(){throw 3}}))',
  ]) {
    const source = `new Proxy((${target}),{})`;
    let expected = '';
    try {
      serialize(nativeVm.runInNewContext(source));
    } catch (error) {
      expected = (error as Error).message;
    }
    const value = vm.runInNewContext(source);
    expect(() => serializeNodeIpcMessage(value, 'advanced')).toThrow(expected);
  }
});
