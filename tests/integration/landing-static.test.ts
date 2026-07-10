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
const DEMOS = 'apps/landing/src/sections/demos.ts';
const PLAYGROUND_URL = 'apps/landing/src/playground-url.ts';
const FAVICON = 'apps/landing/public/favicon.svg';

// Bodies between every <!-- … --> in an XML/SVG document (open-ended last comment included).
function commentBodies(xml: string): string[] {
  const bodies: string[] = [];
  let i = 0;
  for (;;) {
    const start = xml.indexOf('<!--', i);
    if (start === -1) break;
    const end = xml.indexOf('-->', start + 4);
    if (end === -1) {
      bodies.push(xml.slice(start + 4));
      break;
    }
    bodies.push(xml.slice(start + 4, end));
    i = end + 3;
  }
  return bodies;
}

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

  it('shows a browser-tab favicon (rel=icon → existing svg)', () => {
    // The tab was iconless: no <link rel="icon"> + no asset shipped from public/.
    const html = readFileSync(INDEX, 'utf8');
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(existsSync(FAVICON)).toBe(true);
  });

  it('ships a favicon browsers can actually render (well-formed SVG/XML)', () => {
    // Regression: the asset shipped + was served 200 image/svg+xml, but the tab stayed
    // iconless. Cause — the comment carried CSS-var token names (--deep, --ac), and `--`
    // inside an XML comment is illegal; browsers parse SVG as strict XML and reject it
    // ("Double hyphen within comment"). The fetch succeeds, the render does not.
    const svg = readFileSync(FAVICON, 'utf8');
    for (const body of commentBodies(svg)) {
      expect(body, 'XML comment must not contain "--" (browsers reject the SVG)').not.toContain(
        '--',
      );
    }
    // …and it must still draw the mark, not degrade to a blank icon.
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('#0e1014'); // deep surface
    expect(svg).toContain('#c7f05a'); // lime diamond
  });

  it('keeps self-hostable preset playground and GitHub exits', () => {
    const redirects = readFileSync(REDIRECTS, 'utf8');
    expect(redirects).not.toContain('https://play.rifty.dev/');
    // The hero exits directly to the playground through the same env-configured,
    // same-origin-by-default seam used by the preset cards.
    const hero = readFileSync(HERO, 'utf8');
    expect(hero).toContain('buildPlaygroundHref');
    expect(hero).not.toContain("primary.href = '#demos'");
    const demos = readFileSync(DEMOS, 'utf8');
    expect(demos).toContain('VITE_RIFTY_PLAYGROUND_URL');
    expect(demos).not.toContain('https://play.rifty.dev/');
    expect(existsSync(PLAYGROUND_URL)).toBe(true);
    const playgroundUrl = readFileSync(PLAYGROUND_URL, 'utf8');
    expect(playgroundUrl).not.toContain('SELF_HOSTED_PLAYGROUND_ROUTE');
    expect(playgroundUrl).toContain('must be configured');
    expect(playgroundUrl).toContain("searchParams.set('autorun', '1')");
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
    expect(workflow).toContain('VITE_RIFTY_PLAYGROUND_URL:');
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
