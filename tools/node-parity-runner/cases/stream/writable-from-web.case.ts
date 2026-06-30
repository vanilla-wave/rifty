import type { ParityCase } from '../../src/types.ts';

/**
 * `Writable.fromWeb(ws)`: `w.write('a');w.write('b');w.end('c')` reach the WHATWG
 * sink as write('a'),write('b'),write('c'),close() in order, and `'finish'`
 * fires. Asserted head-to-head against real Node. (Error propagation has its own
 * cases; split so each has one short async tail for the in-process rifty drain.)
 */
const c: ParityCase = {
  code: `
    const { Writable } = require('node:stream');
    (async () => {
      const seen = [];
      const ws = new WritableStream({
        write(chunk) { seen.push('write:' + chunk); },
        close() { seen.push('close'); },
      });
      const w = Writable.fromWeb(ws);
      let finished = false;
      w.on('finish', () => { finished = true; });
      w.write('a'); w.write('b'); w.end('c');
      await new Promise((r) => setTimeout(r, 15));
      console.log('order:' + JSON.stringify(seen));
      console.log('finish:' + finished);
    })();
  `,
};

export default c;
