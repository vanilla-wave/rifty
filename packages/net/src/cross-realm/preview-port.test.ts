/**
 * Tests for the cross-realm preview-port bridge (ADR-0043).
 *
 * Both ends run in the same Node realm but talk over `BroadcastChannel`, the
 * same primitive the playground uses in production to cross page ↔ worker. A
 * single-realm `BroadcastChannel` distributes messages to other listeners on
 * the same channel name within the same JS realm too, which is exactly what
 * we need to drive both ends from one Vitest worker.
 *
 * Coverage:
 *   1. Round-trip — page-side dispatch reaches the worker handler and the
 *      response surfaces back as a `Response`.
 *   2. POST body bytes survive the hop.
 *   3. Worker handler throw → page-side sees a 502 with the message.
 *   4. No worker listening → page-side dispatch times out as a 502 within
 *      the configured `timeoutMs`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { channelNameFor } from '../ws/bridge.ts';
import {
  type CrossRealmPortHandler,
  PREVIEW_PORT_FRAME_VERSION,
  bridgeCrossRealmPreview,
  dispatchCrossRealmLoopback,
  previewPortChannelUrl,
  serveCrossRealmPreview,
} from './preview-port.ts';

interface Cleanup {
  add(teardown: () => void): void;
  runAll(): void;
}

function makeCleanup(): Cleanup {
  const teardowns: (() => void)[] = [];
  return {
    add(teardown) {
      teardowns.push(teardown);
    },
    runAll() {
      for (const t of teardowns.splice(0).reverse()) {
        try {
          t();
        } catch {
          /* best effort */
        }
      }
    },
  };
}

const cleanup = makeCleanup();
afterEach(() => cleanup.runAll());

describe('previewPortChannelUrl', () => {
  it('embeds the dev-server port number deterministically', () => {
    expect(previewPortChannelUrl(5174)).toContain('5174');
    expect(previewPortChannelUrl(3000)).toContain('3000');
    expect(previewPortChannelUrl(5174)).not.toEqual(previewPortChannelUrl(3000));
  });

  it('is a parseable URL so `channelNameFor` works on it', () => {
    expect(() => new URL(previewPortChannelUrl(7000))).not.toThrow();
  });
});

