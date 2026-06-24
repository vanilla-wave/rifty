import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const readline = require('node:readline');
    const chunks = [];
    const stream = {
      write(chunk) {
        chunks.push(Buffer.from(String(chunk)).toString('hex'));
        return true;
      },
    };
    const out = [];
    out.push(['cursorToX', readline.cursorTo(stream, 2)]);
    out.push(['cursorToXY', readline.cursorTo(stream, 2, 3)]);
    out.push(['moveCursor', readline.moveCursor(stream, -2, 1)]);
    out.push(['clearLine', readline.clearLine(stream, 0)]);
    out.push(['clearScreenDown', readline.clearScreenDown(stream)]);
    out.push(['chunks', chunks]);
    console.log(JSON.stringify(out));
  `,
};

export default c;
