import type { ParityCase } from '../../src/types.ts';

// Exact context options used by Webpack 5.109.2's magic-comment parser.
// Node is the oracle for metadata acceptance, string/Wasm code-generation
// policy, and invalid nested option types.
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const context = vm.createContext(undefined, {
      name: 'Webpack Magic Comment Parser',
      codeGeneration: { strings: false, wasm: false },
    });
    const parsed = vm.runInContext('(function(){return {webpackChunkName: "app"};})()', context);
    console.log(vm.isContext(context), parsed.webpackChunkName);

    const optionReads = [];
    const getterContext = vm.createContext({}, {
      get name() { optionReads.push('name'); return 'getter-context'; },
      get origin() { optionReads.push('origin'); return undefined; },
      get codeGeneration() {
        optionReads.push('codeGeneration');
        return {
          get strings() { optionReads.push('strings'); return false; },
          get wasm() { optionReads.push('wasm'); return false; },
        };
      },
      get microtaskMode() { optionReads.push('microtaskMode'); return undefined; },
    });
    console.log('option-reads', vm.isContext(getterContext), optionReads.join(','));

    const intrinsicShapeSource = \`
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
    \`;
    const unrestricted = vm.createContext();
    console.log(
      'intrinsic-shape',
      vm.runInContext(intrinsicShapeSource, context) ===
        vm.runInContext(intrinsicShapeSource, unrestricted),
    );

    const capture = (fn) => {
      try { fn(); return 'NO THROW'; }
      catch (error) { return error.name + ':' + error.code + ':' + error.message; }
    };
    const captureValue = (fn) => {
      try { return String(fn()); }
      catch (error) { return error.name + ':' + error.message; }
    };
    const repeatResults = [
      null,
      { name: 1 },
      { origin: 'https://ignored.test' },
      { microtaskMode: 'invalid' },
      { codeGeneration: null },
      { codeGeneration: { strings: 'no' } },
      { codeGeneration: { strings: true, wasm: true } },
    ].map((options) => captureValue(() => vm.createContext(context, options) === context));
    console.log('repeat-context', repeatResults.join(','));
    console.log(capture(() => vm.runInContext('eval("1 + 1")', context)));
    console.log(capture(() => vm.runInContext('Function("return 1")()', context)));
    console.log(
      'eval-all-blocked',
      ['eval()', 'eval(undefined)', 'eval(1)', 'eval({})', 'eval(new String())']
        .map((source) => capture(() => vm.runInContext(source, context)).startsWith('EvalError:'))
        .join(','),
    );

    const firstPolicyAllowsStrings = vm.createContext();
    vm.createContext(firstPolicyAllowsStrings, {
      codeGeneration: { strings: false, wasm: false },
    });
    console.log('first-policy', vm.runInContext('eval("1 + 1")', firstPolicyAllowsStrings));

    const wasmGenerated = vm.runInContext(
      \`(() => {
        if (typeof WebAssembly === 'undefined') return false;
        try {
          new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
          return true;
        } catch (error) {
          if (error.name !== 'CompileError') throw error;
          return false;
        }
      })()\`,
      context,
    );
    console.log('wasm-generated', wasmGenerated);

    console.log(capture(() => vm.createContext({}, null)));
    console.log(capture(() => vm.createContext({}, { name: 1 })));
    console.log(capture(() => vm.createContext({}, { origin: 1 })));
    console.log(capture(() => vm.createContext({}, { microtaskMode: 'invalid' })));
    console.log(capture(() => vm.createContext({}, { codeGeneration: null })));
    console.log(capture(() => vm.createContext({}, { codeGeneration: { strings: 'no' } })));
    console.log(capture(() => vm.createContext({}, { codeGeneration: { wasm: 'no' } })));
  `,
};

export default c;
