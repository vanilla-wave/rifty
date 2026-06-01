import type { ParityCase } from '../../src/types.ts';

// node:stream/consumers over an async iterable — byte-for-byte vs Node. The async
// IIFE settles within the runner's post-import drain. opencode uses buffer/text;
// the full set is exercised here.
const c: ParityCase = {
  code: `
    const { text, json, buffer, arrayBuffer } = require('node:stream/consumers');
    const { Buffer } = require('node:buffer');
    async function* gen(...chunks) { for (const c of chunks) yield c; }
    (async () => {
      console.log('text:', await text(gen('he', Buffer.from('llo'), ' world')));
      console.log('buffer:', (await buffer(gen(Buffer.from('ab'), Buffer.from('cd')))).toString());
      console.log('json:', JSON.stringify(await json(gen('{"a":', '1,"b":[2,3]}'))));
      const ab = await arrayBuffer(gen(Buffer.from('xy')));
      console.log('arrayBuffer:', Buffer.from(ab).toString(), ab.byteLength);
    })();
  `,
};

export default c;
