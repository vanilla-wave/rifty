import type { ParityCase } from '../../src/types.ts';

// Guard: node:stream/consumers text()/json() decode byte chunks with one
// default TextDecoder (strips the first BOM it sees) and append string chunks
// verbatim — unlike Buffer#toString, which keeps the BOM.
const c: ParityCase = {
  code: `
    const { text, json } = require('node:stream/consumers');
    const { Buffer } = require('node:buffer');
    const cps = (s) => s.length + ':' + [...s].map((ch) => ch.codePointAt(0).toString(16)).join(' ');
    const bom = [0xef, 0xbb, 0xbf];
    async function* gen(...chunks) { for (const c of chunks) yield c; }
    (async () => {
      console.log('bytes', cps(await text(gen(Buffer.from([...bom, 0x41])))));
      console.log('split', cps(await text(gen(Buffer.from([0xef]), Buffer.from([0xbb, 0xbf, 0x41])))));
      console.log('string', cps(await text(gen('\\ufeffA'))));
      console.log('after-string', cps(await text(gen('x', Buffer.from([...bom, 0x42])))));
      console.log('json', JSON.stringify(await json(gen(Buffer.from([...bom, 0x7b, 0x7d])))));
      // text() decodes each chunk as it arrives: a producer reusing its buffer
      // after yield does not rewrite already-consumed text.
      async function* reuse() { const b = Buffer.from([...bom, 0x41]); yield b; b[3] = 0x42; yield b; }
      console.log('reused-buffer', cps(await text(reuse())));
    })();
  `,
};

export default c;
