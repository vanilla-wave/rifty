import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RegistryClient, getRegistryBaseUrl } from './registry.ts';

interface RiftyGlobals {
  __RIFTY_REGISTRY_URL__?: string | undefined;
}

const g = globalThis as typeof globalThis & RiftyGlobals;

describe('getRegistryBaseUrl', () => {
  const savedGlobal = g.__RIFTY_REGISTRY_URL__;
  const savedEnv = process.env.REGISTRY_BASE_URL;

  beforeEach(() => {
    g.__RIFTY_REGISTRY_URL__ = undefined;
    // biome-ignore lint/performance/noDelete: process.env coerces assignments to strings; only delete truly unsets the key, which the getRegistryBaseUrl default-fallback test requires.
    delete process.env.REGISTRY_BASE_URL;
  });

  afterEach(() => {
    g.__RIFTY_REGISTRY_URL__ = savedGlobal;
    if (savedEnv === undefined) {
      // biome-ignore lint/performance/noDelete: restoring "not set" requires delete, not = undefined (which would leave the literal "undefined" string).
      delete process.env.REGISTRY_BASE_URL;
    } else {
      process.env.REGISTRY_BASE_URL = savedEnv;
    }
  });

  it('defaults to /npm-registry when no source set', () => {
    expect(getRegistryBaseUrl()).toBe('/npm-registry');
  });

  it('reads globalThis.__RIFTY_REGISTRY_URL__ (playground bootstrap path)', () => {
    g.__RIFTY_REGISTRY_URL__ = 'https://proxy.example.com/npm-registry';
    expect(getRegistryBaseUrl()).toBe('https://proxy.example.com/npm-registry');
  });

  it('reads process.env.REGISTRY_BASE_URL (Node-side test path)', () => {
    process.env.REGISTRY_BASE_URL = 'http://localhost:4873';
    expect(getRegistryBaseUrl()).toBe('http://localhost:4873');
  });

  it('global takes precedence over process.env (playground wins over harness)', () => {
    g.__RIFTY_REGISTRY_URL__ = 'https://global.example';
    process.env.REGISTRY_BASE_URL = 'http://env.example';
    expect(getRegistryBaseUrl()).toBe('https://global.example');
  });
});

describe('RegistryClient — uses getRegistryBaseUrl by default', () => {
  const savedGlobal = g.__RIFTY_REGISTRY_URL__;

  afterEach(() => {
    g.__RIFTY_REGISTRY_URL__ = savedGlobal;
  });

  it('honors __RIFTY_REGISTRY_URL__ in the constructed client', () => {
    g.__RIFTY_REGISTRY_URL__ = 'https://custom.example/r';
    const client = new RegistryClient({ fetch: async () => new Response('') });
    expect(client.baseUrl).toBe('https://custom.example/r');
  });

  it('falls back to /npm-registry when nothing is set', () => {
    g.__RIFTY_REGISTRY_URL__ = undefined;
    const client = new RegistryClient({ fetch: async () => new Response('') });
    expect(client.baseUrl).toBe('/npm-registry');
  });

  it('explicit baseUrl option still wins over global', () => {
    g.__RIFTY_REGISTRY_URL__ = 'https://global.example';
    const client = new RegistryClient({
      baseUrl: 'https://explicit.example',
      fetch: async () => new Response(''),
    });
    expect(client.baseUrl).toBe('https://explicit.example');
  });
});
