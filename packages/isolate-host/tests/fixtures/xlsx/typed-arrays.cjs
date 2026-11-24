// node typed-arrays.cjs: exceljs's typed-array closure constructs `new global[name](…)`
// (es-abstract 2025/IsDetachedBuffer, typed-array-length/-byte-offset/-byte-length).
const length = require('typed-array-length');
const byteOffset = require('typed-array-byte-offset');
const byteLength = require('typed-array-byte-length');
const IsDetachedBuffer = require('es-abstract/2025/IsDetachedBuffer');
const slice = require('typedarray.prototype.slice');
const view = new Uint16Array(new ArrayBuffer(16), 2, 3);
const gone = new ArrayBuffer(8);
gone.transfer();
console.log(
  JSON.stringify([
    length(view),
    byteOffset(view),
    byteLength(view),
    IsDetachedBuffer(new ArrayBuffer(0)),
    IsDetachedBuffer(gone),
    Array.from(slice(new Uint8Array([1, 2, 3, 4]), 1, 3)),
  ]),
);
