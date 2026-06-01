import type { ParityCase } from '../../src/types.ts';

/**
 * `Readable.setEncoding(encoding)` parity.
 *
 * After `setEncoding('utf8')` the stream must emit decoded STRINGS on `'data'`
 * (not raw `Buffer`s), decode a multi-byte character SPLIT across chunk
 * boundaries correctly (Node uses a streaming `StringDecoder`; rifty a
 * streaming `TextDecoder`), expose `readableEncoding`, and return `this`.
 * Without it, `@effect/platform-node`'s `NodeStream.toString` — which calls
 * `stream.setEncoding('utf8')` before reading a request body — throws, so every
 * opencode POST-with-body route 500s.
 *
 * '€' is `e2 82 ac`; pushed as `[e2 82]` then `[ac]` to force the decoder to
 * carry state across `'data'` events. The accumulated string is what both
 * runtimes must agree on, regardless of how the data events are chunked.
 */
const c: ParityCase = {
  expected: ['returns-this:true', 'encoding:utf8', 'text:€héllo-世界'].join('\n'),
  code: `
    const { Readable } = require('node:stream');
    const src = new Readable({ read() {} });
    const ret = src.setEncoding('utf8');
    console.log('returns-this:' + (ret === src));
    console.log('encoding:' + src.readableEncoding);
    let out = '';
    src.on('data', (c) => { out += c; });
    src.on('end', () => { console.log('text:' + out); });
    src.push(Buffer.from([0xe2, 0x82])); // first half of '€'
    src.push(Buffer.from([0xac]));       // second half of '€'
    src.push(Buffer.from('héllo-世界', 'utf8'));
    src.push(null);
  `,
};

export default c;