describe('cross-realm preview — text/html WS bridge injection (ADR-0189)', () => {
  it('injects the marker-guarded bridge script into text/html responses (content-length honest)', async () => {
    const html = '<!doctype html><html><head></head><body>app</body></html>';
    const bytes = new TextEncoder().encode(html);
    cleanup.add(
      serveCrossRealmPreview(5111, async () => {
        return new Response(bytes, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-length': String(bytes.byteLength),
          },
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5111);
    cleanup.add(handler.dispose);

    const response = await handler(new Request('http://preview.local/'));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('<script data-rifty-ws-bridge>');
    expect(body).toContain('__riftyWebSocketBridgeInstalled');
    expect(body).toContain('<body>app</body>');
    expect(Number(response.headers.get('content-length'))).toBe(
      new TextEncoder().encode(body).byteLength,
    );
  });

  it('leaves non-HTML responses byte-identical', async () => {
    const payload = JSON.stringify({ rows: [1, 2, 3] });
    cleanup.add(
      serveCrossRealmPreview(5112, async () => {
        return new Response(payload, {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5112);
    cleanup.add(handler.dispose);

    const response = await handler(new Request('http://preview.local/api'));
    expect(await response.text()).toBe(payload);
  });

  it('decompresses gzip html, injects, and re-serves identity (content-length honest)', async () => {
    const html = '<!doctype html><html><head></head><body>zipped</body></html>';
    const gzipped = await compressBytes(new TextEncoder().encode(html), 'gzip');
    cleanup.add(
      serveCrossRealmPreview(5114, async () => {
        return new Response(gzipped, {
          status: 200,
          headers: {
            'content-type': 'text/html',
            'content-encoding': 'gzip',
            'content-length': String(gzipped.byteLength),
          },
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5114);
    cleanup.add(handler.dispose);

    const response = await handler(new Request('http://preview.local/'));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('<script data-rifty-ws-bridge>');
    expect(body).toContain('<body>zipped</body>');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(Number(response.headers.get('content-length'))).toBe(
      new TextEncoder().encode(body).byteLength,
    );
  });

  it('refuses html with an undecodable content-encoding LOUD (no silent uninjected pass)', async () => {
    cleanup.add(
      serveCrossRealmPreview(5115, async () => {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'text/html', 'content-encoding': 'br' },
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5115);
    cleanup.add(handler.dispose);

    const response = await handler(new Request('http://preview.local/'));
    expect(response.status).toBe(502);
    expect(await response.text()).toContain('content-encoding');
  });

  it('leaves content-encoded non-HTML byte-identical', async () => {
    const compressedish = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02]);
    cleanup.add(
      serveCrossRealmPreview(5116, async () => {
        return new Response(compressedish, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip' },
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5116);
    cleanup.add(handler.dispose);

    const response = await handler(new Request('http://preview.local/'));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(compressedish);
  });

  it('does not double-inject an already-marked document', async () => {
    const html = '<html><head><script data-rifty-ws-bridge>/* here */</script></head></html>';
    cleanup.add(
      serveCrossRealmPreview(5113, async () => {
        return new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5113);
    cleanup.add(handler.dispose);

    const response = await handler(new Request('http://preview.local/'));
    expect(await response.text()).toBe(html);
  });
});

describe('cross-realm preview port — happy path', () => {
  it('round-trips a GET → Response across the BroadcastChannel hop', async () => {
    cleanup.add(
      serveCrossRealmPreview(5101, async (req) => {
        expect(req.method).toBe('GET');
        expect(new URL(req.url).pathname).toBe('/hello');
        return new Response('worker-was-here', {
          status: 200,
          headers: { 'X-From': 'worker' },
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5101);
    cleanup.add(handler.dispose);

    const response = await handler(new Request('http://preview.local/hello'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-from')).toBe('worker');
    expect(await response.text()).toBe('worker-was-here');
  });

  it('preserves POST body bytes (4 KiB) across the hop', async () => {
    const payload = new Uint8Array(4096);
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;

    cleanup.add(
      serveCrossRealmPreview(5102, async (req) => {
        const body = new Uint8Array(await req.arrayBuffer());
        // Echo with checksum so we can assert byte-for-byte.
        let sum = 0;
        for (const b of body) sum = (sum + b) & 0xff;
        return new Response(JSON.stringify({ length: body.length, checksum: sum }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5102);
    cleanup.add(handler.dispose);

    const response = await handler(
      new Request('http://preview.local/echo', { method: 'POST', body: payload }),
    );
    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { length: number; checksum: number };
    expect(parsed.length).toBe(4096);
    let expectedSum = 0;
    for (const b of payload) expectedSum = (expectedSum + b) & 0xff;
    expect(parsed.checksum).toBe(expectedSum);
  });

  it('does not forward browser-managed accept-encoding into the worker Request', async () => {
    cleanup.add(
      serveCrossRealmPreview(5105, async (req) => {
        return Response.json({
          acceptEncoding: req.headers.get('accept-encoding'),
          xTrace: req.headers.get('x-trace'),
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5105);
    cleanup.add(handler.dispose);

    const response = await handler.dispatchStruct({
      url: 'http://preview.local/headers',
      method: 'GET',
      headers: { 'accept-encoding': 'gzip, br', 'x-trace': 'kept' },
      body: null,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ acceptEncoding: null, xTrace: 'kept' });
  });
});

describe('cross-realm preview port — error paths', () => {
  it('surfaces a worker-side throw as a 502 carrying the message', async () => {
    cleanup.add(
      serveCrossRealmPreview(5103, async () => {
        throw new Error('worker-blew-up');
      }),
    );
    const handler = bridgeCrossRealmPreview(5103);
    cleanup.add(handler.dispose);

    const response = await handler(new Request('http://preview.local/'));
    expect(response.status).toBe(502);
    expect(await response.text()).toContain('worker-blew-up');
  });

  it('times out with a 502 when no worker is listening', async () => {
    const handler = bridgeCrossRealmPreview(5104, { timeoutMs: 50 });
    cleanup.add(handler.dispose);

    const started = Date.now();
    const response = await handler(new Request('http://preview.local/'));
    const elapsed = Date.now() - started;
    expect(response.status).toBe(502);
    // Allow a generous upper bound to cover CI jitter without making the
    // test brittle, but verify we're actually using the configured timeout.
    expect(elapsed).toBeLessThan(2000);
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});

// ─── ADR-0086: optional dispatchStruct fast-path ─────────────────────────────
// The page-side bridge exposes an OPTIONAL `dispatchStruct({url,method,headers,
// body})` that skips the page→worker Request rebuild + arrayBuffer() drain. It
// must be byte-identical to the public `handler(Request)` path.

describe('cross-realm preview port — ADR-0086 dispatchStruct fast-path', () => {
  it('dispatchStruct is byte-identical to handler(Request) for a POST body', async () => {
    const payload = new Uint8Array(4096);
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;

    cleanup.add(
      serveCrossRealmPreview(5301, async (req) => {
        const body = new Uint8Array(await req.arrayBuffer());
        let sum = 0;
        for (const b of body) sum = (sum + b) & 0xff;
        return new Response(JSON.stringify({ length: body.length, checksum: sum }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5301);
    cleanup.add(handler.dispose);

    const response = await handler.dispatchStruct({
      url: 'http://preview.local/echo',
      method: 'POST',
      headers: {},
      body: payload,
    });
    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { length: number; checksum: number };
    expect(parsed.length).toBe(4096);
    let expectedSum = 0;
    for (const b of payload) expectedSum = (expectedSum + b) & 0xff;
    expect(parsed.checksum).toBe(expectedSum);
  });

  it('dispatchStruct GET round-trip (null body, no arrayBuffer drain)', async () => {
    cleanup.add(
      serveCrossRealmPreview(5302, async (req) => {
        expect(req.method).toBe('GET');
        expect(new URL(req.url).pathname).toBe('/hello');
        return new Response('worker-was-here', { status: 200, headers: { 'X-From': 'worker' } });
      }),
    );
    const handler = bridgeCrossRealmPreview(5302);
    cleanup.add(handler.dispose);

    const response = await handler.dispatchStruct({
      url: 'http://preview.local/hello',
      method: 'GET',
      headers: {},
      body: null,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-from')).toBe('worker');
    expect(await response.text()).toBe('worker-was-here');
  });

  it('dispatchStruct ignores stale responders from a different preview scope', async () => {
    cleanup.add(
      serveCrossRealmPreview(5305, async () => new Response('stale-worker', { status: 200 }), {
        scope: 'old-run',
      }),
    );
    cleanup.add(
      serveCrossRealmPreview(5305, async () => new Response('current-worker', { status: 200 }), {
        scope: 'current-run',
      }),
    );
    const handler = bridgeCrossRealmPreview(5305, { scope: 'current-run', timeoutMs: 500 });
    cleanup.add(handler.dispose);

    const response = await handler.dispatchStruct({
      url: 'http://preview.local/hello',
      method: 'GET',
      headers: {},
      body: null,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('current-worker');
  });

  it('dispatchStruct ignores unscoped stale responders for scoped requests', async () => {
    cleanup.add(
      serveCrossRealmPreview(
        5306,
        async () => new Response('unscoped-stale-worker', { status: 200 }),
      ),
    );
    cleanup.add(
      serveCrossRealmPreview(
        5306,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return new Response('current-worker', { status: 200 });
        },
        { scope: 'current-run' },
      ),
    );
    const handler = bridgeCrossRealmPreview(5306, { scope: 'current-run', timeoutMs: 500 });
    cleanup.add(handler.dispose);

    const response = await handler.dispatchStruct({
      url: 'http://preview.local/hello',
      method: 'GET',
      headers: {},
      body: null,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('current-worker');
  });

  it('live loopback reaches a scoped port owner without page-preview scope', async () => {
    cleanup.add(
      serveCrossRealmPreview(5307, async () => new Response('live-owner', { status: 200 }), {
        scope: 'api-run',
      }),
    );

    const response = await dispatchCrossRealmLoopback(
      5307,
      {
        url: 'http://localhost:5307/users',
        method: 'GET',
        headers: {},
        body: null,
      },
      { probeTimeoutMs: 500 },
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe('live-owner');
  });

  it('dispatchStruct after dispose → 502', async () => {
    const handler = bridgeCrossRealmPreview(5303);
    handler.dispose();
    const response = await handler.dispatchStruct({
      url: 'http://preview.local/',
      method: 'GET',
      headers: {},
      body: null,
    });
    expect(response.status).toBe(502);
    expect(await response.text()).toContain('disposed');
  });

  it('dispatchStruct drops a GET/HEAD body (parity with the Request path)', async () => {
    let observedBody = -1;
    cleanup.add(
      rawWorker(5304, (req, ch) => {
        observedBody = req.body === null ? 0 : req.body.byteLength;
        ch.postMessage({
          type: 'reply',
          v: '2',
          requestId: req.requestId,
          status: 200,
          statusText: 'OK',
          headers: {},
          body: null,
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5304, { timeoutMs: 500 });
    cleanup.add(handler.dispose);

    const response = await handler.dispatchStruct({
      url: 'http://preview.local/',
      method: 'GET',
      headers: {},
      body: new Uint8Array([1, 2, 3]),
    });
    expect(response.status).toBe(200);
    expect(observedBody).toBe(0); // GET body dropped — frame.body === null
  });
});

// ─── ADR-0048: streaming wire-frame ──────────────────────────────────────────
// A "raw worker" posts frames directly so tests can drive exact wire sequences
// (version mismatch, seq gaps, idle timing) the real `serveCrossRealmPreview`
// would never emit. Both ends share one Node realm over `BroadcastChannel`.

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// biome-ignore lint/suspicious/noExplicitAny: raw wire frames, deliberately untyped.
type RawFrame = any;
function rawWorker(
  port: number,
  onRequest: (frame: RawFrame, channel: BroadcastChannel) => void | Promise<void>,
): () => void {
  const channel = new BroadcastChannel(channelNameFor(previewPortChannelUrl(port)));
  const listener = (e: MessageEvent): void => {
    const f = e.data as RawFrame;
    if (f?.type === 'request') void onRequest(f, channel);
  };
  channel.addEventListener('message', listener as unknown as EventListener);
  return () => {
    channel.removeEventListener('message', listener as unknown as EventListener);
    channel.close();
  };
}

describe('cross-realm preview port — ADR-0048 streaming', () => {
  it('streams a large body (5×64 KiB) and reassembles byte-for-byte', async () => {
    const CHUNKS = 5;
    const SIZE = 64 * 1024;
    cleanup.add(
      serveCrossRealmPreview(5201, async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            for (let i = 0; i < CHUNKS; i++) {
              const buf = new Uint8Array(SIZE);
              buf.fill((i + 1) & 0xff);
              c.enqueue(buf);
            }
            c.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream', 'X-Big': 'yes' },
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5201);
    cleanup.add(handler.dispose);

    const res = await handler(new Request('http://preview.local/big'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-big')).toBe('yes');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBe(CHUNKS * SIZE);
    // Each 64 KiB block was filled with its (1-based) index — verify boundaries.
    expect(bytes[0]).toBe(1);
    expect(bytes[SIZE]).toBe(2);
    expect(bytes[(CHUNKS - 1) * SIZE]).toBe(CHUNKS);
  });

  it('zero-chunk streamed body resolves an empty 200 (start + end(seq=0))', async () => {
    cleanup.add(
      serveCrossRealmPreview(5208, async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.close(); // immediately-empty stream — never enqueues
          },
        });
        return new Response(stream, { status: 200, headers: { 'X-Empty': '1' } });
      }),
    );
    const handler = bridgeCrossRealmPreview(5208);
    cleanup.add(handler.dispose);
    const res = await handler(new Request('http://preview.local/empty'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-empty')).toBe('1');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('error mid-stream → 502 with the message; channel recovers for the next request', async () => {
    let n = 0;
    cleanup.add(
      rawWorker(5202, (req, ch) => {
        const id = req.requestId;
        if (n++ === 0) {
          ch.postMessage({
            type: 'reply-stream-start',
            v: '2',
            requestId: id,
            status: 200,
            statusText: 'OK',
            headers: {},
          });
          ch.postMessage({
            type: 'reply-stream-chunk',
            v: '2',
            requestId: id,
            seq: 0,
            data: new Uint8Array([65]),
          });
          ch.postMessage({
            type: 'reply-stream-chunk',
            v: '2',
            requestId: id,
            seq: 1,
            data: new Uint8Array([66]),
          });
          ch.postMessage({
            type: 'reply-stream-error',
            v: '2',
            requestId: id,
            seq: 2,
            message: 'mid-stream-boom',
          });
        } else {
          ch.postMessage({
            type: 'reply',
            v: '2',
            requestId: id,
            status: 200,
            statusText: 'OK',
            headers: {},
            body: new Uint8Array([79, 75]),
          });
        }
      }),
    );
    const handler = bridgeCrossRealmPreview(5202, { timeoutMs: 500 });
    cleanup.add(handler.dispose);

    const r1 = await handler(new Request('http://preview.local/a'));
    expect(r1.status).toBe(502);
    expect(await r1.text()).toContain('mid-stream-boom');
    // Recovery proves the errored request didn't leak its pending/accumulator.
    const r2 = await handler(new Request('http://preview.local/b'));
    expect(r2.status).toBe(200);
    expect(await r2.text()).toBe('OK');
  });

  it('version-mismatch on reply-stream-start → 503 + console.error(expected,got)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    cleanup.add(() => spy.mockRestore());
    cleanup.add(
      rawWorker(5203, (req, ch) => {
        ch.postMessage({
          type: 'reply-stream-start',
          v: '999',
          requestId: req.requestId,
          status: 200,
          statusText: 'OK',
          headers: {},
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5203, { timeoutMs: 500 });
    cleanup.add(handler.dispose);

    const r = await handler(new Request('http://preview.local/'));
    expect(r.status).toBe(503);
    expect(spy).toHaveBeenCalledWith(
      '[rifty/net] preview-port frame version mismatch',
      expect.objectContaining({ expected: PREVIEW_PORT_FRAME_VERSION, got: '999' }),
    );
  });

  it('idle timer re-arms per chunk — a slow live stream does NOT time out', async () => {
    cleanup.add(
      rawWorker(5204, async (req, ch) => {
        const id = req.requestId;
        ch.postMessage({
          type: 'reply-stream-start',
          v: '2',
          requestId: id,
          status: 200,
          statusText: 'OK',
          headers: {},
        });
        for (let i = 0; i < 5; i++) {
          await delay(60); // < timeoutMs each, but 5×60 > timeoutMs total
          ch.postMessage({
            type: 'reply-stream-chunk',
            v: '2',
            requestId: id,
            seq: i,
            data: new Uint8Array([48 + i]),
          });
        }
        ch.postMessage({ type: 'reply-stream-end', v: '2', requestId: id, seq: 5 });
      }),
    );
    const handler = bridgeCrossRealmPreview(5204, { timeoutMs: 100 });
    cleanup.add(handler.dispose);

    const r = await handler(new Request('http://preview.local/'));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('01234');
  });

  it('start then worker goes silent → idle 502', async () => {
    cleanup.add(
      rawWorker(5205, (req, ch) => {
        ch.postMessage({
          type: 'reply-stream-start',
          v: '2',
          requestId: req.requestId,
          status: 200,
          statusText: 'OK',
          headers: {},
        });
        // ...and never sends a chunk/end.
      }),
    );
    const handler = bridgeCrossRealmPreview(5205, { timeoutMs: 80 });
    cleanup.add(handler.dispose);
    const r = await handler(new Request('http://preview.local/'));
    expect(r.status).toBe(502);
    expect(await r.text()).toContain('timeout');
  });

  it('seq gap → 502 frame loss (no corrupt body)', async () => {
    cleanup.add(
      rawWorker(5206, (req, ch) => {
        const id = req.requestId;
        ch.postMessage({
          type: 'reply-stream-start',
          v: '2',
          requestId: id,
          status: 200,
          statusText: 'OK',
          headers: {},
        });
        ch.postMessage({
          type: 'reply-stream-chunk',
          v: '2',
          requestId: id,
          seq: 0,
          data: new Uint8Array([1]),
        });
        ch.postMessage({
          type: 'reply-stream-chunk',
          v: '2',
          requestId: id,
          seq: 2,
          data: new Uint8Array([2]),
        }); // skipped 1
      }),
    );
    const handler = bridgeCrossRealmPreview(5206, { timeoutMs: 500 });
    cleanup.add(handler.dispose);
    const r = await handler(new Request('http://preview.local/'));
    expect(r.status).toBe(502);
    expect(await r.text()).toContain('frame loss');
  });

  it('dispose mid-stream rejects the in-flight request with 502', async () => {
    let handlerRef: CrossRealmPortHandler | null = null;
    cleanup.add(
      rawWorker(5207, (req, ch) => {
        const id = req.requestId;
        ch.postMessage({
          type: 'reply-stream-start',
          v: '2',
          requestId: id,
          status: 200,
          statusText: 'OK',
          headers: {},
        });
        ch.postMessage({
          type: 'reply-stream-chunk',
          v: '2',
          requestId: id,
          seq: 0,
          data: new Uint8Array([1]),
        });
        setTimeout(() => handlerRef?.dispose(), 20); // never sends end
      }),
    );
    const handler = bridgeCrossRealmPreview(5207, { timeoutMs: 2000 });
    handlerRef = handler;
    cleanup.add(handler.dispose);
    const r = await handler(new Request('http://preview.local/'));
    expect(r.status).toBe(502);
    expect(await r.text()).toContain('disposed');
  });
});

// ─── ADR-0048: SSE ceiling ───────────────────────────────────────────────────
// The cross-realm reply is buffered-until-`end` (the page concats on
// `reply-stream-end`; true end-to-end `ReadableStream` is M12, ADR-0017). An
// unending `text/event-stream` body therefore never resolves — both the
// buffered `arrayBuffer()` path and the streaming drain loop await forever.
// `serveCrossRealmPreview` must fail loud naming the ceiling instead of hanging,
// mirroring the SW-bridge guard in `@riftydev/service-worker` body-transport.ts.

describe('cross-realm preview port — SSE ceiling (ADR-0048)', () => {
  it('refuses to drain an unending text/event-stream body → fast 502 naming the ceiling (no silent hang)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    cleanup.add(() => spy.mockRestore());
    cleanup.add(
      serveCrossRealmPreview(5209, async () => {
        // Keep-alive SSE body: emits one frame, never closes — `reader.read()`
        // would otherwise await forever and the page would never resolve.
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new Uint8Array([100, 97, 116, 97, 58, 32, 49, 10, 10])); // "data: 1\n\n"
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        });
      }),
    );
    // Large idle timeout so a pass can only come from the guard, never a timeout.
    const handler = bridgeCrossRealmPreview(5209, { timeoutMs: 5000 });
    cleanup.add(handler.dispose);

    const settled = await Promise.race([
      Promise.resolve(handler(new Request('http://preview.local/events'))).then((r) => ({
        kind: 'response' as const,
        r,
      })),
      delay(300).then(() => ({ kind: 'pending' as const })),
    ]);
    // Before the guard the worker streams the first frame then drains forever →
    // the page accumulator never resolves → 'pending'.
    expect(settled.kind).toBe('response');
    if (settled.kind !== 'response') return;
    expect(settled.r.status).toBe(502);
    expect(await settled.r.text()).toContain('net.preview.cross-realm-sse-drain');
  });

  it('fails loud for an unending non-SSE body even while chunks keep arriving', async () => {
    cleanup.add(
      serveCrossRealmPreview(
        5210,
        async () => {
          let timer: ReturnType<typeof setInterval> | undefined;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([123, 34, 110, 34, 58, 48, 125, 10]));
              timer = setInterval(() => {
                controller.enqueue(new Uint8Array([123, 34, 110, 34, 58, 49, 125, 10]));
              }, 10);
            },
            cancel() {
              if (timer !== undefined) clearInterval(timer);
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'application/x-ndjson' },
          });
        },
        { streamDrainTimeoutMs: 80 },
      ),
    );
    const handler = bridgeCrossRealmPreview(5210, { timeoutMs: 1000 });
    cleanup.add(handler.dispose);

    const settled = await Promise.race([
      Promise.resolve(handler(new Request('http://preview.local/feed'))).then((r) => ({
        kind: 'response' as const,
        r,
      })),
      delay(500).then(() => ({ kind: 'pending' as const })),
    ]);

    expect(settled.kind).toBe('response');
    if (settled.kind !== 'response') return;
    expect(settled.r.status).toBe(502);
    expect(await settled.r.text()).toContain('net.preview.cross-realm-unbounded-body');
  });
});

async function compressBytes(
  bytes: Uint8Array,
  format: 'gzip' | 'deflate',
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
