import type { ParityCase } from '../../src/types.ts';

/**
 * `Readable.toWeb(r)` hands a Node `Readable` to a Web API as a real
 * `ReadableStream`: the reader yields the source chunks in order, then
 * `{done:true}` at end. Object-mode chunks pass through unchanged. Asserted
 * head-to-head against real Node.
 */
const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    (async () => {
      const r = Readable.from(['a', 'b']);
      const web = Readable.toWeb(r);
      const reader = web.getReader();
      const a = await reader.read();
      const b = await reader.read();
      const end = await reader.read();
      console.log('a:' + a.value + ':' + a.done);
      console.log('b:' + b.value + ':' + b.done);
      console.log('end:' + end.value + ':' + end.done);
    })();
  `,
};

export default c;
