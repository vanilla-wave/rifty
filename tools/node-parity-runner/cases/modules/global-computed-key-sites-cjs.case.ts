import type { ParityCase } from '../../src/types.ts';

// CJS twin of global-computed-key-sites-esm (ADR-0444) through `global` and
// `globalThis`, plus the object-key coercion order of the operations the
// global-computed-key-writes-cjs case leaves ESM-only (`++`, `Reflect.set`,
// `delete`, a `Symbol.toPrimitive` key yielding a Symbol). Names are prefixed so
// the in-process rifty side leaves the harness global clean.
const c: ParityCase = {
  setup: {
    files: {
      'sites.js': `
        const g = global
        exports.nullish = function (key, value) { return global[key] ??= value }
        exports.or = function (key, value) { return global[key] ||= value }
        exports.and = function (key, value) { return globalThis[key] &&= value }
        exports.preIncrement = function (key) { return ++global[key] }
        exports.decrement = function (key) { return global[key]-- }
        exports.forIn = function (key, object) { for (global[key] in object); }
        exports.objectPattern = function (key, value) { ({ a: global[key] } = { a: value }) }
        exports.defaultPattern = function (key, value) { [globalThis[key] = value] = [] }
        exports.viaAlias = function (key, value) { g[key] = value }
        exports.sequenceKey = function (key, value) { global[(0, key)] = value }
        exports.nested = function (outer, inner, value) { global[global[inner] = outer] = value }
        exports.defineSetter = function (key, setter) { global.__defineSetter__(key, setter) }
        exports.optionalDelete = function (key) { return delete globalThis?.[key] }
        exports.coercion = function () {
          const log = []
          const objectKey = { toString () { log.push('key'); return '__riftyParityCjsSiteObjectKey__' } }
          const rhs = (value) => (log.push('rhs'), value)
          const steps = []
          const step = (name, run) => { log.length = 0; run(); steps.push(name + ':' + log.join(',')) }
          step('nullishSet', () => { global[objectKey] ??= rhs(1) })
          step('nullishSkip', () => { global[objectKey] ??= rhs(2) })
          step('postIncrement', () => { global[objectKey]++ })
          step('reflectSet', () => { Reflect.set(global, objectKey, rhs(3)) })
          step('forOf', () => { for (global[objectKey] of [rhs(4)]); })
          step('alias', () => { g[objectKey] = rhs(5) })
          step('defineSetter', () => { global.__defineSetter__(objectKey, () => {}) })
          step('delete', () => { delete global[objectKey] })
          step('reflectDefine', () => { Reflect.defineProperty(globalThis, objectKey, { value: rhs(6), configurable: true }) })
          step('reflectDelete', () => { Reflect.deleteProperty(globalThis, objectKey) })
          const symbolKey = Symbol.for('rifty-parity:cjs-to-primitive')
          const primitiveKey = { [Symbol.toPrimitive] (hint) { log.push(hint); return symbolKey } }
          step('toPrimitive', () => { global[primitiveKey] = rhs(7) })
          const symbolValue = global[symbolKey]
          delete global[symbolKey]
          return steps.concat(String(symbolValue), String(Object.hasOwn(global, '__riftyParityCjsSiteObjectKey__')))
        }
      `,
    },
  },
  code: `
    const s = require('./sites.js');
    const out = [];
    const key = '__riftyParityCjsSiteKey__';
    out.push(['nullish', s.nullish(key, 1), s.nullish(key, 2)]);
    out.push(['or', s.or(key, 3)]);
    out.push(['and', s.and(key, 4), global[key]]);
    out.push(['update', s.preIncrement(key), s.decrement(key), global[key]]);
    s.forIn(key, { first: 1, last: 2 });
    out.push(['forIn', global[key]]);
    s.objectPattern(key, 'object');
    out.push(['objectPattern', global[key]]);
    s.defaultPattern(key, 'default');
    out.push(['defaultPattern', global[key]]);
    s.viaAlias(key, 'alias');
    out.push(['alias', global[key]]);
    s.sequenceKey(key, 'sequence');
    out.push(['sequence', global[key]]);
    s.nested(key, '__riftyParityCjsSiteInner__', 'nested');
    out.push(['nested', global.__riftyParityCjsSiteInner__, global[key]]);
    let seen;
    s.defineSetter(key, (value) => { seen = value; });
    global[key] = 'set';
    out.push(['setter', seen, typeof Object.getOwnPropertyDescriptor(global, key).set]);
    out.push(['optionalDelete', s.optionalDelete(key), Object.hasOwn(global, key)]);
    out.push(['coercion', ...s.coercion()]);
    delete global.__riftyParityCjsSiteInner__;
    out.push(['clean', Object.hasOwn(global, '__riftyParityCjsSiteInner__')]);
    console.log(JSON.stringify(out));
  `,
};

export default c;
