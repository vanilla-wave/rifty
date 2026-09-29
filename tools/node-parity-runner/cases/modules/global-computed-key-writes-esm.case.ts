import type { ParityCase } from '../../src/types.ts';

// Computed-key global writes on the vitest 4.1.11 path, one setup module per
// real module (source lines in docs/backlog/runtime-js/reference/
// symbol-key-global-write-guard-precision-evidence.md §Scan). Symbol.for names
// are prefixed and descriptors configurable so the in-process rifty side
// leaves the shared harness global as it found it.
const c: ParityCase = {
  kind: 'esm',
  setup: {
    files: {
      // @vitest/utils/dist/timers.js:1,29 — module-local Symbol() const key.
      'utils-timers.mjs': `
        const SAFE_TIMERS_SYMBOL = Symbol("vitest:SAFE_TIMERS");
        function getSafeTimers() {
          const { setTimeout: safeSetTimeout } = globalThis[SAFE_TIMERS_SYMBOL] || globalThis;
          return { setTimeout: safeSetTimeout };
        }
        function setSafeTimers() {
          const { setTimeout: safeSetTimeout } = globalThis;
          const timers = { setTimeout: safeSetTimeout, tag: "safe" };
          globalThis[SAFE_TIMERS_SYMBOL] = timers;
        }
        export { SAFE_TIMERS_SYMBOL, getSafeTimers, setSafeTimers };
      `,
      // @vitest/expect/dist/index.js:61-64,737-748 — Symbol.for const keys.
      'expect.mjs': `
        const MATCHERS_OBJECT = Symbol.for("rifty-parity:matchers-object");
        const JEST_MATCHERS_OBJECT = Symbol.for("rifty-parity:$$jest-matchers-object");
        const GLOBAL_EXPECT = Symbol.for("rifty-parity:expect-global");
        const ASYMMETRIC_MATCHERS_OBJECT = Symbol.for("rifty-parity:asymmetric-matchers-object");
        if (!Object.hasOwn(globalThis, MATCHERS_OBJECT)) {
          const globalState = new WeakMap();
          const matchers = Object.create(null);
          const customEqualityTesters = [];
          const asymmetricMatchers = Object.create(null);
          Object.defineProperty(globalThis, MATCHERS_OBJECT, { configurable: true, get: () => globalState });
          Object.defineProperty(globalThis, JEST_MATCHERS_OBJECT, {
            configurable: true,
            get: () => ({
              state: globalState.get(globalThis[GLOBAL_EXPECT]),
              matchers,
              customEqualityTesters
            })
          });
          Object.defineProperty(globalThis, ASYMMETRIC_MATCHERS_OBJECT, { configurable: true, get: () => asymmetricMatchers });
        }
        export { MATCHERS_OBJECT, JEST_MATCHERS_OBJECT, GLOBAL_EXPECT, ASYMMETRIC_MATCHERS_OBJECT };
      `,
      // vitest/dist/chunks/test.DNmyFkvJ.js:6,3619-3626,3634-3641,4151-4156 —
      // imported Symbol binding + vi.stubGlobal/unstubAllGlobals parameter keys.
      'test-chunk.mjs': `
        import { GLOBAL_EXPECT } from './expect.mjs';
        const _stubsGlobal = new Map();
        const utils = {
          stubGlobal(name, value) {
            if (!_stubsGlobal.has(name)) _stubsGlobal.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
            Object.defineProperty(globalThis, name, {
              value,
              writable: true,
              configurable: true,
              enumerable: true
            });
            return utils;
          },
          unstubAllGlobals() {
            _stubsGlobal.forEach((original, name) => {
              if (!original) Reflect.deleteProperty(globalThis, name);
              else Object.defineProperty(globalThis, name, original);
            });
            _stubsGlobal.clear();
            return utils;
          }
        };
        const globalExpect = { tag: "globalExpect" };
        Object.defineProperty(globalThis, GLOBAL_EXPECT, {
          value: globalExpect,
          writable: true,
          configurable: true
        });
        export { utils as vi };
      `,
      // vitest/dist/chunks/setup-common.DYx3LtFI.js:31-33 — for-in string keys.
      'setup-common.mjs': `
        function setupDefines(config) {
          for (const key in config.defines) globalThis[key] = config.defines[key];
        }
        export { setupDefines };
      `,
      // Object keys: Node coerces the key once per property access, in its own order.
      'object-keys.mjs': `
        export function objectKeyWrites() {
          const out = [];
          const log = [];
          const objectKey = { toString() { log.push('key'); return '__riftyParityObjectKey__'; } };
          const rhs = (value) => (log.push('rhs'), value);
          globalThis[objectKey] = rhs(1);
          globalThis[objectKey] += rhs(1);
          globalThis[objectKey]++;
          Object.defineProperty(globalThis, objectKey, { get value() { log.push('desc'); return 5; }, configurable: true, writable: true });
          Reflect.set(globalThis, objectKey, rhs(6));
          out.push(['objectKey', log.join(','), globalThis.__riftyParityObjectKey__]);
          log.length = 0;
          delete globalThis[objectKey];
          const symbolKey = Symbol.for('rifty-parity:to-primitive');
          const primitiveKey = { [Symbol.toPrimitive](hint) { log.push(hint); return symbolKey; } };
          globalThis[primitiveKey] = 7;
          out.push(['toPrimitiveKey', log.join(','), globalThis[symbolKey], Object.hasOwn(globalThis, '__riftyParityObjectKey__')]);
          Reflect.deleteProperty(globalThis, symbolKey);
          return out;
        }
      `,
      // Parameter keys on Reflect.deleteProperty (cleanup of the shared harness global).
      'cleanup.mjs': `
        export function removeGlobals(keys) {
          for (const key of keys) Reflect.deleteProperty(globalThis, key);
        }
      `,
    },
  },
  code: `
    import { SAFE_TIMERS_SYMBOL, getSafeTimers, setSafeTimers } from './utils-timers.mjs';
    import { MATCHERS_OBJECT, JEST_MATCHERS_OBJECT, GLOBAL_EXPECT, ASYMMETRIC_MATCHERS_OBJECT } from './expect.mjs';
    import { vi } from './test-chunk.mjs';
    import { setupDefines } from './setup-common.mjs';
    import { objectKeyWrites } from './object-keys.mjs';
    import { removeGlobals } from './cleanup.mjs';
    const out = [];

    setSafeTimers();
    out.push(['safeTimers', getSafeTimers().setTimeout === globalThis.setTimeout, globalThis[SAFE_TIMERS_SYMBOL].tag]);
    out.push(['matchers', globalThis[MATCHERS_OBJECT] instanceof WeakMap, Array.isArray(globalThis[JEST_MATCHERS_OBJECT].customEqualityTesters), typeof globalThis[ASYMMETRIC_MATCHERS_OBJECT]]);
    out.push(['globalExpect', globalThis[GLOBAL_EXPECT].tag]);

    setupDefines({ defines: { __RIFTY_PARITY_DEFINE_A__: 1, __RIFTY_PARITY_DEFINE_B__: 'b' } });
    out.push(['defines', globalThis.__RIFTY_PARITY_DEFINE_A__, globalThis.__RIFTY_PARITY_DEFINE_B__]);

    globalThis.__riftyParityExisting__ = 'original';
    vi.stubGlobal('__riftyParityFresh__', 42).stubGlobal('__riftyParityExisting__', 'stubbed');
    out.push(['stubbed', globalThis.__riftyParityFresh__, globalThis.__riftyParityExisting__, Object.getOwnPropertyDescriptor(globalThis, '__riftyParityFresh__').enumerable]);
    vi.unstubAllGlobals();
    out.push(['unstubbed', Object.hasOwn(globalThis, '__riftyParityFresh__'), globalThis.__riftyParityExisting__]);

    out.push(...objectKeyWrites());
    removeGlobals([SAFE_TIMERS_SYMBOL, MATCHERS_OBJECT, JEST_MATCHERS_OBJECT, GLOBAL_EXPECT, ASYMMETRIC_MATCHERS_OBJECT, '__RIFTY_PARITY_DEFINE_A__', '__RIFTY_PARITY_DEFINE_B__', '__riftyParityExisting__']);
    out.push(['clean', Object.hasOwn(globalThis, GLOBAL_EXPECT), Object.hasOwn(globalThis, '__RIFTY_PARITY_DEFINE_A__')]);
    console.log(JSON.stringify(out));
  `,
};

export default c;
