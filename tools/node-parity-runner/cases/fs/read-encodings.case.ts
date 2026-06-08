import type { ParityCase } from '../../src/types.ts';

// Guards the text-read decode path (ADR-0082 bytesToString wiring): every
// encoded readFileSync must match Node byte-for-byte, incl. empty, odd-length
// utf16le (trailing byte dropped), latin1 high bytes (>= 0x80), and hex.
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const { Buffer } = require('node:buffer');

    fs.writeFileSync('empty.bin', Buffer.alloc(0));
    fs.writeFileSync('odd.bin', Buffer.from([0x61, 0x00, 0x62]));   // odd len for utf16le
    fs.writeFileSync('even.bin', Buffer.from([0x61, 0x00, 0x62, 0x00]));
    fs.writeFileSync('high.bin', Buffer.from([0x80, 0xff, 0x41, 0xc3]));

    console.log(JSON.stringify(fs.readFileSync('empty.bin', 'utf16le')));
    console.log(JSON.stringify(fs.readFileSync('odd.bin', 'utf16le')));
    console.log(JSON.stringify(fs.readFileSync('even.bin', 'utf16le')));
    console.log(JSON.stringify(fs.readFileSync('high.bin', 'latin1')));
    console.log([...fs.readFileSync('high.bin', 'latin1')].map((c) => c.charCodeAt(0)).join(','));
    console.log(fs.readFileSync('high.bin', 'hex'));
    console.log(JSON.stringify(fs.readFileSync('empty.bin', 'latin1')));
  `,
};

export default c;
