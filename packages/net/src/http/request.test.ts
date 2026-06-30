/**
 * Tests for `IncomingMessage` and `IncomingMessageFromFetch`.
 *
 * Covers:
 *   - Minimal `req.socket` shape (Item 1 from 2026-05-25 review).
 *   - Streaming body delivery from `request.body` ReadableStream
 *     (Item 4 from 2026-05-25 review / ADR-0017 phase 1 reader-side finish).
 */

import { Readable } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import { IncomingMessage, IncomingMessageFromFetch } from './request.ts';

describe('IncomingMessage.socket — minimal Node-compatible shape', () => {
  it('exposes remoteAddress, localAddress, remotePort, localPort, and destroy()', () => {
    const req = new IncomingMessage(new Request('http://localhost/x'));
    expect(req.socket).toBeDefined();
    expect(req.socket.remoteAddress).toBe('127.0.0.1');
    expect(req.socket.localAddress).toBe('127.0.0.1');
    expect(req.socket.remotePort).toBe(0);
    expect(req.socket.localPort).toBe(0);
    expect(typeof req.socket.destroy).toBe('function');
    // destroy() is a no-op for non-TCP — should not throw.
    expect(() => req.socket.destroy()).not.toThrow();
  });
});

describe('IncomingMessage — streaming body (ADR-0017 phase 1 reader-side)', () => {
  it('delivers a single buffered body chunk to data listeners (existing buffered path)', async () => {
    const req = new IncomingMessage(
      new Request('http://localhost/x', { method: 'POST', body: 'hello' }),
    );
    const chunks: string[] = [];
    const dec = new TextDecoder();
    await new Promise<void>((resolve, reject) => {
      req.on('data', (c) => {
        chunks.push(dec.decode(c as Uint8Array));
      });
      req.on('end', () => resolve());
      req.on('error', reject);
    });
    expect(chunks.join('')).toBe('hello');
  });

  it('delivers a streaming ReadableStream body chunk-by-chunk', async () => {
    // Build a stream that yields 3 chunks across separate microtasks. Each
    // `data` listener invocation should see exactly one chunk — the body must
    // NOT be drained to an ArrayBuffer first and pushed as a single piece.
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk-1'));
        await new Promise<void>((r) => setTimeout(r, 5));
        controller.enqueue(new TextEncoder().encode('chunk-2'));
        await new Promise<void>((r) => setTimeout(r, 5));
        controller.enqueue(new TextEncoder().encode('chunk-3'));
        controller.close();
      },
    });
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      body: stream,
      // Required for Fetch API streaming uploads in Node.
      // @ts-expect-error — Node fetch accepts `duplex`; not yet in lib.d.ts.
      duplex: 'half',
    });
    const req = new IncomingMessage(request);
    const chunks: string[] = [];
    const dec = new TextDecoder();
    await new Promise<void>((resolve, reject) => {
      req.on('data', (c) => {
        chunks.push(dec.decode(c as Uint8Array));
      });
      req.on('end', () => resolve());
      req.on('error', reject);
    });
    expect(chunks).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);
  });

  it('zero-body request fires end with no data', async () => {
    const req = new IncomingMessage(new Request('http://localhost/x'));
    const chunks: Uint8Array[] = [];
    expect(req.complete).toBe(false);
    expect(req.socket.readable).toBe(true);
    await new Promise<void>((resolve) => {
      req.on('data', (c) => chunks.push(c as Uint8Array));
      req.on('end', () => resolve());
    });
    expect(chunks.length).toBe(0);
    expect(req.complete).toBe(true);
    expect(req.socket.readable).toBe(true);
  });

  it('zero-body request marks complete even if nobody attaches body listeners', async () => {
    const req = new IncomingMessage(new Request('http://localhost/x'));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(req.complete).toBe(true);
    expect(req.socket.readable).toBe(true);
  });

  it('zero-body request end is observable by listeners attached after handler return', async () => {
    const req = new IncomingMessage(new Request('http://localhost/x'));
    const chunks: Uint8Array[] = [];

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        req.on('data', (c) => chunks.push(c as Uint8Array));
        req.on('end', () => resolve());
        req.resume();
      }, 0);
    });

    expect(chunks).toEqual([]);
    expect(req.complete).toBe(true);
    expect(req.socket.readable).toBe(true);
  });

  it('zero-body request that is only resume()d (no data/end listener) still reaches EOF', async () => {
    // The canonical "discard an unread body" idiom: resume() with no
    // data/readable/end listener. Node fires 'end' and sets readableEnded;
    // the deferred-EOF path must honour resume(), not only listener attach.
    const req = new IncomingMessage(new Request('http://localhost/x'));
    expect(req.readableEnded).toBe(false);

    req.resume();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(req.readableEnded).toBe(true);
    expect(req.complete).toBe(true);
  });

  it('can be consumed through Readable.toWeb() for node-server adapters', async () => {
    const body = JSON.stringify({ author: 'e2e', text: 'hello from hono' });
    const req = new IncomingMessage(
      new Request('http://preview.local:3321/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );

    await expect(new Response(Readable.toWeb(req)).text()).resolves.toBe(body);
  });
});

