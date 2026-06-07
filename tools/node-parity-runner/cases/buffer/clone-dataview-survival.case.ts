import type { ParityCase } from '../../src/types.ts';

// Guards the per-receiver DataView cache (#13): a subarray produces a NEW
// receiver (distinct Uint8Array) sharing the parent's backing buffer. The
// cache is keyed per receiver, so each gets its own DataView, but both views
// must address the same bytes (subarray shares memory — Node contract). Catches
// any cache mix-up where a child reads/writes through a stale parent view.
const c: ParityCase = {
  code: `
    const { Buffer } = require('node:buffer');
    const b = Buffer.alloc(8);
    b.writeUInt32BE(0xdeadbeef, 0);

    const sub = b.subarray(4, 8); // independent receiver, offset 4 into b's buffer
    sub.writeUInt32BE(0x0000cafe, 0);
    // write through sub at its offset 0 lands at b's byte 4 (shared memory)
    console.log(b.readUInt32BE(0).toString(16), b.readUInt32BE(4).toString(16));
    console.log(sub.readUInt32BE(0).toString(16));

    // a write through the parent at byte 4 is visible through sub at offset 0
    b.writeUInt16BE(0x1234, 4);
    console.log(sub.readUInt16BE(0).toString(16));
  `,
};

export default c;
