import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NotImplementedError } from '../../../packages/io/src/errors.ts';
import { setVmEngineOverride } from '../../../packages/runtime-js/src/builtins/vm/engine-config.ts';
import vm from '../../../packages/runtime-js/src/builtins/vm/index.ts';
import { ensureVmEngineReady } from '../../../packages/runtime-js/src/builtins/vm/quickjs-loader.ts';

const intrinsicShapeSource = `
  (() => {
    const descriptorShape = (owner) => Reflect.ownKeys(owner).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      return [
        String(key),
        descriptor.enumerable,
        descriptor.configurable,
        'value' in descriptor ? descriptor.writable : 'accessor',
        'value' in descriptor ? typeof descriptor.value : typeof descriptor.get,
      ];
    });
    const callableShape = (callable) => ({
      name: callable.name,
      length: callable.length,
      source: Function.prototype.toString.call(callable),
      prototypeIsFunctionPrototype: Object.getPrototypeOf(callable) === Function.prototype,
      own: descriptorShape(callable),
    });
    const AsyncFunction = (async function () {}).constructor;
    const GeneratorFunction = (function* () {}).constructor;
    const AsyncGeneratorFunction = (async function* () {}).constructor;
    const wasmCallables = typeof WebAssembly === 'object'
      ? ['Module', 'compile', 'compileStreaming', 'instantiate', 'instantiateStreaming']
          .map((name) => WebAssembly[name])
          .filter((value) => typeof value === 'function')
      : [];
    return JSON.stringify({
      callables: [
        eval,
        Function,
        AsyncFunction,
        GeneratorFunction,
        AsyncGeneratorFunction,
        ...wasmCallables,
      ].map(callableShape),
      constructors: [
        Function.prototype.constructor === Function,
        AsyncFunction.prototype.constructor === AsyncFunction,
        GeneratorFunction.prototype.constructor === GeneratorFunction,
        AsyncGeneratorFunction.prototype.constructor === AsyncGeneratorFunction,
      ],
      constructorPrototypeRelations: [
        Object.getPrototypeOf(Function) === Function.prototype,
        Object.getPrototypeOf(AsyncFunction) === Function,
        Object.getPrototypeOf(GeneratorFunction) === Function,
        Object.getPrototypeOf(AsyncGeneratorFunction) === Function,
      ],
      wasm: typeof WebAssembly === 'object' ? descriptorShape(WebAssembly) : null,
      wasmModule: typeof WebAssembly === 'object' ? descriptorShape(WebAssembly.Module) : null,
      wasmModuleConstructor: typeof WebAssembly === 'object'
        ? WebAssembly.Module.prototype.constructor === WebAssembly.Module
        : null,
    });
  })()
`;

beforeAll(async () => {
  await ensureVmEngineReady();
});

afterEach(() => {
  setVmEngineOverride(undefined);
});

