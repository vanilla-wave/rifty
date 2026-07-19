import { describe, expect, it } from 'vitest';
import { createProxiedRegistryClient, proxiedRegistryFetch } from './registry-fetch.ts';

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

  it('leaves non-upstream URLs and request policy unchanged', async () => {
    const calls: Array<readonly [string, RequestInit | undefined]> = [];
    const init = { credentials: 'omit' as const, mode: 'cors' as const };
    const fetcher = proxiedRegistryFetch({
      proxyPrefix: 'https://registry.rifty.dev/npm-registry/',
      async fetcher(url, receivedInit) {
        calls.push([url, receivedInit]);
        return new Response('ok');
      },
    });

    await fetcher('https://cdn.example.com/pkg.tgz', init);

    expect(calls).toEqual([['https://cdn.example.com/pkg.tgz', init]]);
  });

  it('creates a RegistryClient whose metadata and tarballs share the configured proxy', async () => {
    const calls: string[] = [];
    const registry = createProxiedRegistryClient({
      proxyPrefix: 'https://registry.rifty.dev/npm-registry/',
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
