import type { ParityCase } from '../../src/types.ts';

// OOB int/float accessors must THROW (RangeError) rather than return garbage —
// the gate the cached-DataView refactor (#13) must preserve. Asserts the error
// constructor name only (Node's ERR_OUT_OF_RANGE code shaping is a separate
// ticket; the cached DataView preserves the throw, not the code).
const c: ParityCase = {
  code: `
    const { Buffer } = require('node:buffer');
    const b = Buffer.alloc(4);
    const probe = (label, fn) => {
      try { fn(); console.log(label + ':NO_THROW'); }
      catch (e) { console.log(label + ':throw:' + e.constructor.name); }
    };
    probe('readUInt32LE@2', () => b.readUInt32LE(2));
    probe('readUInt16BE@3', () => b.readUInt16BE(3));
    probe('readBigUInt64BE@0', () => b.readBigUInt64BE(0));
    probe('readDoubleLE@1', () => b.readDoubleLE(1));
    probe('writeUInt32LE@2', () => b.writeUInt32LE(1, 2));
    probe('readUInt8@4', () => b.readUInt8(4));
  `,
};

export default c;
