// internal/util: the members these files use.
const { getOwnPropertyDescriptor } = Object;
const kEmptyObject = Object.freeze({ __proto__: null });
module.exports = {
  customInspectSymbol: Symbol.for('nodejs.util.inspect.custom'),
  kEmptyObject,
  kEnumerableProperty: { __proto__: null, enumerable: true },
  kIsEncodingSymbol: Symbol('kIsEncodingSymbol'),
  SideEffectFreeRegExpPrototypeSymbolReplace: (re, s, r) => s.replace(re, r),
  normalizeEncoding: (e) => (e == null ? 'utf8' : String(e).toLowerCase()),
  lazyDOMException: (m, n) => new (require('internal/per_context/domexception').DOMException)(m, n),
  isError: (e) => e instanceof Error,
  setOwnProperty: (o, k, v) =>
    Object.defineProperty(o, k, { value: v, writable: true, configurable: true, enumerable: true }),
  getLazy(init) {
    let v;
    let done = false;
    return () => {
      if (!done) {
        v = init();
        done = true;
      }
      return v;
    };
  },
  defineLazyProperties() {},
  getOwnPropertyDescriptor,
  // errors.js
  getSystemErrorName: (c) => `Unknown system error ${c}`,
};
