import { IncomingMessage } from '@rifty/net';
import { describe, expect, it } from 'vitest';

/**
 * Isolates the express body-parser failure: does `IncomingMessage` actually
 * deliver a POST body via the Readable `'data'`/`'end'` events that body-parser
 * / raw-body consume? (No express, no network — pure @rifty/net.)
 */
describe('IncomingMessage — POST body streaming', () => {
  function collect(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      req.on('data', (c: unknown) => {
        chunks.push(typeof c === 'string' ? new TextEncoder().encode(c) : (c as Uint8Array));
      });
      req.on('end', () => {
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        const out = new Uint8Array(total);
        let o = 0;
        for (const c of chunks) {
          out.set(c, o);
          o += c.byteLength;
        }
        resolve(new TextDecoder().decode(out));
      });
      req.on('error', reject);
    });
  }

  it('emits the JSON body via data/end (listeners attached synchronously)', async () => {
    const req = new IncomingMessage(
      new Request('http://x/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '7' },
        body: '{"a":1}',
      }),
    );
    expect(await collect(req)).toBe('{"a":1}');
  });

  it('still delivers when listeners attach on a later microtask (body-parser timing)', async () => {
    const req = new IncomingMessage(
      new Request('http://x/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '7' },
        body: '{"a":1}',
      }),
    );
    // Defer listener attachment a few microtasks, mimicking the middleware chain.
    await Promise.resolve();
    await Promise.resolve();
    expect(await collect(req)).toBe('{"a":1}');
  });
});
