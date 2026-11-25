// Bindings for Node v24.16.0's lib/internal/encoding.js + encoding/single-byte.js + encoding/util.js
// inside the isolate guest (probe only, not shipped). The generated module (build.mjs) wraps those
// three files verbatim; this file supplies `primordials`, `internalBinding` and the few internal
// modules they require. Engines: the guest's own utf-8 codec (text-codec.ts) for utf-8, @exodus/bytes
// (pure-JS path, loaded on first use) for utf-16le/be and gb18030 (gbk → gb18030 as in Node);
// big5/euc-jp/iso-2022-jp/shift_jis/euc-kr → the named gap at construction.
'use strict';

const ICU_ONLY = new Set(['big5', 'euc-jp', 'iso-2022-jp', 'shift_jis', 'euc-kr']);
const ENGINE = new Set(['utf-16le', 'utf-16be', 'gb18030']);

function makePrimordials() {
  const uncurry =
    (fn) =>
    (self, ...args) =>
      Reflect.apply(fn, self, args);
  const TypedArray = Object.getPrototypeOf(Uint8Array);
  class SafeMap extends Map {}
  class SafeSet extends Set {}
  class SafeArrayIterator {
    constructor(a) {
      this.it = Array.prototype[Symbol.iterator].call(a);
    }
    next() {
      return this.it.next();
    }
    [Symbol.iterator]() {
      return this;
    }
  }
  return {
    __proto__: null,
    Array,
    ArrayPrototypeFill: uncurry(Array.prototype.fill),
    Boolean,
    ObjectDefineProperties: Object.defineProperties,
    ObjectGetOwnPropertyDescriptors: Object.getOwnPropertyDescriptors,
    ObjectKeys: Object.keys,
    ObjectPrototypeHasOwnProperty: uncurry(Object.prototype.hasOwnProperty),
    ObjectSetPrototypeOf: Object.setPrototypeOf,
    ObjectValues: Object.values,
    SafeArrayIterator,
    SafeMap,
    SafeSet,
    StringPrototypeIncludes: uncurry(String.prototype.includes),
    StringPrototypeSlice: uncurry(String.prototype.slice),
    Symbol,
    SymbolToStringTag: Symbol.toStringTag,
    TypedArrayFrom: (ctor, ...a) => Reflect.apply(TypedArray.from, ctor, a),
    TypedArrayOf: (ctor, ...a) => Reflect.apply(TypedArray.of, ctor, a),
    TypedArrayPrototypeIncludes: uncurry(TypedArray.prototype.includes),
    TypedArrayPrototypeSet: uncurry(TypedArray.prototype.set),
    Uint16Array,
    Uint8Array,
  };
}

