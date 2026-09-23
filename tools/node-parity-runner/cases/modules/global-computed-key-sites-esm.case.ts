import type { ParityCase } from '../../src/types.ts';

// ADR-0444 write sites beyond the vitest shapes (global-computed-key-writes-esm):
// logical/update/for-in/pattern targets, tracked alias, comma key, nested key,
// `__defineSetter__`, optional-chain `delete`, `yield`/`await`/unparenthesized
// comma keys (top-level `await` = direct factory), with string and object keys,
// plus the exact descriptor a parameter-key `Object.defineProperty` restores.
// Names are prefixed so the in-process rifty side leaves the harness global clean.
const c: ParityCase = {
  kind: 'esm',
  setup: {
    files: {
      'sites.mjs': `
        const g = globalThis;
        export function nullish(key, value) { return globalThis[key] ??= value; }
        export function or(key, value) { return globalThis[key] ||= value; }
        export function and(key, value) { return globalThis[key] &&= value; }
        export function preIncrement(key) { return ++globalThis[key]; }
        export function decrement(key) { return globalThis[key]--; }
        export function forIn(key, object) { for (globalThis[key] in object); }
        export function objectPattern(key, value) { ({ a: globalThis[key] } = { a: value }); }
        export function defaultPattern(key, value) { [globalThis[key] = value] = []; }
        export function viaAlias(key, value) { g[key] = value; }
        export function sequenceKey(key, value) { globalThis[(0, key)] = value; }
        export function nested(outer, inner, value) { globalThis[globalThis[inner] = outer] = value; }
        export function defineSetter(key, setter) { globalThis.__defineSetter__(key, setter); }
        export function optionalDelete(key) { return delete globalThis?.[key]; }
        export function* yieldKey() { globalThis[yield] = yield; }
        export async function awaitKey(key, value) { globalThis[await key] = value; }
        export function bareComma(key, value) { globalThis[0, key] = value; }
        const stubs = new Map();
        export function stubGlobal(name, value) {
          if (!stubs.has(name)) stubs.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
          Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: true });
        }
        export function unstubAllGlobals() {
          stubs.forEach((original, name) => {
            if (!original) Reflect.deleteProperty(globalThis, name);
            else Object.defineProperty(globalThis, name, original);
          });
          stubs.clear();
        }
        export function coercion() {
          const log = [];
          const objectKey = { toString() { log.push('key'); return '__riftyParitySiteObjectKey__'; } };
          const rhs = (value) => (log.push('rhs'), value);
          const steps = [];
          const step = (name, run) => { log.length = 0; run(); steps.push(name + ':' + log.join(',')); };
          step('nullishSet', () => { globalThis[objectKey] ??= rhs(1); });
          step('nullishSkip', () => { globalThis[objectKey] ??= rhs(2); });
          step('and', () => { globalThis[objectKey] &&= rhs(3); });
          step('or', () => { globalThis[objectKey] ||= rhs(4); });
          step('preIncrement', () => { ++globalThis[objectKey]; });
          step('decrement', () => { globalThis[objectKey]--; });
          step('forIn', () => { for (globalThis[objectKey] in { a: 1 }); });
          step('objectPattern', () => { ({ a: globalThis[objectKey] } = { a: rhs(5) }); });
          step('alias', () => { g[objectKey] = rhs(6); });
          step('sequence', () => { globalThis[(0, objectKey)] = rhs(7); });
          step('defineSetter', () => { globalThis.__defineSetter__(objectKey, () => {}); });
          step('optionalDelete', () => { delete globalThis?.[objectKey]; });
          return steps.concat(String(Object.hasOwn(globalThis, '__riftyParitySiteObjectKey__')));
        }
      `,
    },
  },
  code: `
    import * as s from './sites.mjs';
    const out = [];
    const key = '__riftyParitySiteKey__';
    out.push(['nullish', s.nullish(key, 1), s.nullish(key, 2)]);
    out.push(['or', s.or(key, 3)]);
    out.push(['and', s.and(key, 4), globalThis[key]]);
    out.push(['update', s.preIncrement(key), s.decrement(key), globalThis[key]]);
    s.forIn(key, { first: 1, last: 2 });
    out.push(['forIn', globalThis[key]]);
    s.objectPattern(key, 'object');
    out.push(['objectPattern', globalThis[key]]);
    s.defaultPattern(key, 'default');
    out.push(['defaultPattern', globalThis[key]]);
    s.viaAlias(key, 'alias');
    out.push(['alias', globalThis[key]]);
    s.sequenceKey(key, 'sequence');
    out.push(['sequence', globalThis[key]]);
    s.nested(key, '__riftyParitySiteInner__', 'nested');
    out.push(['nested', globalThis.__riftyParitySiteInner__, globalThis[key]]);
    let seen;
    s.defineSetter(key, (value) => { seen = value; });
    globalThis[key] = 'set';
    out.push(['setter', seen, typeof Object.getOwnPropertyDescriptor(globalThis, key).set]);
    out.push(['optionalDelete', s.optionalDelete(key), Object.hasOwn(globalThis, key)]);
    const generator = s.yieldKey();
    generator.next();
    generator.next(key);
    generator.next('yield');
    out.push(['yield', globalThis[key]]);
    await s.awaitKey(Promise.resolve(key), 'await');
    out.push(['await', globalThis[key]]);
    s.bareComma(key, 'comma');
    out.push(['comma', globalThis[key]]);
    globalThis[await Promise.resolve(key)] = 'topLevelAwait';
    out.push(['topLevelAwait', globalThis[key], delete globalThis[key]]);
    out.push(['coercion', ...s.coercion()]);

    const existing = '__riftyParitySiteExisting__';
    Object.defineProperty(globalThis, existing, { value: 'original', writable: false, enumerable: false, configurable: true });
    s.stubGlobal(existing, 'stubbed');
    s.stubGlobal('__riftyParitySiteFresh__', 'fresh');
    const stubbed = Object.getOwnPropertyDescriptor(globalThis, existing);
    s.unstubAllGlobals();
    out.push(['restore', stubbed, Object.getOwnPropertyDescriptor(globalThis, existing), Object.hasOwn(globalThis, '__riftyParitySiteFresh__')]);

    delete globalThis[existing];
    delete globalThis.__riftyParitySiteInner__;
    out.push(['clean', Object.hasOwn(globalThis, existing), Object.hasOwn(globalThis, '__riftyParitySiteInner__')]);
    console.log(JSON.stringify(out));
  `,
};

export default c;
