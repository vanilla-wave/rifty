import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handleNpmRegistryRequest } from '../../netlify/functions/npm-registry.mts';

describe('npm registry production proxy', () => {
  it('proxies scoped package metadata with COI-safe headers', async () => {
    const calls: string[] = [];
    const response = await handleNpmRegistryRequest(
      new Request('https://site.test/npm-registry/@scope/pkg?write=true'),
      { upstreamBase: 'https://registry.npmjs.org' },
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
      { upstreamBase: 'https://registry.npmjs.org' },
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

  it('proxies direct Netlify function paths used by CLI rewrites', async () => {
    const calls: string[] = [];
    const response = await handleNpmRegistryRequest(
      new Request('https://site.test/.netlify/functions/npm-registry/vite'),
      { upstreamBase: 'https://registry.npmjs.org' },
      async (url) => {
        calls.push(String(url));
        return new Response('{"name":"vite"}', {
          headers: { 'content-type': 'application/json' },
        });
      },
    );

    expect(calls).toEqual(['https://registry.npmjs.org/vite']);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"name":"vite"}');
  });

  it('buffers upstream bodies before returning a Netlify response', async () => {
    const upstream = new Response('{"name":"pkg"}', {
      headers: { 'content-type': 'application/json' },
    });

    const response = await handleNpmRegistryRequest(
      new Request('https://site.test/npm-registry/pkg'),
      { upstreamBase: 'https://registry.npmjs.org' },
      async () => upstream,
    );

    expect(response.body).not.toBe(upstream.body);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.text()).toBe('{"name":"pkg"}');
  });

  it('strips upstream body framing headers when re-wrapping the body', async () => {
    const response = await handleNpmRegistryRequest(
      new Request('https://site.test/npm-registry/pkg'),
      { upstreamBase: 'https://registry.npmjs.org' },
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
      { upstreamBase: 'https://registry.npmjs.org' },
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
      { upstreamBase: 'https://registry.npmjs.org' },
      async () => {
        called = true;
        return new Response('nope');
      },
    );

    expect(called).toBe(false);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });

  it('fails loudly when no upstream env config is present', async () => {
    const response = await handleNpmRegistryRequest(
      new Request('https://site.test/npm-registry/pkg'),
      { upstreamBase: undefined },
      async () => new Response('nope'),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toContain('RIFTY_NPM_REGISTRY_UPSTREAM');
  });

  it('routes Netlify production through the function, not a hardcoded external redirect', () => {
    const toml = readFileSync('netlify.toml', 'utf8');
    const redirects = readFileSync('apps/playground/public/_redirects', 'utf8');
    const workflow = readFileSync('.github/workflows/netlify.yml', 'utf8');
    const staticDeploys =
      workflow.match(/--dir="\$GITHUB_WORKSPACE\/apps\/playground\/dist"/g) ?? [];
    const redirectsProxyIndex = redirects.indexOf(
      '/npm-registry/*  /.netlify/functions/npm-registry/:splat  200',
    );
    const redirectsSpaIndex = redirects.indexOf('/*  /index.html  200');
    const tomlProxyIndex = toml.indexOf('from = "/npm-registry/*"');
    const tomlSpaIndex = toml.indexOf('from = "/*"');

    expect(toml).not.toContain('to = "https://registry.npmjs.org');
    expect(redirects).not.toContain('https://registry.npmjs.org');
    expect(redirectsProxyIndex).toBeGreaterThanOrEqual(0);
    expect(redirectsSpaIndex).toBeGreaterThanOrEqual(0);
    expect(redirectsProxyIndex).toBeLessThan(redirectsSpaIndex);
    expect(toml).toContain('to = "/.netlify/functions/npm-registry/:splat"');
    expect(tomlProxyIndex).toBeGreaterThanOrEqual(0);
    expect(tomlSpaIndex).toBeGreaterThanOrEqual(0);
    expect(tomlProxyIndex).toBeLessThan(tomlSpaIndex);
    expect(toml).toContain('RIFTY_NPM_REGISTRY_UPSTREAM');
    expect(toml).toContain('[functions]\n  directory = "netlify/functions"');
    expect(workflow).toContain('NETLIFY_BUILD_CONTEXT:');
    expect(workflow).toContain('NETLIFY_SITE_ID:');
    expect(workflow).toContain(
      'pnpm dlx netlify@26.0.2 build --filter="@riftydev/playground" --context="$NETLIFY_BUILD_CONTEXT"',
    );
    expect(workflow).not.toContain('build --filter="@riftydev/playground" --site=');
    expect(workflow).not.toContain('functions:build');
    expect(workflow).not.toContain('--functions=');
    expect(staticDeploys).toHaveLength(2);
  });
});
