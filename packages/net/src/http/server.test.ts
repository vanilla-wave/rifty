/**
 * Tests for `HttpServer.listen` overloads.
 *
 * F05-T1 (Q-2026-05-30-101): Node's real `http.Server.listen` accepts an
 * options object — `server.listen({ port, host }, cb)` — in addition to the
 * bare-number form. `@effect/platform-node`'s `NodeHttpServer.layer` drives
 * `listen` exclusively through the options-object overload. Before this fix,
 * the options object was assigned verbatim as `this.port` and handed to
 * `registerPort`, so the port registry keyed on a non-number: the port was
 * unroutable (502) while `'listening'` still fired (the silent-bind trap).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { dispatchToPort, listPorts, unregisterPort } from '../registry.ts';
import type { ServerResponse } from './response.ts';
import { createServer } from './server.ts';

afterEach(() => {
  for (const p of listPorts()) unregisterPort(p);
});

describe('HttpServer.listen — options-object overload (Q-2026-05-30-101)', () => {
  it('listen(options) registers the port and fires listening', async () => {
    const s = createServer();
    let listened = false;
    s.on('listening', () => {
      listened = true;
    });
    s.listen({ port: 4097 }, () => {});
    // `listening` + the callback fire on a queued microtask; await past it.
    await Promise.resolve();
    await Promise.resolve();
    expect(listPorts()).toContain(4097);
    expect(listened).toBe(true);
  });

  it('listen(port) bare-number form is unchanged', async () => {
    const s = createServer();
    let listened = false;
    s.on('listening', () => {
      listened = true;
    });
    s.listen(4098, () => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(listPorts()).toContain(4098);
    expect(listened).toBe(true);
  });

  it('address() reflects the numeric port from the options form', () => {
    const s = createServer();
    s.listen({ port: 4099 });
    expect(s.address()).toEqual({ port: 4099 });
  });
});

/**
 * F05-T2 (P3 first-light): the Effect-shaped consumption proof.
 *
 * `@effect/platform-node`'s `NodeHttpServer.layer` constructs the server with
 * NO handler (`createServer()` with zero args) and attaches its request
 * handler afterwards via `server.on('request', (req, res) => …)`. Spike B
 * confirmed this works AS-IS at the buffered level. This pins it as a
 * regression contract: over the now-routable port (F05-T1), a buffered
 * `res.writeHead(200, …) + res.end(jsonBody)` route dispatched through the
 * registry yields a 200 application/json Response with the exact body bytes —
 * proving the `emit('request')` path for the no-arg-constructor Effect form
 * with NONE of the streaming gaps (drain/pipe) in play.
 */
describe('HttpServer — no-handler createServer + on(request) buffered (P3 first-light)', () => {
  it('no-handler createServer + on(request) buffered end(body) dispatches 200 JSON', async () => {
    const port = 4100;
    // Effect form: no handler at construction; attach via .on('request').
    const s = createServer();
    // The `'request'` listener is typed by Node as `(req, res)`; rifty's
    // EventEmitter exposes the generic `(...args: unknown[])` shape, so narrow
    // the positional args to the documented event payload (no `any`).
    s.on('request', (...args: unknown[]) => {
      const res = args[1] as ServerResponse;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: 'x' }));
    });
    s.listen({ port });
    await Promise.resolve();
    await Promise.resolve();

    const resp = await dispatchToPort(port, new Request(`http://preview.local:${port}/version`));
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toBe('application/json');
    expect(await resp.text()).toBe(JSON.stringify({ version: 'x' }));
  });
});
