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
import { listPorts, unregisterPort } from '../registry.ts';
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
