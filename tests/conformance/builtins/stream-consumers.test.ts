import { describe, expect, it } from 'vitest';
import { Buffer } from '../../../packages/runtime-js/src/builtins/buffer.ts';
import { streamConsumers } from '../../../packages/runtime-js/src/builtins/stream.ts';

const { buffer, text, json, arrayBuffer } = streamConsumers;

// `node:stream/consumers` drains a stream / async iterable into a value. opencode
// reaches `buffer` (child stdout, `util/process.ts`) and `text`
// (`cli/cmd/providers.ts`, `lsp/server.ts`). Tested over async iterables (the
// `for await` path) and a web-style `getReader` source (the reader path).
async function* gen(...chunks: unknown[]): AsyncGenerator<unknown> {
  for (const c of chunks) yield c;
}

describe('stream/consumers', () => {
  it('text concatenates string + buffer chunks as utf8', async () => {
    expect(await text(gen('he', Buffer.from('llo'), ' ', Buffer.from('world')))).toBe(
      'hello world',
    );
  });

  it('buffer returns a Buffer of the concatenated bytes', async () => {
    const b = await buffer(gen(Buffer.from('ab'), Buffer.from('cd')));
    expect(Buffer.isBuffer(b)).toBe(true);
    expect(b.toString('utf8')).toBe('abcd');
  });

  it('json parses the concatenated text', async () => {
    expect(await json(gen('{"a":', '1,', '"b":[2,3]}'))).toEqual({ a: 1, b: [2, 3] });
  });

  it('arrayBuffer returns an ArrayBuffer of the bytes', async () => {
    const ab = await arrayBuffer(gen(Buffer.from('xy')));
    expect(ab instanceof ArrayBuffer).toBe(true);
    expect(Buffer.from(ab).toString('utf8')).toBe('xy');
  });

  it('consumes a web-style ReadableStream via getReader', async () => {
    const chunks = [Buffer.from('foo'), Buffer.from('bar')];
    let i = 0;
    const webish = {
      getReader: () => ({
        read: () =>
          Promise.resolve(i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }),
      }),
    };
    expect(await text(webish)).toBe('foobar');
  });
});
