import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PROXY_RULE = '/npm-registry/*  https://registry.npmjs.org/:splat  200';
const PROXY_ROOT_RULE = '/npm-registry    https://registry.npmjs.org/        200';
const SPA_RULE = '/*  /index.html  200';

describe('production npm registry route (ADR-0528)', () => {
  it('proxies /npm-registry same-origin on Netlify, before the SPA fallback', () => {
    const redirects = readFileSync('apps/playground/public/_redirects', 'utf8');
    const toml = readFileSync('netlify.toml', 'utf8');

    // `_redirects` is processed first by Netlify; the proxy rules must precede
    // the SPA catch-all or the shell answers registry paths with HTML.
    expect(redirects.indexOf(PROXY_RULE)).toBeGreaterThanOrEqual(0);
    expect(redirects.indexOf(PROXY_ROOT_RULE)).toBeGreaterThan(redirects.indexOf(PROXY_RULE));
    expect(redirects.indexOf(SPA_RULE)).toBeGreaterThan(redirects.indexOf(PROXY_ROOT_RULE));

    const tomlProxy = toml.indexOf('from = "/npm-registry/*"');
    const tomlRoot = toml.indexOf('from = "/npm-registry"');
    const tomlSpa = toml.indexOf('from = "/*"');
    expect(tomlProxy).toBeGreaterThanOrEqual(0);
    expect(toml.slice(tomlProxy)).toContain('to = "https://registry.npmjs.org/:splat"');
    expect(toml.slice(tomlRoot)).toContain('to = "https://registry.npmjs.org/"');
    expect(tomlRoot).toBeGreaterThan(tomlProxy);
    expect(tomlSpa).toBeGreaterThan(tomlRoot);

    // Registry base is the relative default; no dead external origin baked in,
    // no serverless function, no eddy resolver while its host is down.
    expect(toml).not.toMatch(/^\s*VITE_RIFTY_REGISTRY_URL\s*=/mu);
    expect(toml).not.toMatch(/^\s*VITE_RIFTY_RESOLVER_URL\s*=/mu);
    expect(toml).not.toContain('[functions]');
    expect(existsSync('netlify/functions/npm-registry.mts')).toBe(false);
  });

  it('smokes the deployed playground origin, not a separate proxy host', () => {
    const workflow = readFileSync('.github/workflows/netlify.yml', 'utf8');
    const smoke = readFileSync('tools/registry/smoke-npm-registry.mjs', 'utf8');

    // `netlify deploy --alias` reports the mutable alias as deploy_url; the
    // smoke binds to the deploy's immutable permalink derived from deploy_id.
    expect(workflow).toContain(
      'permalink_url="https://${deploy_id}--${NETLIFY_SITE_NAME}.netlify.app"',
    );
    expect(workflow).toContain(
      'node tools/registry/smoke-npm-registry.mjs "${{ steps.preview.outputs.permalink_url }}"',
    );
    expect(workflow).not.toContain(
      'smoke-npm-registry.mjs "${{ steps.preview.outputs.deploy_url }}"',
    );
    expect(workflow).toContain(
      'node tools/registry/smoke-npm-registry.mjs "https://${NETLIFY_SITE_NAME}.netlify.app"',
    );
    expect(workflow).not.toContain('smoke-eddy');
    // The route smoke cannot see a site env var re-pointing the APP at a dead
    // host; the built artifact is checked before deploy.
    expect(workflow).toContain('Refuse dead registry/eddy hosts in the built app');
    expect(workflow).toContain(
      "grep -rqE 'registry\\.rifty\\.dev|eddy(-cdn|-origin)?\\.rifty\\.dev' apps/playground/dist",
    );
    expect(smoke).toContain('/npm-registry/vite');
    expect(smoke).toContain("data.name !== 'vite'");
    expect(smoke).toContain('/npm-registry/vite/-/vite-');
    expect(smoke).toContain('/npm-registry/@types%2Fnode');
    expect(smoke).not.toContain('cross-origin-resource-policy');
  });

  it('keeps the dedicated Yandex proxy config as a runbook, not a dependency', () => {
    const caddy = readFileSync('deploy/yandex/npm-registry/Caddyfile', 'utf8');
    const compose = readFileSync('deploy/yandex/npm-registry/docker-compose.yml', 'utf8');
    const hostingNetlify = readFileSync('docs/public/hosting-netlify.md', 'utf8');
    const hostingDomains = readFileSync('docs/public/hosting-domains.md', 'utf8');
    const hostingYandex = readFileSync('docs/public/hosting-yandex.md', 'utf8');

    // ADR-0163 §2/§3 and ADR-0176 stand (ADR-0528 overturns only routing).
    expect(compose).toContain('caddy:2');
    expect(compose).toContain('network_mode: host');
    expect(caddy).toContain('registry.rifty.dev, registry-origin.rifty.dev');
    expect(compose).toContain('registry.rifty.dev, registry-origin.rifty.dev');
    expect(caddy).toContain('handle_path /npm-registry/*');
    expect(caddy).toContain('reverse_proxy https://registry.npmjs.org');
    expect(caddy).toContain('header_up Host registry.npmjs.org');
    expect(caddy).toContain('Access-Control-Allow-Origin "*"');
    expect(caddy).toContain('Access-Control-Allow-Methods "GET, HEAD, OPTIONS"');
    expect(caddy).toContain('Cross-Origin-Resource-Policy "cross-origin"');
    expect(caddy).toContain(
      '@packuments path_regexp packument_cache ^/npm-registry/(?:@[^/]+/[^/]+|[^/]+)$',
    );
    expect(caddy).toContain('>Cache-Control "public, max-age=300, stale-while-revalidate=86400"');
    expect(caddy).toContain('>Vary "Accept"');
    expect(caddy).toContain('@tarballs path_regexp tarball_cache ^/npm-registry/.*/-/.*\\.tgz$');
    expect(caddy).toContain('>Cache-Control "public, max-age=31536000, immutable"');
    expect(compose).toContain(
      '@packuments path_regexp packument_cache ^/npm-registry/(?:@[^/]+/[^/]+|[^/]+)$',
    );
    expect(compose).toContain('@tarballs path_regexp tarball_cache ^/npm-registry/.*/-/.*\\.tgz$');
    expect(caddy).toContain('@unsupported not method GET HEAD OPTIONS');
    expect(caddy).toContain('Allow "GET, HEAD, OPTIONS"');
    expect(existsSync('deploy/yandex/npm-registry/api-gateway.yaml')).toBe(false);
    expect(existsSync('deploy/yandex/npm-registry/index.cjs')).toBe(false);
    expect(hostingNetlify).toContain('/npm-registry/*');
    expect(hostingNetlify).toContain('registry.npmjs.org');
    expect(hostingDomains).toContain('ADR-0528');
    expect(hostingYandex).toContain('ADR-0528');
  });
});
