import { http, dispatchToPort, listPorts, unregisterPort } from '@riftydev/net';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  for (const p of listPorts()) unregisterPort(p);
});

describe('node:http server via port registry', () => {
  it('responds to a basic GET', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`hello ${req.url}`);
    });
    server.listen(3000);
    expect(listPorts()).toContain(3000);
    const response = await dispatchToPort(3000, new Request('http://x/y'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello /y');
    expect(response.headers.get('content-type')).toBe('text/plain');
  });

  it('handles POST with body', async () => {
    const server = http.createServer(async (req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array);
      });
      req.on('end', () => {
        res.statusCode = 201;
        res.end(`got: ${body}`);
      });
    });
    server.listen(3001);
    const response = await dispatchToPort(
      3001,
      new Request('http://x/echo', { method: 'POST', body: 'hello!' }),
    );
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('got: hello!');
  });

  it('serves null-body statuses (204/304) without throwing, like Node', async () => {
    // Regression: the fetch Response constructor rejects ANY body for
    // 204/205/304; passing the streaming body unconditionally made
    // `res.status(204).end()` (express DELETE handlers) blow up the dispatch.
    const server = http.createServer((req, res) => {
      res.writeHead(req.url === '/modified' ? 304 : 204);
      res.end();
    });
    server.listen(3024);

    const noContent = await dispatchToPort(3024, new Request('http://x/gone'));
    expect(noContent.status).toBe(204);
    expect(await noContent.text()).toBe('');
    // 204 has no body — neither chunked framing nor a content-length (Node
    // omits both; end() must not leave a stamp for the dropped body)
    expect(noContent.headers.get('transfer-encoding')).toBeNull();
    expect(noContent.headers.get('content-length')).toBeNull();

    const notModified = await dispatchToPort(3024, new Request('http://x/modified'));
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');
  });

  it('marks length-less bodied requests as chunked so body parsers read them', async () => {
    // fetch Requests rebuilt across the preview bridge LOSE content-length
    // (forbidden request header in browsers). Node never delivers a bodied
    // request with neither content-length nor transfer-encoding; typeis-style
    // hasBody() checks (express.json) would silently skip the body otherwise.
    const server = http.createServer((req, res) => {
      res.end(
        JSON.stringify({
          te: req.headers['transfer-encoding'] ?? null,
          cl: req.headers['content-length'] ?? null,
        }),
      );
    });
    server.listen(3025);

    const bodied = await dispatchToPort(
      3025,
      new Request('http://x/', { method: 'POST', body: 'abc' }),
    );
    const seen = (await bodied.json()) as { te: string | null; cl: string | null };
    expect(seen.cl !== null || seen.te === 'chunked').toBe(true);

    // body-less GET must NOT grow framing headers
    const bare = await dispatchToPort(3025, new Request('http://x/'));
    const bareSeen = (await bare.json()) as { te: string | null; cl: string | null };
    expect(bareSeen.te).toBeNull();
    expect(bareSeen.cl).toBeNull();
  });

  it('close() unregisters the port', async () => {
    const server = http.createServer((_req, res) => res.end('x'));
    server.listen(3002);
    expect(listPorts()).toContain(3002);
    await new Promise<void>((r) => server.close(() => r()));
    expect(listPorts()).not.toContain(3002);
  });

  it('returns 502 when port not listening', async () => {
    const response = await dispatchToPort(9999, new Request('http://x/'));
    expect(response.status).toBe(502);
  });

  it('http.get loops back to the process own registered port', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`self ${req.url}`);
    });
    server.listen(3003);

    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.get('http://localhost:3003/self-check', (res) => {
        const chunks: string[] = [];
        const decoder = new TextDecoder();
        res.on('data', (chunk) => chunks.push(decoder.decode(chunk as Uint8Array)));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: chunks.join('') }));
        res.on('error', reject);
      });
      req.on('error', reject);
    });

    expect(response).toEqual({ statusCode: 200, body: 'self /self-check' });
  });
});

describe('node:http streaming responses (ADR-0017 phase 1)', () => {
  it('streams SSE-style chunks with Transfer-Encoding: chunked', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: a\n\n');
      res.write('data: b\n\n');
      res.end('data: c\n\n');
    });
    server.listen(3100);
    const response = await dispatchToPort(3100, new Request('http://x/events'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('transfer-encoding')).toBe('chunked');
    const body = response.body;
    if (!body) throw new Error('expected streaming body');
    const reader = body.getReader();
    const chunks: string[] = [];
    const dec = new TextDecoder();
    // The 3 writes plus an end() with payload may coalesce in transport, but
    // the underlying ReadableStream queues each write as its own chunk —
    // assert we read at least 3 distinct chunks for the SSE frames.
    let frames: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const piece = dec.decode(value);
        chunks.push(piece);
        frames = frames.concat(piece.split('\n\n').filter((s) => s.length > 0));
      }
    }
    expect(frames).toEqual(['data: a', 'data: b', 'data: c']);
    // Underlying ReadableStream queue preserved one chunk per write call.
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it('long-poll: write fires after setTimeout, reader sees chunk after the delay', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      setTimeout(() => {
        res.end('late');
      }, 50);
    });
    server.listen(3101);
    const t0 = Date.now();
    const response = await dispatchToPort(3101, new Request('http://x/poll'));
    const body = response.body;
    if (!body) throw new Error('expected streaming body');
    const reader = body.getReader();
    const dec = new TextDecoder();
    const first = await reader.read();
    const t1 = Date.now();
    expect(first.done).toBe(false);
    expect(dec.decode(first.value)).toBe('late');
    // The headers flush sync on writeHead; the body chunk arrives only after
    // the setTimeout — so the read should not resolve before ~50 ms.
    expect(t1 - t0).toBeGreaterThanOrEqual(40);
    const tail = await reader.read();
    expect(tail.done).toBe(true);
  });

  it('queues one stream chunk per write() call (backpressure surface)', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      // Five distinct writes — each should remain its own chunk in the
      // ReadableStream's internal queue (the consumer hasn't started reading
      // yet when these enqueue; backpressure here means the queue holds
      // them, not that we silently coalesce or drop).
      for (let i = 0; i < 5; i++) res.write(`x${i}`);
      res.end();
    });
    server.listen(3102);
    const response = await dispatchToPort(3102, new Request('http://x/bp'));
    const body = response.body;
    if (!body) throw new Error('expected streaming body');
    const reader = body.getReader();
    const dec = new TextDecoder();
    const seen: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) seen.push(dec.decode(value));
    }
    // Each write is its own queued chunk; total chunk count >= 5 (and
    // strictly more than 1 — proves we are not coalescing into one string
    // buffer the way the pre-ADR-0017 implementation did).
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(seen.join('')).toBe('x0x1x2x3x4');
  });
});
