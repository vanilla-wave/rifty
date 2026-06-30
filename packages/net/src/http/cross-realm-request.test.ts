/**
 * Integration: `http.request`/`http.get` reaching a server in ANOTHER Worker
 * realm via the preview broker (ADR-0180). A loopback miss in this realm's port
 * registry probes the per-port BroadcastChannel; a realm that owns the port
 * (here a `serveCrossRealmPreview` on the same channel, as every served
 * `node <file>` registers) answers. Both ends share one Node realm over
 * BroadcastChannel — same primitive the playground uses page↔worker.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { serveCrossRealmPreview } from '../cross-realm/preview-port.ts';
import { listPorts, unregisterPort } from '../registry.ts';
import { type ClientRequest, createServer, get, request } from './server.ts';

const decoder = new TextDecoder();
const serveTeardowns: Array<() => void> = [];

function serve(port: number, dispatch: (req: Request) => Promise<Response>): void {
  serveTeardowns.push(serveCrossRealmPreview(port, dispatch));
}

interface ClientResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  dataEvents: number;
}

/** Attach response/error listeners to a ClientRequest and collect the reply. */
function drain(req: ClientRequest): Promise<ClientResult> {
  return new Promise<ClientResult>((resolve, reject) => {
    req.on('response', (res: unknown) => {
      const msg = res as {
        statusCode: number;
        headers: Record<string, string>;
        on(event: 'data', cb: (chunk: Uint8Array) => void): void;
        on(event: 'end', cb: () => void): void;
        on(event: 'error', cb: (err: Error) => void): void;
      };
      const chunks: string[] = [];
      let dataEvents = 0;
      msg.on('data', (chunk) => {
        dataEvents += 1;
        chunks.push(decoder.decode(chunk));
      });
      msg.on('end', () =>
        resolve({ statusCode: msg.statusCode, headers: msg.headers, body: chunks.join(''), dataEvents }),
      );
      msg.on('error', reject);
    });
    req.on('error', reject);
  });
}

afterEach(() => {
  for (const t of serveTeardowns.splice(0)) {
    try {
      t();
    } catch {
      /* best effort */
    }
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const port of listPorts()) unregisterPort(port);
});

describe('http cross-realm loopback via the preview broker (ADR-0180)', () => {
  it('routes a GET to a sibling-realm-owned loopback port and returns its response (no fetch leak)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('cross-realm loopback must not hit fetch'));
    serve(7001, async (req) => {
      expect(new URL(req.url).pathname).toBe('/users');
      return new Response('[{"id":1}]', {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-owner': 'api' },
      });
    });

    const res = await drain(get('http://localhost:7001/users'));

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-owner']).toBe('api');
    expect(res.body).toBe('[{"id":1}]');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('emits Node-shaped ECONNREFUSED for a loopback port no realm owns (no fetch leak)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('must not hit fetch'));

    const err = await new Promise<Error & { code?: string; errno?: number; syscall?: string; port?: number }>(
      (resolve) => {
        const req = request({ hostname: 'localhost', port: 7002, path: '/x' });
        req.on('response', () => resolve(new Error('expected ECONNREFUSED, got a response')));
        req.on('error', (e) => resolve(e as Error & { code?: string }));
        req.end();
      },
    );

    expect(err).toMatchObject({ code: 'ECONNREFUSED', errno: -111, syscall: 'connect', port: 7002 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('streams a cross-realm SSE body to the client chunk-by-chunk (not buffered-until-end)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not hit fetch'));
    serve(7003, async () => {
      let i = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (i >= 3) {
            controller.close();
            return;
          }
          await new Promise((r) => setTimeout(r, 15));
          controller.enqueue(new TextEncoder().encode(`data: ${i++}\n\n`));
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });

    const res = await drain(get('http://localhost:7003/events'));

    expect(res.body).toBe('data: 0\n\ndata: 1\n\ndata: 2\n\n');
    // More than one 'data' event ⇒ delivered live per chunk, not one buffered blob.
    expect(res.dataEvents).toBeGreaterThan(1);
  });

  it('delivers a POST body to the owning realm and returns its response', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not hit fetch'));
    serve(7004, async (req) => {
      const body = await req.text();
      return new Response(`got:${body}`, { status: 201 });
    });

    const req = request({ hostname: 'localhost', port: 7004, path: '/upload', method: 'POST' });
    const done = drain(req);
    req.write('payload-xyz');
    req.end();
    const res = await done;

    expect(res.statusCode).toBe(201);
    expect(res.body).toBe('got:payload-xyz');
  });

  it('serves a LOCAL registered port from the registry, never the cross-realm broker', async () => {
    // A sibling realm ALSO answers on 7005 over the channel, but the local
    // registry must win — routeClientRequest returns {kind:'local'} first.
    serve(7005, async () => new Response('from-sibling', { status: 200 }));
    createServer((_req, res) => res.end('from-local')).listen(7005);

    const res = await drain(get('http://localhost:7005/'));

    expect(res.body).toBe('from-local');
  });
});
