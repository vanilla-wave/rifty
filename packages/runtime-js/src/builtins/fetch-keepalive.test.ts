/**
 * Detached `fetch()` keeps the event loop alive until the response is done
 * (keepalive gap-d, ADR superseding ADR-0152's narrow handle set). A run-to-
 * completion child realm reaps on keepalive drain (refCount→0); before this fix
 * the network held no ref, so `fetch(u).then(r => r.text()).then(write)` detached
 * after top-level was dropped silently — the realm drained before the body
 * arrived. The wrapper refs on dispatch and holds until the BODY is consumed
 * (Node keeps the socket refed until the body is read), or the request fails.
 *
 * The unavoidable network egress boundary is a real loopback `http.createServer`
 * (Fidelity: mock the boundary, never the unit under test). The keepalive count
 * + real host fetch + real `awaitDrain` are exercised for real.
 */
import { type Server, createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { activeRefs, awaitDrain, resetKeepalive } from '../internal/event-loop-keepalive.ts';
import { installFetchKeepalive } from './fetch-keepalive.ts';

afterEach(() => resetKeepalive());

/** A loopback server we control — the deterministic network boundary. */
function startServer(
  handler: (req: unknown, res: import('node:http').ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server: Server = createServer(handler as never);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** Install the wrapper on an isolated target so the suite never mutates real global fetch. */
function makeFetch(): typeof fetch {
  const target: { fetch: typeof fetch } = { fetch: globalThis.fetch.bind(globalThis) };
  installFetchKeepalive(target);
  return target.fetch;
}

describe('fetch keepalive (gap-d: detached network)', () => {
  it('refs the loop while the request is in flight (RED: detached network holds no ref)', async () => {
    const { url, close } = await startServer((_req, res) => res.end('x'));
    const fetch = makeFetch();
    expect(activeRefs()).toBe(0);
    const p = fetch(url);
    expect(activeRefs()).toBeGreaterThanOrEqual(1);
    await (await p).text();
    await Promise.resolve();
    expect(activeRefs()).toBe(0);
    await close();
  });

  it('holds the ref AFTER headers until the body is consumed (faithful — Node keeps the socket refed)', async () => {
    const { url, close } = await startServer((_req, res) => {
      res.setHeader('content-type', 'text/plain');
      res.end('hello');
    });
    const fetch = makeFetch();
    const res = await fetch(url);
    // Headers arrived but the body has not been read → still refed.
    expect(activeRefs()).toBeGreaterThanOrEqual(1);
    expect(await res.text()).toBe('hello');
    await Promise.resolve();
    expect(activeRefs()).toBe(0);
    await close();
  });

  it('holds the ref until the body STREAM is fully read (res.body reader path)', async () => {
    const { url, close } = await startServer((_req, res) => {
      res.setHeader('content-type', 'text/plain');
      res.end('streamed');
    });
    const fetch = makeFetch();
    const res = await fetch(url);
    expect(activeRefs()).toBeGreaterThanOrEqual(1);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let out = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
    }
    out += dec.decode();
    expect(out).toBe('streamed');
    await Promise.resolve();
    expect(activeRefs()).toBe(0);
    await close();
  });

  it('releases the ref when the response has no body (204)', async () => {
    const { url, close } = await startServer((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const fetch = makeFetch();
    const res = await fetch(url);
    expect(res.status).toBe(204);
    await new Promise((r) => setTimeout(r, 0));
    expect(activeRefs()).toBe(0);
    await close();
  });

  it('releases the ref when the request fails (no leak on reject)', async () => {
    const fetch = makeFetch();
    // Nothing listening on 127.0.0.1:1 → connection refused.
    await expect(fetch('http://127.0.0.1:1/')).rejects.toBeDefined();
    await Promise.resolve();
    expect(activeRefs()).toBe(0);
  });

  it('user story: detached fetch().then(r=>r.text()).then(write) completes before the realm drains', async () => {
    // Delay the response past awaitDrain's first macrotask: a realm that does NOT
    // count the fetch reaps BEFORE the body arrives (the silent-drop bug).
    const { url, close } = await startServer((_req, res) => {
      setTimeout(() => {
        res.setHeader('content-type', 'text/plain');
        res.end('detached-body');
      }, 40);
    });
    const fetch = makeFetch();
    let written = '';
    // Detached (NOT awaited) — models the top level resolving while the fetch
    // is still in flight; the kernel drain seam then awaits keepalive.
    void fetch(url)
      .then((r) => r.text())
      .then((t) => {
        written = t;
      });
    await awaitDrain();
    expect(written).toBe('detached-body');
    await close();
  });

  it('does not perturb the user promise chain on reject (rejection still observable)', async () => {
    const fetch = makeFetch();
    // The wrapper attaches its own settle observer; the user must still see the
    // rejection (no swallow), and the wrapper must not raise a second unhandled one.
    let caught: unknown;
    await fetch('http://127.0.0.1:1/').catch((e) => {
      caught = e;
    });
    expect(caught).toBeDefined();
    expect(activeRefs()).toBe(0);
  });
});
