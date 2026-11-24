// internalBinding(name): the C++ pieces these files reach, in JS.
const primordials = require('#primordials');
const { privateSymbols } = require('#symbols');
const tag = (v) => Object.prototype.toString.call(v);
const sabByteLength =
  typeof SharedArrayBuffer === 'function'
    ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength').get
    : undefined;
const abByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const brand = (get) => (v) => {
  if (get === undefined) return false;
  try {
    get.call(v);
    return true;
  } catch {
    return false;
  }
};
const isSharedArrayBuffer = brand(sabByteLength);
const isArrayBuffer = brand(abByteLength);
const bindings = {
  messaging: {
    get DOMException() {
      return require('internal/per_context/domexception').DOMException;
    },
    setDeserializerCreateObjectFunction() {},
    structuredClone() {
      throw new Error('probe: structuredClone not in this port');
    },
  },
  buffer: {
    copyArrayBuffer(dest, destOffset, src, srcOffset, len) {
      new Uint8Array(dest, destOffset, len).set(new Uint8Array(src, srcOffset, len));
    },
  },
  util: {
    constants: { kPending: 0, kFulfilled: 1, kRejected: 2 },
    getPromiseDetails(p) {
      return [primordials.__pendingPromises.has(p) ? 0 : 1];
    },
    privateSymbols,
  },
  constants: { os: { signals: {} } },
  types: {
    isAnyArrayBuffer: (v) => isArrayBuffer(v) || isSharedArrayBuffer(v),
    isArrayBuffer,
    isSharedArrayBuffer,
    isPromise: (v) => tag(v) === '[object Promise]',
    isDate: (v) => v instanceof Date,
    isNativeError: (v) => v instanceof Error,
    isRegExp: (v) => v instanceof RegExp,
    isProxy: () => false,
    isExternal: () => false,
    isBoxedPrimitive: () => false,
  },
};
module.exports = function internalBinding(name) {
  const b = bindings[name];
  if (b === undefined) throw new Error(`probe: internalBinding('${name}') not shimmed`);
  return b;
};
