import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX = 'apps/landing/index.html';
const HEADERS = 'apps/landing/public/_headers';
const REDIRECTS = 'apps/landing/public/_redirects';
const HOSTING_DOC = 'docs/public/hosting-domains.md';
const LANDING_NETLIFY_CONFIG = 'apps/landing/netlify.toml';
const LANDING_PACKAGE = 'apps/landing/package.json';
const NETLIFY_WORKFLOW = '.github/workflows/netlify.yml';
const NAV = 'apps/landing/src/sections/nav.ts';
const HERO = 'apps/landing/src/sections/hero.ts';

describe('landing static site', () => {
  it('publishes the rifty.dev landing entry (Vite SPA shell)', () => {
    expect(existsSync(INDEX)).toBe(true);

    const html = readFileSync(INDEX, 'utf8');
    // Vite SPA: head metadata is static; the page body is mounted by /src/main.ts.
    expect(html).toContain('<title>rifty');
    expect(html).toContain('<link rel="canonical" href="https://rifty.dev/" />');
    expect(html).toContain('id="app"');
    expect(html).toContain('/src/main.ts');
  });

  it('keeps a playground and GitHub exit', () => {
    // /play → live playground (its own origin) survives as a redirect…
    const redirects = readFileSync(REDIRECTS, 'utf8');
    expect(redirects).toContain('https://play.rifty.dev/');
    // …the hero primary CTA opens the playground; the nav links out to the repo.
    const hero = readFileSync(HERO, 'utf8');
    expect(hero).toContain('https://play.rifty.dev/');
    const nav = readFileSync(NAV, 'utf8');
    expect(nav).toContain('https://github.com/vanilla-wave/rifty');
  });

  it('keeps landing headers separate from playground cross-origin isolation', () => {
    expect(existsSync(HEADERS)).toBe(true);
    expect(existsSync(LANDING_NETLIFY_CONFIG)).toBe(true);

    const headers = readFileSync(HEADERS, 'utf8');
    const config = readFileSync(LANDING_NETLIFY_CONFIG, 'utf8');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(headers).not.toContain('Cross-Origin-Opener-Policy');
    expect(headers).not.toContain('Cross-Origin-Embedder-Policy');
    expect(config).not.toContain('Cross-Origin-Opener-Policy');
    expect(config).not.toContain('Cross-Origin-Embedder-Policy');
  });

  it('deploys the landing as its own Netlify project from the built dist', () => {
    expect(existsSync(LANDING_PACKAGE)).toBe(true);

    const pkg = JSON.parse(readFileSync(LANDING_PACKAGE, 'utf8')) as { name?: string };
    const workflow = readFileSync(NETLIFY_WORKFLOW, 'utf8');
    expect(pkg.name).toBe('@riftydev/landing');
    expect(workflow).toContain('deploy-landing:');
    expect(workflow).toContain('NETLIFY_LANDING_SITE_ID:');
    expect(workflow).toContain('NETLIFY_LANDING_SITE_NAME:');
    expect(workflow).toContain('--filter="@riftydev/landing"');
    // Vite build output, not the raw source dir.
    expect(workflow).toContain('--dir="$GITHUB_WORKSPACE/apps/landing/dist"');
    expect(workflow).toContain('pnpm --filter @riftydev/landing build');
    expect(workflow).toContain('https://${NETLIFY_LANDING_SITE_NAME}.netlify.app');
  });

  it('documents the public domain split', () => {
    expect(existsSync(HOSTING_DOC)).toBe(true);

    const doc = readFileSync(HOSTING_DOC, 'utf8');
    expect(doc).toContain('rifty.dev');
    expect(doc).toContain('play.rifty.dev');
    expect(doc).toContain('registry.rifty.dev');
    expect(doc).toContain('Yandex Cloud DNS');
    expect(doc).toContain('Netlify');
  });
});
