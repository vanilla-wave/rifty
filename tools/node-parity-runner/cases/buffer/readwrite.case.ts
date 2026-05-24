import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    // ---- Integer writers/readers (BE vs LE) ----
    const b = Buffer.alloc(8);
    b.writeUInt8(0x12, 0);
    b.writeUInt8(0xff, 1);
    console.log(b.readUInt8(0).toString(16));
    console.log(b.readUInt8(1).toString(16));
    console.log(b.readInt8(1));

    const b16 = Buffer.alloc(2);
    b16.writeUInt16BE(0x1234, 0);
    console.log(b16.readUInt16BE(0).toString(16));
    console.log(b16.readUInt16LE(0).toString(16));

    const b32 = Buffer.alloc(4);
    b32.writeInt32BE(-1, 0);
    console.log(b32.readInt32BE(0));
    console.log(b32.readUInt32BE(0).toString(16));

    const bbe = Buffer.alloc(8);
    bbe.writeBigUInt64BE(0x0123456789abcdefn, 0);
    console.log(bbe.readBigUInt64BE(0).toString(16));
    const ble = Buffer.alloc(8);
    ble.writeBigUInt64LE(0x0123456789abcdefn, 0);
    console.log(ble.readBigUInt64LE(0).toString(16));

    const bneg = Buffer.alloc(8);
    bneg.writeBigInt64BE(-1n, 0);
    console.log(bneg.readBigInt64BE(0).toString());
    console.log(bneg.readBigUInt64BE(0).toString(16));

    // ---- swap16 / swap32 / swap64 ----
    const s16 = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    s16.swap16();
    console.log(Array.from(s16).map((v) => v.toString(16)).join(','));

    const s32 = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    s32.swap32();
    console.log(Array.from(s32).map((v) => v.toString(16)).join(','));

    const s64 = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    s64.swap64();
    console.log(Array.from(s64).map((v) => v.toString(16)).join(','));

    // ---- compare (three orderings + static) ----
    console.log(Buffer.from('abc').compare(Buffer.from('abd')));
    console.log(Buffer.from('abd').compare(Buffer.from('abc')));
    console.log(Buffer.from('abc').compare(Buffer.from('abc')));
    console.log(Buffer.compare(Buffer.from('a'), Buffer.from('b')));
    console.log(Buffer.compare(Buffer.from('b'), Buffer.from('a')));
    console.log(Buffer.compare(Buffer.from('x'), Buffer.from('x')));
  `,
};

export default c;
