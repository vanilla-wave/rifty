import { describe, expect, it } from 'vitest';
import {
  createProxiedRegistryClient,
  proxiedRegistryFetch,
  validateRegistryUrl,
} from './registry-fetch.ts';

describe('registry endpoint', () => {
  it('rejects missing and malformed host configuration before fetching', () => {
    expect(() => validateRegistryUrl({ registryUrl: '' })).toThrow(/required/);
    expect(() => validateRegistryUrl({ registryUrl: 'ftp://example.test/registry' })).toThrow(
      /http or https/,
    );
    expect(() =>
      validateRegistryUrl({ registryUrl: 'https://user:secret@example.test/registry' }),
    ).toThrow(/credentials/);
  });

  it('absolutizes a same-origin host path and rewrites tarballs through it', async () => {
    const calls: string[] = [];
    const fetcher = proxiedRegistryFetch({
      registryUrl: '/npm-registry',
      baseUrl: 'https://host.example/app/',
      async fetcher(url) {
        calls.push(url);
        return new Response('ok');
      },
    });

    await fetcher('https://upstream.example/vite/-/vite-8.0.0.tgz');

    expect(calls).toEqual(['https://host.example/npm-registry/vite/-/vite-8.0.0.tgz']);
  });

  it('uses the configured endpoint for metadata and tarballs', async () => {
    const calls: string[] = [];
    const registry = createProxiedRegistryClient({
      registryUrl: 'https://host.example/npm-registry',
      async fetcher(url) {
        calls.push(url);
        if (url.endsWith('/vite')) return Response.json({ name: 'vite', versions: {} });
        return new Response(new Uint8Array([0x1f, 0x8b]));
      },
    });

    await registry.getPackument('vite');
    await registry.getTarball('https://upstream.example/vite/-/vite-8.0.0.tgz');

    expect(registry.baseUrl).toBe('https://host.example/npm-registry');
    expect(calls).toEqual([
      'https://host.example/npm-registry/vite',
      'https://host.example/npm-registry/vite/-/vite-8.0.0.tgz',
    ]);
  });
});
