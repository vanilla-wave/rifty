import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Yandex Cloud npm registry proxy', () => {
  it('ships a streaming Compute proxy config, not a serverless JSON proxy', () => {
    const caddy = readFileSync('deploy/yandex/npm-registry/Caddyfile', 'utf8');
    const compose = readFileSync('deploy/yandex/npm-registry/docker-compose.yml', 'utf8');

    expect(compose).toContain('caddy:2');
    expect(compose).toContain('network_mode: host');
    expect(caddy).toContain('registry.rifty.dev');
    expect(caddy).toContain('handle_path /npm-registry/*');
    expect(caddy).toContain('reverse_proxy https://registry.npmjs.org');
    expect(caddy).toContain('header_up Host registry.npmjs.org');
    expect(caddy).toContain('Access-Control-Allow-Origin "*"');
    expect(caddy).toContain('Access-Control-Allow-Methods "GET, HEAD, OPTIONS"');
    expect(caddy).toContain('Cross-Origin-Resource-Policy "cross-origin"');
    expect(caddy).toContain('@unsupported not method GET HEAD OPTIONS');
    expect(caddy).toContain('Allow "GET, HEAD, OPTIONS"');
    expect(existsSync('deploy/yandex/npm-registry/api-gateway.yaml')).toBe(false);
    expect(existsSync('deploy/yandex/npm-registry/index.cjs')).toBe(false);
  });

  it('documents production proxy ownership outside Netlify', () => {
    const toml = readFileSync('netlify.toml', 'utf8');
    const hostingNetlify = readFileSync('docs/public/hosting-netlify.md', 'utf8');
    const hostingDomains = readFileSync('docs/public/hosting-domains.md', 'utf8');
    const redirects = readFileSync('apps/playground/public/_redirects', 'utf8');
    const smoke = readFileSync('tools/registry/smoke-npm-registry.mjs', 'utf8');
    const workflow = readFileSync('.github/workflows/netlify.yml', 'utf8');

    expect(existsSync('netlify/functions/npm-registry.mts')).toBe(false);
    expect(toml).not.toContain('[functions]');
    expect(toml).not.toContain('RIFTY_NPM_REGISTRY_UPSTREAM');
    expect(toml).not.toContain('/.netlify/functions/npm-registry');
    expect(toml).toContain('VITE_RIFTY_REGISTRY_URL = "https://registry.rifty.dev/npm-registry"');
    expect(redirects).not.toContain('npm-registry');
    expect(hostingNetlify).not.toContain('Required Netlify site environment');
    expect(hostingNetlify).toContain('registry.rifty.dev');
    expect(hostingDomains).toContain(
      '| `registry.rifty.dev` | Yandex Cloud | npm registry proxy |',
    );
    expect(hostingDomains).toContain('registry.rifty.dev.  A');
    expect(workflow).toContain('Smoke PR preview registry proxy');
    expect(workflow).toContain('Smoke production registry proxy');
    expect(workflow).toContain(
      'node tools/registry/smoke-npm-registry.mjs "https://registry.rifty.dev"',
    );
    expect(smoke).toContain('/npm-registry/vite');
    expect(smoke).toContain("data.name !== 'vite'");
    expect(smoke).toContain('/npm-registry/vite/-/vite-');
  });
});
