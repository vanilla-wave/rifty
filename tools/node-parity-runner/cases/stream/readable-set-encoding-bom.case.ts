import type { ParityCase } from '../../src/types.ts';

// Readable#setEncoding decodes like Node's StringDecoder: a leading BOM is
// kept (utf8 and utf16le), also when the BOM is split across chunks, on the
// paused read() path and via the constructor \`encoding\` option.
const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    const { Buffer } = require('node:buffer');
    const cps = (s) => s.length + ':' + [...s].map((ch) => ch.codePointAt(0).toString(16)).join(' ');
    const collect = (label, enc, chunks, viaOption) => {
      const src = viaOption ? new Readable({ encoding: enc, read() {} }) : new Readable({ read() {} });
      if (!viaOption) src.setEncoding(enc);
      let out = '';
      src.on('data', (c) => { out += c; });
      src.on('end', () => console.log(label, cps(out)));
      for (const c of chunks) src.push(Buffer.from(c));
      src.push(null);
    };
    collect('utf8', 'utf8', [[0xef, 0xbb, 0xbf, 0x41]]);
    collect('utf8-split', 'utf8', [[0xef], [0xbb], [0xbf, 0x41]]);
    collect('utf8-option', 'utf8', [[0xef, 0xbb, 0xbf, 0x41]], true);
    collect('utf16le', 'utf16le', [[0xff, 0xfe, 0x41, 0x00]]);
    collect('ucs2-split', 'ucs2', [[0xff], [0xfe, 0x41, 0x00]]);
    const paused = new Readable({ read() {} });
    paused.setEncoding('utf8');
    paused.push(Buffer.from([0xef, 0xbb, 0xbf, 0x42]));
    paused.push(null);
    console.log('read', cps(paused.read()));
  `,
};

export default c;
