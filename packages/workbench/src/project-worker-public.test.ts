import { expect, it } from 'vitest';
import { createRegistryProxyFetch } from './registry-proxy-fetch.ts';

it('exports a configurable npm registry proxy fetcher for project workers', async () => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const fetcher = createRegistryProxyFetch({
    proxyPrefix: '/npm-registry',
    fetch: async (url, init) => {
      calls.push([url, init]);
      return new Response('{}');
    },
  });

  await fetcher('https://registry.npmjs.org/vite', { method: 'GET' });
  await fetcher('https://example.test/pkg');

  expect(calls).toEqual([
    ['/npm-registry/vite', { method: 'GET' }],
    ['https://example.test/pkg', undefined],
  ]);
});