// #9 (perf-audit 2026-06-05) + gate G2: headers are computed lazily on first
// read, then materialise into a WRITABLE data property. Express reassigns
// `req.headers = {...}` (trust-proxy/body-parser), so a getter-only accessor
// would break it. These pin the writability + lazy-identity invariants.
describe('IncomingMessage — lazy + writable headers (#9, gate G2)', () => {
  it('synthesizes host and rawHeaders from the request URL', () => {
    const req = new IncomingMessage(new Request('http://preview.local:3320/api/messages'));

    expect(req.headers.host).toBe('preview.local:3320');
    expect(req.rawHeaders).toEqual(['host', 'preview.local:3320']);
  });

  it('materialises headers on first read and includes a Node-style host header', () => {
    const src = new Request('http://localhost/x', { headers: { 'x-a': '1' } });
    const req = new IncomingMessage(src);
    expect(req.headers).toEqual({ ...Object.fromEntries(src.headers), host: 'localhost' });
    expect(req.headers['x-a']).toBe('1');
  });

  it('header identity is stable across reads (computed once, memoised)', () => {
    const req = new IncomingMessage(new Request('http://localhost/x', { headers: { 'x-a': '1' } }));
    const h1 = req.headers;
    const h2 = req.headers;
    expect(h1).toBe(h2);
  });

  it('is reassignable AFTER first read (Express overwrite, read-then-write)', () => {
    const req = new IncomingMessage(new Request('http://localhost/x', { headers: { 'x-a': '1' } }));
    expect(req.headers['x-a']).toBe('1'); // trigger lazy compute
    req.headers = { 'x-b': '2' };
    expect(req.headers).toEqual({ 'x-b': '2' });
  });

  it('is reassignable BEFORE first read (write-before-read path)', () => {
    const req = new IncomingMessage(new Request('http://localhost/x', { headers: { 'x-a': '1' } }));
    req.headers = { injected: 'yes' };
    expect(req.headers).toEqual({ injected: 'yes' });
  });

  it('materialised descriptor is writable+enumerable+configurable', () => {
    const req = new IncomingMessage(new Request('http://localhost/x', { headers: { 'x-a': '1' } }));
    void req.headers; // materialise
    const d = Object.getOwnPropertyDescriptor(req, 'headers');
    expect(d?.writable).toBe(true);
    expect(d?.enumerable).toBe(true);
    expect(d?.configurable).toBe(true);
  });
});

describe('IncomingMessageFromFetch — lazy + writable headers (#9, gate G2)', () => {
  it('materialises headers on first read equal to Object.fromEntries(response.headers)', () => {
    const res = new Response('', { headers: { 'x-a': '1' } });
    const msg = new IncomingMessageFromFetch(res);
    expect(msg.headers).toEqual(Object.fromEntries(res.headers));
  });

  it('is reassignable after first read and before first read', () => {
    const after = new IncomingMessageFromFetch(new Response('', { headers: { 'x-a': '1' } }));
    void after.headers;
    after.headers = { 'x-b': '2' };
    expect(after.headers).toEqual({ 'x-b': '2' });

    const before = new IncomingMessageFromFetch(new Response('', { headers: { 'x-a': '1' } }));
    before.headers = { injected: 'yes' };
    expect(before.headers).toEqual({ injected: 'yes' });
  });
});

describe('IncomingMessageFromFetch — streaming response (ADR-0017 phase 1)', () => {
  it('delivers a streaming response body chunk-by-chunk', async () => {
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('resp-1'));
        await new Promise<void>((r) => setTimeout(r, 5));
        controller.enqueue(new TextEncoder().encode('resp-2'));
        await new Promise<void>((r) => setTimeout(r, 5));
        controller.enqueue(new TextEncoder().encode('resp-3'));
        controller.close();
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
    const msg = new IncomingMessageFromFetch(response);
    const chunks: string[] = [];
    const dec = new TextDecoder();
    await new Promise<void>((resolve, reject) => {
      msg.on('data', (c) => {
        chunks.push(dec.decode(c as Uint8Array));
      });
      msg.on('end', () => resolve());
      msg.on('error', reject);
    });
    expect(chunks).toEqual(['resp-1', 'resp-2', 'resp-3']);
  });
});
