import https from '@rifty/net/https';
import { describe, expect, it } from 'vitest';

describe('node:https loud-throw stub', () => {
  it('imports without throwing', () => {
    expect(https).toBeDefined();
    expect(typeof https.createServer).toBe('function');
    expect(typeof https.request).toBe('function');
    expect(typeof https.get).toBe('function');
  });

  it('createServer throws NotImplementedError', () => {
    try {
      https.createServer({});
      throw new Error('expected createServer to throw');
    } catch (err) {
      expect((err as Error).name).toBe('NotImplementedError');
      expect((err as Error).message).toContain('https.createServer');
      expect((err as Error).message).toContain('TLS termination');
    }
  });

  it('request throws NotImplementedError', () => {
    try {
      https.request('https://example.com');
      throw new Error('expected request to throw');
    } catch (err) {
      expect((err as Error).name).toBe('NotImplementedError');
      expect((err as Error).message).toContain('https.request');
      expect((err as Error).message).toContain('TLS termination');
    }
  });

  it('get throws NotImplementedError', () => {
    try {
      https.get('https://example.com');
      throw new Error('expected get to throw');
    } catch (err) {
      expect((err as Error).name).toBe('NotImplementedError');
      expect((err as Error).message).toContain('https.get');
    }
  });

  it('Agent constructor throws NotImplementedError', () => {
    expect(() => new https.Agent()).toThrow(/NotImplementedError|Not implemented/);
  });
});
