import { describe, expect, it } from 'vitest';
import '../../../packages/runtime-js/src/builtins/index.ts';
import { loadBuiltin } from '../../../packages/io/src/builtin-registry.ts';
import { NotImplementedError } from '../../../packages/io/src/errors.ts';

type VmScript = {
  runInThisContext(options?: VmRunOptions): unknown;
  runInContext(context: Record<string, unknown>, options?: VmRunOptions): unknown;
  runInNewContext(context?: Record<string, unknown>, options?: VmRunOptions): unknown;
};

type VmRunOptions = {
  cachedData?: Uint8Array;
  displayErrors?: boolean;
  timeout?: number;
  contextExtensions?: object[];
};

type VmContextOptions = {
  name?: string;
};

type VmModule = {
  Script: new (code: string, options?: VmRunOptions) => VmScript;
  compileFunction(
    code: string,
    params?: string[],
    options?: VmRunOptions,
  ): (...args: unknown[]) => unknown;
  createContext<T extends Record<string, unknown>>(sandbox?: T, options?: VmContextOptions): T;
  isContext(value: unknown): boolean;
  runInThisContext(code: string, options?: VmRunOptions): unknown;
  runInContext(code: string, context: Record<string, unknown>, options?: VmRunOptions): unknown;
  runInNewContext(code: string, context?: Record<string, unknown>, options?: VmRunOptions): unknown;
};

const vm = loadBuiltin('node:vm') as unknown as VmModule;

describe('node:vm subset', () => {
  it('runs scripts in this context', () => {
    (
      globalThis as typeof globalThis & { __riftyVmConformanceCount?: number }
    ).__riftyVmConformanceCount = undefined;

    expect(
      vm.runInThisContext(`
        globalThis.__riftyVmConformanceCount = (globalThis.__riftyVmConformanceCount || 0) + 4;
        globalThis.__riftyVmConformanceCount;
      `),
    ).toBe(4);

    const script = new vm.Script(`
      globalThis.__riftyVmConformanceCount += 6;
      globalThis.__riftyVmConformanceCount;
    `);
    expect(script.runInThisContext()).toBe(10);
  });

  it('runs scripts against explicit contexts', () => {
    const sandbox = { count: 1, nested: { label: 'kept' } as { label: string; extra?: number } };

    expect(
      vm.runInNewContext(
        `
          count += 2;
          nested.extra = count;
          count;
        `,
        sandbox,
      ),
    ).toBe(3);
    expect(sandbox).toEqual({ count: 3, nested: { label: 'kept', extra: 3 } });

    const context = vm.createContext({ value: 5 });
    expect(vm.isContext(context)).toBe(true);
    expect(new vm.Script('value *= 3; value;').runInContext(context)).toBe(15);
    expect(context).toMatchObject({ value: 15 });
  });

  it('uses the context object as the script global', () => {
    (globalThis as typeof globalThis & { __riftyVmCreated?: number }).__riftyVmCreated = undefined;
    (globalThis as typeof globalThis & { __riftyVmBlockLeak?: number }).__riftyVmBlockLeak =
      undefined;
    (globalThis as typeof globalThis & { __riftyVmLoopLeak?: number }).__riftyVmLoopLeak =
      undefined;
    const globals: Record<string, unknown> = {};

    expect(
      vm.runInNewContext(
        `
          __riftyVmCreated = 1;
          var declared = 2;
          if (true) __riftyVmBlockLeak = 5;
          for (let i = 0; i < 1; i++) __riftyVmLoopLeak = 6;
          this.viaThis = 3;
          globalThis.viaGlobal = 4;
          ({ __riftyVmCreated, declared, __riftyVmBlockLeak, __riftyVmLoopLeak, viaThis, viaGlobal });
        `,
        globals,
      ),
    ).toEqual({
      __riftyVmCreated: 1,
      declared: 2,
      __riftyVmBlockLeak: 5,
      __riftyVmLoopLeak: 6,
      viaThis: 3,
      viaGlobal: 4,
    });
    expect(globals).toMatchObject({
      __riftyVmCreated: 1,
      declared: 2,
      __riftyVmBlockLeak: 5,
      __riftyVmLoopLeak: 6,
      viaThis: 3,
      viaGlobal: 4,
    });
    expect(
      (globalThis as typeof globalThis & { __riftyVmCreated?: number }).__riftyVmCreated,
    ).toBeUndefined();
    expect(
      (globalThis as typeof globalThis & { __riftyVmBlockLeak?: number }).__riftyVmBlockLeak,
    ).toBeUndefined();
    expect(
      (globalThis as typeof globalThis & { __riftyVmLoopLeak?: number }).__riftyVmLoopLeak,
    ).toBeUndefined();
  });

  it('keeps missing reads loud and function declarations on the context', () => {
    const functions: Record<string, unknown> = {};

    expect(vm.runInNewContext('function f() { return 9; } f();', functions)).toBe(9);
    expect(functions.f).toBeTypeOf('function');
    expect(() => vm.runInNewContext('missing', {})).toThrow(ReferenceError);
  });

  it('compiles functions with parameters', () => {
    const add = vm.compileFunction('return a + b;', ['a', 'b']);
    expect(add(2, 5)).toBe(7);
  });

  it('throws loudly for unsupported execution controls', () => {
    expect(() => vm.runInThisContext('1 + 1', { timeout: 1 })).toThrow(NotImplementedError);
    expect(() => vm.runInThisContext('1 + 1', { cachedData: new Uint8Array() })).toThrow(
      NotImplementedError,
    );
    expect(() => vm.runInThisContext('1 + 1', { displayErrors: false })).toThrow(
      NotImplementedError,
    );
    expect(() => vm.createContext({}, { name: 'sandbox' })).toThrow(NotImplementedError);
    expect(() => vm.compileFunction('return 1;', [], { contextExtensions: [{}] })).toThrow(
      NotImplementedError,
    );
  });

  it('rejects null contexts', () => {
    expect(() => vm.createContext(null as unknown as Record<string, unknown>)).toThrow(TypeError);
    expect(() => vm.runInNewContext('1 + 1', null as unknown as Record<string, unknown>)).toThrow(
      TypeError,
    );
  });
});
