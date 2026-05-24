import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    (async () => {
      const r = Readable.from(['a', 'b', 'c']);
      const out = [];
      for await (const chunk of r) out.push(String(chunk));
      console.log(out.join('-'));
    })();
  `,
};

export default c;