// --- internal/errors (the codes these files use), Node's message rules ---
const kTypes = [
  'string',
  'function',
  'number',
  'object',
  'Function',
  'Object',
  'boolean',
  'bigint',
  'symbol',
];
function determineSpecificType(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  switch (typeof value) {
    case 'bigint':
      return `type bigint (${value}n)`;
    case 'number':
      if (value === 0)
        return 1 / value === Number.NEGATIVE_INFINITY ? 'type number (-0)' : 'type number (0)';
      return `type number (${value})`;
    case 'boolean':
      return value ? 'type boolean (true)' : 'type boolean (false)';
    case 'symbol':
      return `type symbol (${String(value)})`;
    case 'function':
      return `function ${value.name}`;
    case 'object':
      if (value.constructor && 'name' in value.constructor)
        return `an instance of ${value.constructor.name}`;
      return '[object]';
    default: {
      let s = value;
      if (s.length > 28) s = `${s.slice(0, 25)}...`;
      return s.indexOf("'") === -1 ? `type string ('${s}')` : `type string (${JSON.stringify(s)})`;
    }
  }
}
function invalidArgTypeMessage(name, expected, actual) {
  const list = Array.isArray(expected) ? expected : [expected];
  const types = [];
  const instances = [];
  for (const v of list) {
    if (kTypes.includes(v)) types.push(v.toLowerCase());
    else instances.push(v);
  }
  let msg = `The "${name}" argument must be `;
  if (types.length > 0) {
    msg +=
      types.length > 1
        ? `one of type ${types.slice(0, -1).join(', ')} or ${types.at(-1)}`
        : `of type ${types[0]}`;
    if (instances.length > 0) msg += ' or ';
  }
  if (instances.length > 0) {
    msg +=
      instances.length > 1
        ? `an instance of ${instances.slice(0, -1).join(', ')} or ${instances.at(-1)}`
        : `an instance of ${instances[0]}`;
  }
  return `${msg}. Received ${determineSpecificType(actual)}`;
}
function nodeError(Base, code, message) {
  const err = new Base(message);
  Object.defineProperty(err, 'code', {
    value: code,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(err, 'toString', {
    value() {
      return `${this.name} [${code}]: ${this.message}`;
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
  return err;
}
// Node constructs these with `new` (a function, not an arrow, so `new` works and returns the error).
function ERR_ENCODING_NOT_SUPPORTED(enc) {
  return nodeError(
    RangeError,
    'ERR_ENCODING_NOT_SUPPORTED',
    `The "${enc}" encoding is not supported`,
  );
}
function ERR_ENCODING_INVALID_ENCODED_DATA(enc) {
  return nodeError(
    TypeError,
    'ERR_ENCODING_INVALID_ENCODED_DATA',
    `The encoded data was not valid for encoding ${enc}`,
  );
}
function ERR_INVALID_ARG_TYPE(name, expected, actual) {
  return nodeError(
    TypeError,
    'ERR_INVALID_ARG_TYPE',
    invalidArgTypeMessage(name, expected, actual),
  );
}
function ERR_INVALID_THIS(type) {
  return nodeError(TypeError, 'ERR_INVALID_THIS', `Value of "this" must be of type ${type}`);
}
function ERR_NO_ICU(feature) {
  return nodeError(
    TypeError,
    'ERR_NO_ICU',
    `${feature} is not supported on Node.js compiled without ICU`,
  );
}
const codes = {
  ERR_ENCODING_NOT_SUPPORTED,
  ERR_ENCODING_INVALID_ENCODED_DATA,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_THIS,
  ERR_NO_ICU,
};

// --- internal/buffer FastBuffer (the Buffer members single-byte.js calls) ---
class FastBuffer extends Uint8Array {
  latin1Slice(start = 0, end = this.length) {
    let out = '';
    for (let i = start; i < end; i += 0x8000)
      out += String.fromCharCode.apply(null, this.subarray(i, Math.min(end, i + 0x8000)));
    return out;
  }
  ucs2Slice(start = 0, end = this.length) {
    const u16 = new Uint16Array(this.buffer, this.byteOffset + start, (end - start) >> 1);
    let out = '';
    for (let i = 0; i < u16.length; i += 0x8000)
      out += String.fromCharCode.apply(null, u16.subarray(i, i + 0x8000));
    return out;
  }
  swap16() {
    for (let i = 0; i + 1 < this.length; i += 2) {
      const t = this[i];
      this[i] = this[i + 1];
      this[i + 1] = t;
    }
    return this;
  }
}
const isAscii = (u8) => {
  for (let i = 0; i < u8.length; i++) if (u8[i] > 0x7f) return false;
  return true;
};

const tagGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array).prototype,
  Symbol.toStringTag,
).get;
const isAnyArrayBuffer = (v) =>
  v instanceof ArrayBuffer ||
  (typeof SharedArrayBuffer === 'function' && v instanceof SharedArrayBuffer);
const isUint8Array = (v) =>
  ArrayBuffer.isView(v) && Reflect.apply(tagGetter, v, []) === 'Uint8Array';

function validateString(value, name) {
  if (typeof value !== 'string') throw codes.ERR_INVALID_ARG_TYPE(name, 'string', value);
}
// kValidateObjectAllowObjectsAndNull: null, arrays and functions pass.
function validateObject(value, name) {
  if (value === null) return;
  if (typeof value !== 'object' && typeof value !== 'function')
    throw codes.ERR_INVALID_ARG_TYPE(name, 'Object', value);
}
function getConstructorOf(start) {
  for (let obj = start; obj; obj = Object.getPrototypeOf(obj)) {
    const d = Object.getOwnPropertyDescriptor(obj, 'constructor');
    if (d !== undefined && typeof d.value === 'function' && d.value.name !== '') return d.value;
  }
  return null;
}
const kEnumerableProperty = { __proto__: null };
kEnumerableProperty.enumerable = true;
Object.freeze(kEnumerableProperty);

// Node's C++ bindings validate their own argument, with this plain message (no «Received»):
// `decodeUTF8` names it "list", the ICU `decode` "input".
const bytesOf = (input, name) => {
  if (isAnyArrayBuffer(input)) return new Uint8Array(input);
  if (ArrayBuffer.isView(input))
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw nodeError(
    TypeError,
    'ERR_INVALID_ARG_TYPE',
    `The "${name}" argument must be an instance of SharedArrayBuffer, ArrayBuffer or ArrayBufferView.`,
  );
};

/**
 * @param {object} host the guest's codec and gap: { GuestTextDecoder, GuestTextEncoder, encodeUtf8,
 *   notImplemented, loadExodus: () => ({ TextDecoder }), loadNode: (primordials, internalBinding, map) => require }
 */
module.exports = function makeNodeEncoding(host) {
  const guestEncoder = new host.GuestTextEncoder();
  const encodeIntoResults = new Uint32Array(2);
  let exodus;
  const encodingBinding = {
    encodeIntoResults,
    encodeUtf8String: (s) => {
      const b = host.encodeUtf8(s);
      return new FastBuffer(b.buffer, b.byteOffset, b.byteLength);
    },
    encodeInto: (src, dest) => {
      const { read, written } = guestEncoder.encodeInto(src, dest);
      encodeIntoResults[0] = read;
      encodeIntoResults[1] = written;
    },
    decodeUTF8: (input, ignoreBOM, fatal) => {
      const u8 = bytesOf(input, 'list');
      try {
        // td-lazy-fast: the guest codec's whole-input decode (`utf8-whole.ts.txt`) — Node calls this
        // binding with whole inputs only (it keeps the stream state itself).
        if (host.decodeUtf8Whole)
          return host.decodeUtf8Whole(u8, Boolean(fatal), Boolean(ignoreBOM));
        return new host.GuestTextDecoder('utf-8', { fatal, ignoreBOM }).decode(u8);
      } catch (e) {
        if (e && e.code === 'ERR_ENCODING_INVALID_ENCODED_DATA')
          throw codes.ERR_ENCODING_INVALID_ENCODED_DATA('utf-8');
        throw e;
      }
    },
  };
  const icuBinding = {
    getConverter(enc, flags) {
      if (ICU_ONLY.has(enc))
        throw host.notImplemented(
          `isolate-host.TextDecoder(${enc})`,
          'decoded by ICU in Node, not in the rifty isolate host',
        );
      if (!ENGINE.has(enc)) return undefined;
      exodus ??= host.loadExodus();
      return {
        enc,
        d: new exodus.TextDecoder(enc, { fatal: (flags & 2) !== 0, ignoreBOM: (flags & 4) !== 0 }),
      };
    },
    decode(handle, input, flags, encoding) {
      const u8 = bytesOf(input, 'input');
      try {
        return handle.d.decode(u8, { stream: (flags & 1) === 0 });
      } catch (e) {
        if (e instanceof TypeError) throw codes.ERR_ENCODING_INVALID_ENCODED_DATA(encoding);
        throw e;
      }
    },
  };
  const internalBinding = (name) => {
    if (name === 'config') return { hasIntl: true };
    if (name === 'encoding_binding') return encodingBinding;
    if (name === 'icu') return icuBinding;
    throw new Error(`probe: internalBinding(${name})`);
  };
  const map = {
    'internal/buffer': { FastBuffer },
    buffer: { isAscii },
    'internal/errors': { codes },
    'internal/util': {
      getConstructorOf,
      customInspectSymbol: Symbol.for('nodejs.util.inspect.custom'),
      kEmptyObject: Object.freeze({ __proto__: null }),
      kEnumerableProperty,
    },
    'internal/util/types': {
      isAnyArrayBuffer,
      isArrayBufferView: ArrayBuffer.isView,
      isUint8Array,
    },
    'internal/validators': {
      validateString,
      validateObject,
      kValidateObjectAllowObjectsAndNull: 7,
    },
    'internal/util/inspect': { inspect: (v) => JSON.stringify(v) },
    string_decoder: {},
  };
  const req = host.loadNode(makePrimordials(), internalBinding, map);
  const { TextDecoder, TextEncoder } = req('internal/encoding');
  return { TextDecoder, TextEncoder };
};
