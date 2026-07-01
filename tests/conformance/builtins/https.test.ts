import https from '@riftydev/net/https';
import { afterEach, describe, expect, it, vi } from 'vitest';

const decoder = new TextDecoder();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('node:https — client request/get over fetch, TLS ceiling throws (ADR-0181)', () => {
  it('imports without throwing and exposes the request + ceiling surface', () => {
    expect(https).toBeDefined();
    expect(typeof https.createServer).toBe('function');
    expect(typeof https.request).toBe('function');
    expect(typeof https.get).toBe('function');
    expect(typeof https.Agent).toBe('function');
  });

  it('https.get routes an external https: request over the validated page fetch', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('body', { status: 200 }));

    const { statusCode, body } = await new Promise<{ statusCode: number; body: string }>(
      (resolve, reject) => {
        const req = https.get('https://example.com/x', (res) => {
          const chunks: string[] = [];
          res.on('data', (chunk) => chunks.push(decoder.decode(chunk as Uint8Array)));
          res.on('end', () => resolve({ statusCode: res.statusCode, body: chunks.join('') }));
          res.on('error', reject);
        });
        req.on('error', reject);
      },
    );

    expect(statusCode).toBe(200);
    expect(body).toBe('body');
    expect(new URL(String(fetchSpy.mock.calls[0]![0])).protocol).toBe('https:');
  });

  it('createServer throws NotImplementedError (no in-browser TLS server)', () => {
    try {
      https.createServer({});
      throw new Error('expected createServer to throw');
    } catch (err) {
      expect((err as Error).name).toBe('NotImplementedError');
      expect((err as Error).message).toContain('https.createServer');
      expect((err as Error).message).toContain('TLS termination');
    }
  });

  it('Agent constructor throws NotImplementedError', () => {
    expect(() => new https.Agent()).toThrow(/NotImplementedError|Not implemented/);
  });

  it('a TLS control option (rejectUnauthorized:false) throws, never silently ignored', () => {
    try {
      https.request({ hostname: 'example.com', rejectUnauthorized: false });
      throw new Error('expected request to throw');
    } catch (err) {
      expect((err as Error).name).toBe('NotImplementedError');
      expect((err as Error).message).toContain('rejectUnauthorized');
    }
  });

  it('globalAgent is a benign, readable config object', () => {
    expect(typeof https.globalAgent).toBe('object');
    expect(https.globalAgent).toBeTruthy();
    expect(() => https.globalAgent.maxSockets).not.toThrow();
  });
});
