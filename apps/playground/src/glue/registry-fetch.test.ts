import { afterEach, describe, expect, it } from 'vitest';
import { createProxiedRegistryClient, proxiedRegistryFetch } from './registry-fetch.ts';

interface RiftyGlobals {
  __RIFTY_REGISTRY_URL__?: string | undefined;
}

const g = globalThis as typeof globalThis & RiftyGlobals;
const savedRegistryUrl = g.__RIFTY_REGISTRY_URL__;

afterEach(() => {
  g.__RIFTY_REGISTRY_URL__ = savedRegistryUrl;
});

describe('proxiedRegistryFetch', () => {
  it('rewrites npm tarball URLs to the configured registry proxy origin', async () => {
    const calls: string[] = [];
    const fetcher = proxiedRegistryFetch({
      proxyPrefix: 'https://registry.rifty.dev/npm-registry',
      async fetcher(url) {
        calls.push(url);
        return new Response('ok');
      },
    });

    await fetcher('https://registry.npmjs.org/vite/-/vite-8.0.0.tgz');

    expect(calls).toEqual(['https://registry.rifty.dev/npm-registry/vite/-/vite-8.0.0.tgz']);
  });

  it('uses getRegistryBaseUrl so production builds can leave Netlify origin', async () => {
    const calls: string[] = [];
    g.__RIFTY_REGISTRY_URL__ = 'https://registry.rifty.dev/npm-registry';
    const fetcher = proxiedRegistryFetch({
      async fetcher(url) {
        calls.push(url);
        return new Response('ok');
      },
    });

    await fetcher('https://registry.npmjs.org/@scope/pkg/-/pkg-1.0.0.tgz');

    expect(calls).toEqual(['https://registry.rifty.dev/npm-registry/@scope/pkg/-/pkg-1.0.0.tgz']);
  });

  it('creates a RegistryClient whose metadata and tarballs share the configured proxy', async () => {
    const calls: string[] = [];
    g.__RIFTY_REGISTRY_URL__ = 'https://registry.rifty.dev/npm-registry';
    const registry = createProxiedRegistryClient({
      async fetcher(url) {
        calls.push(url);
        if (url.endsWith('/vite')) {
          return Response.json({
            name: 'vite',
            versions: {},
          });
        }
        return new Response(new Uint8Array([0x1f, 0x8b]));
      },
    });

    await registry.getPackument('vite');
    await registry.getTarball('https://registry.npmjs.org/vite/-/vite-8.0.0.tgz');

    expect(registry.baseUrl).toBe('https://registry.rifty.dev/npm-registry');
    expect(calls).toEqual([
      'https://registry.rifty.dev/npm-registry/vite',
      'https://registry.rifty.dev/npm-registry/vite/-/vite-8.0.0.tgz',
    ]);
  });
});
