import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistryProxyPrefix, resolveRegistryProxyPrefix } from './registry-config.ts';

interface RiftyGlobals {
  __RIFTY_REGISTRY_URL__?: string | undefined;
}

const g = globalThis as typeof globalThis & RiftyGlobals;
const savedRegistryUrl = g.__RIFTY_REGISTRY_URL__;

afterEach(() => {
  vi.unstubAllEnvs();
  g.__RIFTY_REGISTRY_URL__ = savedRegistryUrl;
});

describe('resolveRegistryProxyPrefix', () => {
  it('prefers the Vite deployment override and removes its trailing slash', () => {
    expect(
      resolveRegistryProxyPrefix('https://registry.rifty.dev/npm-registry/', () => {
        throw new Error('default registry must stay unread');
      }),
    ).toBe('https://registry.rifty.dev/npm-registry');
  });

  it('uses the npm-client default when the Vite override is absent', () => {
    expect(resolveRegistryProxyPrefix(undefined, () => '/npm-registry/')).toBe('/npm-registry');
    expect(resolveRegistryProxyPrefix('', () => '/npm-registry/')).toBe('/npm-registry');
  });
});

describe('getRegistryProxyPrefix', () => {
  it('captures the Vite override before the npm-client fallback', () => {
    vi.stubEnv('VITE_RIFTY_REGISTRY_URL', 'https://vite.example/npm-registry/');
    g.__RIFTY_REGISTRY_URL__ = 'https://fallback.example/npm-registry';

    expect(getRegistryProxyPrefix()).toBe('https://vite.example/npm-registry');
  });

  it('preserves the npm-client App fallback when the Vite override is absent', () => {
    vi.stubEnv('VITE_RIFTY_REGISTRY_URL', '');
    g.__RIFTY_REGISTRY_URL__ = 'https://fallback.example/npm-registry/';

    expect(getRegistryProxyPrefix()).toBe('https://fallback.example/npm-registry');
  });
});
