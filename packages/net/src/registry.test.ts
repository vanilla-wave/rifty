/**
 * Tests for the port registry.
 *
 * Item 3 (2026-05-25 review): `dispatchToPort` 502 response must be JSON-bodied
 * with `Content-Type: application/json` (not a plain-text body without
 * content-type).
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  addrInUseError,
  dispatchToPort,
  isPortBound,
  listPorts,
  registerPort,
  unregisterPort,
} from './registry.ts';

afterEach(() => {
  for (const p of listPorts()) unregisterPort(p);
});

describe('port occupancy (ADR-0157 review C3)', () => {
  it('isPortBound reflects register/unregister', () => {
    expect(isPortBound(4400)).toBe(false);
    registerPort(4400, () => new Response('ok'));
    expect(isPortBound(4400)).toBe(true);
    unregisterPort(4400);
    expect(isPortBound(4400)).toBe(false);
  });

  it('addrInUseError carries the libuv-shaped EADDRINUSE fields', () => {
    const err = addrInUseError('127.0.0.1', 3000) as Error & Record<string, unknown>;
    expect(err.message).toBe('listen EADDRINUSE: address already in use 127.0.0.1:3000');
    expect(err.code).toBe('EADDRINUSE');
    expect(err.errno).toBe(-98);
    expect(err.syscall).toBe('listen');
    expect(err.address).toBe('127.0.0.1');
    expect(err.port).toBe(3000);
  });
});

describe('dispatchToPort — no listener path', () => {
  it('returns a JSON-bodied 502 with explicit application/json content-type', async () => {
    const response = await dispatchToPort(9999, new Request('http://x/'));
    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    const body = await response.json();
    expect(body).toEqual({ error: 'no_listener', port: 9999 });
  });
});

describe('dispatchToPort — listener path is untouched', () => {
  it('routes a request through a registered handler', async () => {
    registerPort(3000, (_req) => new Response('ok', { status: 200 }));
    const response = await dispatchToPort(3000, new Request('http://x/'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });
});
