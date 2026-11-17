import type { ParityCase } from '../../src/types.ts';

// readline decodes byte input like Node's StringDecoder: a BOM'd CSV keeps
// U+FEFF on its first line, and a read chunk that happens to start with
// EF BB BF keeps it mid-line (no per-chunk BOM strip). Chunk edges are aligned
// to whole characters (highWaterMark 3) so only the BOM rule is exercised.
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const readline = require('node:readline');
    const { Readable } = require('node:stream');
    const { Buffer } = require('node:buffer');
    const cps = (s) => s.length + ':' + [...s].map((ch) => ch.codePointAt(0).toString(16)).join(' ');
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    fs.writeFileSync('bom.csv', Buffer.concat([bom, Buffer.from('k,v\\na,1\\n')]));
    fs.writeFileSync('mid.txt', Buffer.concat([Buffer.from('a\\nx'), bom, Buffer.from('b\\n')]));
    const lines = (input, label, next) => {
      const out = [];
      const rl = readline.createInterface({ input });
      rl.on('line', (l) => out.push(cps(l)));
      rl.on('close', () => {
        console.log(label, out.join(' | '));
        next();
      });
    };
    lines(fs.createReadStream('bom.csv'), 'file', () =>
      lines(fs.createReadStream('mid.txt', { highWaterMark: 3 }), 'mid-chunk', () => {
        const src = new Readable({ read() {} });
        lines(src, 'readable', () => {});
        src.push(Buffer.concat([bom, Buffer.from('r\\n')]));
        src.push(null);
      }),
    );
  `,
};

export default c;
