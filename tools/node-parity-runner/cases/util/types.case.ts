import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    // node:util/types is its own builtin specifier (like fs/promises). undici's
    // web/fetch/util.js does require('node:util/types') for isUint8Array; many
    // other deps lean on the broader predicate set. Exercise a faithful slice.
    const types = require('node:util/types');
    const log = (name, v) => console.log(name, types[name](v) ? 1 : 0);

    log('isUint8Array', new Uint8Array(2));
    log('isUint8Array', new Uint16Array(2));
    log('isUint8Array', Buffer.from('x'));
    log('isAnyArrayBuffer', new ArrayBuffer(4));
    log('isAnyArrayBuffer', new SharedArrayBuffer(4));
    log('isArrayBuffer', new ArrayBuffer(4));
    log('isArrayBuffer', new SharedArrayBuffer(4));
    log('isArrayBufferView', new Uint8Array(2));
    log('isArrayBufferView', new DataView(new ArrayBuffer(4)));
    log('isArrayBufferView', new ArrayBuffer(4));
    log('isTypedArray', new Float64Array(1));
    log('isTypedArray', new DataView(new ArrayBuffer(4)));
    log('isDataView', new DataView(new ArrayBuffer(4)));
    log('isFloat32Array', new Float32Array(1));
    log('isFloat64Array', new Float64Array(1));
    log('isInt8Array', new Int8Array(1));
    log('isInt16Array', new Int16Array(1));
    log('isInt32Array', new Int32Array(1));
    log('isUint16Array', new Uint16Array(1));
    log('isUint32Array', new Uint32Array(1));
    log('isUint8ClampedArray', new Uint8ClampedArray(1));
    log('isBigInt64Array', new BigInt64Array(1));
    log('isBigUint64Array', new BigUint64Array(1));
    log('isMap', new Map());
    log('isSet', new Set());
    log('isWeakMap', new WeakMap());
    log('isWeakSet', new WeakSet());
    log('isMapIterator', new Map().entries());
    log('isSetIterator', new Set().values());
    log('isDate', new Date());
    log('isRegExp', /x/);
    log('isPromise', Promise.resolve());
    log('isNativeError', new TypeError('x'));
    log('isNativeError', { message: 'x' });
    log('isGeneratorFunction', function* () {});
    log('isGeneratorFunction', function () {});
    log('isAsyncFunction', async function () {});
    log('isAsyncFunction', function () {});
    log('isBoxedPrimitive', new Number(1));
    log('isBoxedPrimitive', new String('x'));
    log('isBoxedPrimitive', new Boolean(true));
    log('isBoxedPrimitive', 1);
    log('isNumberObject', new Number(1));
    log('isStringObject', new String('x'));
    log('isBooleanObject', new Boolean(true));
    log('isSymbolObject', Object(Symbol('s')));
    log('isArgumentsObject', (function () { return arguments; })());
    log('isGeneratorObject', (function* () {})());

    // node:util re-exports types under the .types property too.
    const util = require('node:util');
    console.log('util.types.isUint8Array', util.types.isUint8Array(new Uint8Array(1)) ? 1 : 0);
  `,
};

export default c;