describe('node:vm — webpack magic-comment context options', () => {
  it('uses Node error codes for invalid initial context options', () => {
    const invalidTypes = [
      null,
      [],
      { name: 1 },
      { origin: 1 },
      { codeGeneration: null },
      { codeGeneration: { strings: 'no' } },
      { codeGeneration: { wasm: 'no' } },
    ];
    for (const options of invalidTypes) {
      expect(() => vm.createContext({}, options as never)).toThrow(
        expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }),
      );
    }
    expect(() => vm.createContext({}, { microtaskMode: 'invalid' })).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' }),
    );
  });

  it('reads each context option once in Node order', () => {
    const reads: string[] = [];
    const codeGeneration = {
      get strings() {
        reads.push('strings');
        return false;
      },
      get wasm() {
        reads.push('wasm');
        return false;
      },
    };
    vm.createContext(
      {},
      {
        get name() {
          reads.push('name');
          return 'Webpack Magic Comment Parser';
        },
        get origin() {
          reads.push('origin');
          return undefined;
        },
        get codeGeneration() {
          reads.push('codeGeneration');
          return codeGeneration;
        },
        get microtaskMode() {
          reads.push('microtaskMode');
          return undefined;
        },
      },
    );

    expect(reads).toEqual(['name', 'origin', 'codeGeneration', 'microtaskMode', 'strings', 'wasm']);
  });

  it('accepts Webpack 5.109.2 createContext options and enforces disabled code generation', () => {
    const unrestrictedContext = vm.createContext();
    const context = vm.createContext(undefined, {
      name: 'Webpack Magic Comment Parser',
      codeGeneration: { strings: false, wasm: false },
    });

    expect(vm.isContext(context)).toBe(true);
    expect(vm.runInContext('(function(){return {webpackChunkName: "app"};})()', context)).toEqual({
      webpackChunkName: 'app',
    });
    expect(vm.runInContext(intrinsicShapeSource, context)).toBe(
      vm.runInContext(intrinsicShapeSource, unrestrictedContext),
    );
    expect(() => vm.runInContext('eval("1 + 1")', context)).toThrow(
      /Code generation from strings disallowed for this context/,
    );
    for (const source of [
      'eval()',
      'eval(undefined)',
      'eval(1)',
      'eval({})',
      'eval(new String())',
    ]) {
      expect(() => vm.runInContext(source, context)).toThrow(
        /Code generation from strings disallowed for this context/,
      );
    }
    expect(() => vm.runInContext('Function("return 1")()', context)).toThrow(
      /Code generation from strings disallowed for this context/,
    );
    expect(() => vm.runInContext('new Function("return 1")()', context)).toThrow(
      /Code generation from strings disallowed for this context/,
    );
    expect(() =>
      vm.runInContext('(async function () {}).constructor("return 1")()', context),
    ).toThrow(/Code generation from strings disallowed for this context/);
    expect(() => vm.runInContext('(function* () {}).constructor("return 1")()', context)).toThrow(
      /Code generation from strings disallowed for this context/,
    );
    expect(() =>
      vm.runInContext('(async function* () {}).constructor("return 1")()', context),
    ).toThrow(/Code generation from strings disallowed for this context/);
    for (const source of [
      'Object.getPrototypeOf((async function () {}).constructor)("return 1")()',
      'Object.getPrototypeOf((function* () {}).constructor)("return 1")()',
      'Object.getPrototypeOf((async function* () {}).constructor)("return 1")()',
    ]) {
      expect(() => vm.runInContext(source, context)).toThrow(
        /Code generation from strings disallowed for this context/,
      );
    }
    expect(
      vm.runInContext(
        `[
          Function.name,
          Function.length,
          eval.name,
          eval.length,
          (async function () {}).constructor.name,
          (async function () {}).constructor.length,
          (function* () {}).constructor.name,
          (async function* () {}).constructor.name,
          Function.prototype.constructor === Function
        ].join('|')`,
        context,
      ),
    ).toBe('Function|1|eval|1|AsyncFunction|1|GeneratorFunction|AsyncGeneratorFunction|true');

    const wasmGenerated = vm.runInContext(
      `(() => {
        if (typeof WebAssembly === 'undefined') return false;
        try {
          new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
          return true;
        } catch (error) {
          if (error.name !== 'CompileError') throw error;
          return false;
        }
      })()`,
      context,
    );
    expect(wasmGenerated).toBe(false);
  });

  it('keeps the rewrite engine loud only when a disabled policy cannot be enforced', () => {
    setVmEngineOverride('rewrite');

    expect(() => vm.createContext({}, { name: 'metadata-only' })).not.toThrow();
    expect(() =>
      vm.createContext({}, { codeGeneration: { strings: true, wasm: true } }),
    ).not.toThrow();
    expect(() => vm.createContext({}, { codeGeneration: { strings: false, wasm: true } })).toThrow(
      NotImplementedError,
    );
    expect(() => vm.createContext({}, { codeGeneration: { strings: true, wasm: false } })).toThrow(
      NotImplementedError,
    );
  });

  it('keeps the first contextification policy and ignores later options', () => {
    const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
    const invalidLaterOptions = [
      null,
      { name: 1 },
      { origin: 'https://ignored.test' },
      { microtaskMode: 'invalid' },
      { codeGeneration: null },
      { codeGeneration: { strings: 'no' } },
    ];

    for (const options of invalidLaterOptions) {
      expect(vm.createContext(context, options as never)).toBe(context);
    }
    expect(vm.createContext(context, { codeGeneration: { strings: true, wasm: true } })).toBe(
      context,
    );
    expect(() => vm.runInContext('eval("1 + 1")', context)).toThrow(
      /Code generation from strings disallowed for this context/,
    );

    const firstPolicyAllowsStrings = vm.createContext();
    expect(
      vm.createContext(firstPolicyAllowsStrings, {
        codeGeneration: { strings: false, wasm: false },
      }),
    ).toBe(firstPolicyAllowsStrings);
    expect(vm.runInContext('eval("1 + 1")', firstPolicyAllowsStrings)).toBe(2);
  });
});
