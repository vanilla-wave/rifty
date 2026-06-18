/**
 * Tests for `net.ts` — HTTP-framed socket (formerly `Socket`).
 *
 * The class previously named `Socket` actually serialises a Request to HTTP
 * text and parses the response — it is HTTP-framed, NOT a TCP socket.
 * Per Item 2 of 2026-05-25 review, the class is now `HttpFramedSocket`, with
 * `net.Socket` kept as a deprecated alias that emits a one-shot `console.warn`
 * on instantiation.
 */

import { describe, expect, it, vi } from 'vitest';
import net, { HttpFramedSocket, Socket, connect, createConnection } from './net.ts';

describe('HttpFramedSocket — Item 2', () => {
  it('is exported under the new name', () => {
    expect(HttpFramedSocket).toBeDefined();
    const s = new HttpFramedSocket();
    expect(s).toBeInstanceOf(HttpFramedSocket);
  });

  it('basic write/end shape works (HTTP framing surface)', () => {
    const s = new HttpFramedSocket();
    const received: Uint8Array[] = [];
    s.on('write', (c) => received.push(c as Uint8Array));
    s.write('hello');
    s.end();
    expect(s.writableEnded).toBe(true);
    expect(received.length).toBeGreaterThan(0);
  });
});

describe('net.Socket — deprecated alias', () => {
  it('is exported and produces HttpFramedSocket-compatible instances', () => {
    expect(Socket).toBeDefined();
    expect(net.Socket).toBeDefined();
  });

  it('emits a one-shot deprecation warn across multiple instantiations', async () => {
    // The deprecation flag is module-scoped; importing fresh isolates this
    // test from any prior `new Socket()` call.
    vi.resetModules();
    const fresh = await import('./net.ts');
    const originalWarn = console.warn;
    const warnSpy = vi.fn();
    console.warn = warnSpy;
    try {
      const a = new fresh.Socket();
      const b = new fresh.Socket();
      const c = new fresh.Socket();
      expect(a).toBeInstanceOf(fresh.HttpFramedSocket);
      expect(b).toBeInstanceOf(fresh.HttpFramedSocket);
      expect(c).toBeInstanceOf(fresh.HttpFramedSocket);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = String(warnSpy.mock.calls[0]?.[0] ?? '');
      expect(msg).toMatch(/HttpFramedSocket/);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe('HttpFramedSocket.connect — non-HTTP usage is loud', () => {
  it('throws NotImplementedError on connect()', () => {
    const s = new HttpFramedSocket();
    expect(() => s.connect(80, 'localhost')).toThrowError(
      /net\.Socket\.connect.*raw TCP sockets.*http\/fetch\/WebSocket/i,
    );
  });

  it('throws directed NotImplementedError for net.connect/createConnection', () => {
    expect(() => connect(80, 'localhost')).toThrowError(/net\.connect.*raw TCP sockets/i);
    expect(() => createConnection({ port: 80, host: 'localhost' })).toThrowError(
      /net\.connect.*raw TCP sockets/i,
    );
    expect(() => net.connect(80, 'localhost')).toThrowError(/net\.connect.*raw TCP sockets/i);
  });
});
