import { describe, expect, it } from 'vitest';
import { handleNpmRegistryRequest } from '../../api/npm-registry/[...path].ts';

describe('npm registry production proxy', () => {
  it('proxies scoped package metadata with COI-safe headers', async () => {
    const calls: string[] = [];
    const response = await handleNpmRegistryRequest(
      new Request('https://site.test/npm-registry/@scope/pkg?write=true'),
      async (url) => {
        calls.push(String(url));
        return new Response('{"name":"@scope/pkg"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    );

    expect(calls).toEqual(['https://registry.npmjs.org/@scope/pkg?write=true']);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.text()).toBe('{"name":"@scope/pkg"}');
  });

  it('proxies tarballs and preserves upstream status', async () => {
    const calls: string[] = [];
    const response = await handleNpmRegistryRequest(
      new Request('https://site.test/npm-registry/pkg/-/pkg-1.0.0.tgz'),
      async (url) => {
        calls.push(String(url));
        return new Response('missing', { status: 404, statusText: 'Not Found' });
      },
    );

    expect(calls).toEqual(['https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz']);
    expect(response.status).toBe(404);
    expect(response.statusText).toBe('Not Found');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.text()).toBe('missing');
  });

  it('strips upstream body framing headers when re-wrapping the body', async () => {
    const response = await handleNpmRegistryRequest(
      new Request('https://site.test/npm-registry/pkg'),
      async () =>
        new Response('{"name":"pkg"}', {
          headers: {
            'content-type': 'application/json',
            'content-encoding': 'gzip',
            'content-length': '9999',
            connection: 'keep-alive',
            'transfer-encoding': 'chunked',
          },
        }),
    );

    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('connection')).toBeNull();
    expect(response.headers.get('transfer-encoding')).toBeNull();
    expect(await response.text()).toBe('{"name":"pkg"}');
  });

  it('answers preflight without upstream fetch', async () => {
    let called = false;
    const response = await handleNpmRegistryRequest(
      new Request('https://site.test/npm-registry/pkg', { method: 'OPTIONS' }),
      async () => {
        called = true;
        return new Response('nope');
      },
    );

    expect(called).toBe(false);
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('rejects unsupported methods without upstream fetch', async () => {
    let called = false;
    const response = await handleNpmRegistryRequest(
      new Request('https://site.test/npm-registry/pkg', { method: 'POST', body: 'x' }),
      async () => {
        called = true;
        return new Response('nope');
      },
    );

    expect(called).toBe(false);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });
});
