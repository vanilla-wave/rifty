import { type Page, expect, test } from '@playwright/test';

async function minimumTextContrast(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluateAll((elements) => {
    type Color = { r: number; g: number; b: number; a: number };

    const parse = (value: string): Color => {
      const [r = 0, g = 0, b = 0, a = 1] = (value.match(/[\d.]+/g) ?? []).map(Number);
      return { r, g, b, a };
    };
    const over = (foreground: Color, background: Color): Color => {
      const a = foreground.a + background.a * (1 - foreground.a);
      if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / a,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / a,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / a,
        a,
      };
    };
    const opaqueBackground = (element: Element): Color => {
      const layers: Color[] = [];
      for (let current: Element | null = element; current; current = current.parentElement) {
        layers.push(parse(getComputedStyle(current).backgroundColor));
      }
      return layers.reverse().reduce((background, layer) => over(layer, background), {
        r: 255,
        g: 255,
        b: 255,
        a: 1,
      });
    };
    const luminance = ({ r, g, b }: Color): number => {
      const [red = 0, green = 0, blue = 0] = [r, g, b].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };

    return Math.min(
      ...elements.map((element) => {
        const background = opaqueBackground(element);
        const foreground = over(parse(getComputedStyle(element).color), background);
        const dark = luminance(background);
        const light = luminance(foreground);
        return (Math.max(dark, light) + 0.05) / (Math.min(dark, light) + 0.05);
      }),
    );
  });
}

const PACKAGE_NAMES = [
  'sdk',
  'io',
  'vfs',
  'kernel',
  'net',
  'runtime-js',
  'runtime-wasi',
  'npm-client',
  'shell',
  'terminal',
  'service-worker',
  'workbench',
  'git',
  'ts-language-service',
  'shadow-registry',
  'eddy',
];

test('serves configured search, sharing, crawl, and pre-JavaScript contracts', async ({
  browser,
  page,
  request,
}) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Open Node-compatible runtime for the browser | rifty');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://site.example.test/',
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://site.example.test/',
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'index, follow, max-image-preview:large',
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#15171d');
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '1200');
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '630');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    'content',
    'summary_large_image',
  );
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/apple-touch-icon.png',
  );
  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    await expect(page.locator(selector)).toHaveAttribute(
      'content',
      'https://site.example.test/og-image.png',
    );
  }
  const structuredData = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}',
  ) as { url?: string; sameAs?: string[] };
  expect(structuredData.url).toBe('https://site.example.test/');
  expect(structuredData.sameAs).toEqual(['https://forge.example.test/org/rifty']);
  await expect(page.getByRole('link', { name: 'GitHub repository' }).first()).toHaveAttribute(
    'href',
    'https://forge.example.test/org/rifty',
  );
  await expect(page.getByRole('link', { name: 'Read SDK docs' })).toHaveAttribute(
    'href',
    'https://docs.example.test/rifty-sdk',
  );

  const [robots, sitemap, socialPreview, appleIcon] = await Promise.all([
    request.get('/robots.txt'),
    request.get('/sitemap.xml'),
    request.get('/og-image.png'),
    request.get('/apple-touch-icon.png'),
  ]);
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toBe(
    'User-agent: *\nAllow: /\nSitemap: https://site.example.test/sitemap.xml\n',
  );
  expect(await sitemap.text()).toContain('<loc>https://site.example.test/</loc>');
  expect(await sitemap.text()).not.toContain('<lastmod>');
  for (const [response, width, height] of [
    [socialPreview, 1200, 630],
    [appleIcon, 180, 180],
  ] as const) {
    expect(response.status()).toBe(200);
    const image = await response.body();
    expect(image.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(image.readUInt32BE(16)).toBe(width);
    expect(image.readUInt32BE(20)).toBe(height);
  }

  // Three self-hosted families (Archivo Black display, Inter, Roboto Mono); no font CDN.
  const fontRequests = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes('.woff2')),
  );
  expect(fontRequests.some((name) => name.includes('archivo-black'))).toBe(true);
  const landingOrigin = new URL(page.url()).origin;
  expect(fontRequests.every((name) => new URL(name).origin === landingOrigin)).toBe(true);

  const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
  const noScriptPage = await noScriptContext.newPage();
  await noScriptPage.goto('/');
  await expect(noScriptPage.getByRole('heading', { name: /Node, npm &/ })).toBeVisible();
  await expect(
    noScriptPage.getByText(/Run tested Express 4, Vite 7, npm tooling and \.wasm workflows/),
  ).toBeVisible();
  await expect(noScriptPage.getByRole('link', { name: /view rifty on github/i })).toHaveAttribute(
    'href',
    'https://forge.example.test/org/rifty',
  );
  await noScriptContext.close();
});

test('stamps the latest release and derives every exit label from configuration', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.locator('.hero-eyebrow')).toHaveText(
    'OPEN RUNTIME · SELF-HOSTABLE — v0.4 · M11 CONSUMER READY: ACTIVE',
  );
  await expect(page.locator('.cta-footer')).toHaveText(
    'SITE.EXAMPLE.TEST — OPEN, SELF-HOSTABLE, BROWSER-LOCAL RUNTIME INFRASTRUCTURE · v0.4 · M11 ACTIVE · MIT',
  );
  // No hardcoded public domains: labels come from the configured URLs.
  const play = page.locator('.nav-play');
  await expect(play).toHaveText('PLAY.EXAMPLE.TEST');
  await expect(play).toHaveAttribute('href', 'https://play.example.test/');
  await expect(page.locator('.nav-github')).toHaveAttribute(
    'href',
    'https://forge.example.test/org/rifty',
  );
  const ctaPlay = page.locator('.cta-buttons .btn-primary');
  await expect(ctaPlay).toContainText('PLAY.EXAMPLE.TEST');
  await expect(ctaPlay).toHaveAttribute('href', 'https://play.example.test/');
  expect(await page.locator('body').innerText()).not.toMatch(/rifty\.dev/i);
});

test('positions the open runtime honestly and shows only public Sandbox API', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.hero-lead')).toHaveText(
    'rifty is an open, self-hostable Node-compatible runtime and WASI runner for Chromium. Run tested Express 4, Vite 7, npm tooling and .wasm workflows — execution and files stay in the tab.',
  );
  await expect(page.locator('.hero-h1')).toHaveText(/Node, npm &a dev server —in a tab\./);

  const quickStart = page.locator('.qs-code');
  await expect(quickStart.locator('.qs-code-line')).toHaveText([
    "import runtimeWorkerUrl from '@riftydev/runtime-js/worker?worker&url'",
    "import { checkCapabilities, createSandbox } from '@riftydev/sdk'",
    '',
    'async function main() {',
    '  const caps = checkCapabilities()',
    '  if (!caps.capabilities.worker ||',
    '      !caps.capabilities.crossOriginIsolated) {',
    '    throw new Error(caps.summary)',
    '  }',
    '',
    '  const sandbox = await createSandbox({',
    '    workerUrl: runtimeWorkerUrl,',
    '    skipServiceWorker: true,',
    '  })',
    '  sandbox.runtime.on((event) => {',
    "    if (event.type === 'stdout') console.log(event.chunk)",
    '  })',
    '  await sandbox.runtime.eval(\'console.log("hello from a Worker")\')',
    '}',
    'void main()',
  ]);
  expect(await quickStart.innerText()).not.toMatch(/import\.meta\.url|\/sw\.js/);
  await expect(page.locator('.qs-aside')).toContainText('requireCrossOriginIsolation: false');
  await expect(page.locator('.qs-aside')).not.toContainText('IIFE');
  await expect(page.locator('.qs-headers')).toHaveText(
    'Cross-Origin-Opener-Policy: same-originCross-Origin-Embedder-Policy: credentialessCross-Origin-Resource-Policy: cross-origin'.replace(
      'credentialess',
      'credentialless',
    ),
  );
  await expect(page.locator('.qs-install')).toHaveText(
    '$ npm i @riftydev/sdk @riftydev/runtime-js',
  );

  const howItWorks = page.getByRole('link', { name: 'HOW IT WORKS', exact: true });
  await expect(howItWorks).toBeVisible();
  await expect(howItWorks).toHaveAttribute('href', '#arch');

  const runSomethingReal = page.getByRole('link', { name: 'RUN SOMETHING REAL', exact: true });
  await expect(runSomethingReal).toBeVisible();
  await expect(runSomethingReal).toHaveAttribute('href', 'https://play.example.test/');
});

test('summarizes capability classes with three representative presets', async ({ page }) => {
  await page.goto('/');

  const cards = page.locator('[data-preset-card]');
  await expect(cards).toHaveCount(3);
  expect(
    await cards.evaluateAll((items) => items.map((item) => item.getAttribute('data-preset-card'))),
  ).toEqual(['real-vite', 'express-sqlite', 'cli-report']);
  await expect(
    page.getByText(
      'Dev tooling, server apps, and command-line programs. More presets live in the playground.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Dev server \+ HMR/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /HTTP server \+ database/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /CLI \+ project files/ })).toBeVisible();
  for (const id of ['real-vite', 'express-sqlite', 'cli-report']) {
    await expect(page.locator(`[data-preset-card="${id}"]`)).toHaveAttribute(
      'href',
      `https://play.example.test/?preset=${id}&autorun=1`,
    );
  }

  // Equal cells; the OPEN ↗ pointer sits on one shared baseline.
  const layout = await cards.evaluateAll((items) =>
    items.map((card) => {
      const action = card.querySelector<HTMLElement>('.demo-action');
      const box = card.getBoundingClientRect();
      return {
        top: box.top,
        width: box.width,
        height: box.height,
        actionTop: action?.getBoundingClientRect().top ?? Number.NaN,
      };
    }),
  );
  for (const key of ['top', 'width', 'height', 'actionTop'] as const) {
    const values = layout.map((item) => item[key]);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  }
});

test('keeps primary navigation labels aligned with document order', async ({ page }) => {
  await page.goto('/');

  const links = page.getByRole('navigation', { name: 'Primary' }).getByRole('link');
  await expect(links).toHaveText(['OVERVIEW', 'DEMOS', 'ARCH', 'PACKAGES', 'START']);
  expect(
    await links.evaluateAll((items) => items.map((item) => item.getAttribute('href'))),
  ).toEqual(['#what', '#demos', '#arch', '#packages', '#start']);
  const tops = await page
    .locator('#what, #demos, #arch, #packages, #start')
    .evaluateAll((sections) => sections.map((section) => section.getBoundingClientRect().top));
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);
});

test('renders semantic landmarks, the capability grid, and the package graph', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('contentinfo')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  for (const name of ['NODE RUNTIME', 'EMBEDDABLE WORKBENCH', 'TYPESCRIPT + GIT OVER VFS']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.locator('.term')).toContainText('GET /preview/3000/ 200');
  await expect(page.locator('.term-cursor')).toHaveCount(1);

  await expect(
    page.getByRole('heading', { name: 'One umbrella, sixteen packages.', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.pkg-name')).toHaveText(PACKAGE_NAMES);
  await expect(page.locator('.pkg-sdk .pkg-name')).toHaveText('sdk');
  await expect(page.locator('.packages-docs')).toHaveAttribute(
    'href',
    'https://docs.example.test/rifty-sdk',
  );

  const marquee = page.locator('.marquee-item:not([aria-hidden="true"])');
  await expect(marquee).toHaveText([
    'MIT LICENSED*',
    'SELF-HOSTABLE*',
    'CHROMIUM-FIRST*',
    'NODE 24 PARITY TARGET*',
    'WASI PREVIEW1*',
  ]);
});

test('keeps the honest ceiling loud and explains each gap on demand', async ({ page }) => {
  await page.goto('/');

  const chips = page.locator('.ceil-chip');
  await expect(chips).toHaveText([
    '⚠node:https — fetch-backed',
    '✕raw TCP connect',
    '✕native modules',
    '⚠node:sqlite — in-memory',
    '⚠node:vm — QuickJS realm',
    '⚠30s force-kill drain',
    '⚠preview — buffered (unbounded → 502)',
  ]);
  const note = page.locator('.ceil-note');
  await expect(note).toHaveText('Pick a gap to read exactly what throws and why.');

  const tcp = chips.nth(1);
  await tcp.click();
  await expect(tcp).toHaveAttribute('aria-pressed', 'true');
  await expect(note).toHaveText(
    'net.connect (raw TCP): Raw sockets throw. The HttpFramedSocket is HTTP-framed only.',
  );
  await tcp.click();
  await expect(tcp).toHaveAttribute('aria-pressed', 'false');
  await expect(note).toHaveText('Pick a gap to read exactly what throws and why.');
});

test('keeps muted copy at WCAG AA text contrast', async ({ page }) => {
  await page.goto('/');

  for (const selector of [
    '.hero-eyebrow',
    '.hero-lead',
    '.marquee-track',
    '.term-prompt',
    '.term-dim',
    '.feat-body',
    '.sec-intro',
    '.demo-body',
    '.demo-meta',
    '.demo-tag',
    '.pkg-desc',
    '.qs-code-comment',
    '.qs-note',
    '.qs-leaf',
    '.ceil-chip',
    '.cta-footer',
    '.nav-link',
  ]) {
    expect(await minimumTextContrast(page, selector), selector).toBeGreaterThanOrEqual(4.5);
  }
});

test('defers the below-fold architecture explorer until it approaches the viewport', async ({
  page,
}) => {
  await page.goto('/');

  const explorer = page.locator('#explorer-root');
  expect(await explorer.evaluate((root) => root.childElementCount)).toBe(0);
  expect(await page.locator('body *').count()).toBeLessThan(600);
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some((entry) => new URL(entry.name).pathname.includes('/src/explorer/')),
    ),
  ).toBe(false);

  await explorer.scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Whole schema', exact: true })).toBeVisible();
  expect(await explorer.evaluate((root) => root.childElementCount)).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some((entry) => new URL(entry.name).pathname.includes('/src/explorer/')),
      ),
    )
    .toBe(true);
});

test('keeps the landing usable and fails loudly when the explorer chunk cannot load', async ({
  page,
}) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.route('**/src/explorer/explorer.ts*', (route) => route.abort('failed'));

  await page.goto('/#arch');
  await expect(
    page.getByRole('heading', { name: 'One tab, four realms.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  await expect
    .poll(() => errors.map((error) => error.message))
    .toContain('landing: architecture explorer failed to load');
  expect(
    await page.locator('#explorer-root').evaluate((root) => root.clientHeight),
  ).toBeGreaterThan(700);
});

test('recovers the copy control after clipboard permission failure', async ({ page }) => {
  await page.addInitScript(() => {
    let attempts = 0;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('permission denied');
        },
      },
    });
  });
  await page.goto('/');

  const copy = page.locator('.cta-copy');
  const feedback = page.locator('.cta [role="status"]');
  await copy.click();
  await expect(copy).toHaveClass(/cta-copy-error/);
  await expect(copy).toHaveAttribute(
    'aria-label',
    'Copy failed. Select: npm i @riftydev/sdk @riftydev/runtime-js',
  );
  await expect(feedback).toHaveText('Copy failed. Select the install command manually.');

  await copy.click();
  await expect(copy).toHaveClass(/cta-copy-done/);
  await expect(copy).not.toHaveClass(/cta-copy-error/);
  await expect(copy).toHaveAttribute('aria-label', 'Install command copied');
  await expect(feedback).toHaveText('Install command copied.');
});

test('closes the mobile drawer for every same-page navigation exit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.locator('#nav-mobile-panel')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('link', { name: 'DEMOS', exact: true })
    .click();
  await expect(page.locator('#nav-mobile-panel')).toBeHidden();

  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.setViewportSize({ width: 1_000, height: 844 });
  await expect(page.locator('#nav-mobile-panel')).toBeHidden();
  await expect(page.locator('.nav-menu-button')).toHaveAttribute('aria-expanded', 'false');
});

test('renders the favicon and respects reduced-motion preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const animationNames = await page
    .locator('.sonar-ring, .sonar-dot, .term-cursor, .marquee-track')
    .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).animationName));
  expect(animationNames.every((name) => name === 'none')).toBe(true);
  await expect(page.locator('.marquee-item:not([aria-hidden="true"])').first()).toBeVisible();

  const favicon = await page.evaluate(async () => {
    const image = new Image();
    image.src = '/favicon.svg';
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  });
  expect(favicon.width).toBeGreaterThan(0);
  expect(favicon.height).toBe(favicon.width);
});

test('hides the decorative depth gauge and sonar from assistive tech', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.gauge')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.sonar')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.gauge')).toBeVisible();
  await page.setViewportSize({ width: 880, height: 844 });
  await expect(page.locator('.gauge')).toBeHidden();
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]) {
  test(`mobile ${viewport.width}px fits the page and keeps the primary paths usable`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    const play = page.locator('.nav-mobile-play');
    await expect(play).toBeVisible();
    await expect(play).toHaveAttribute('href', 'https://play.example.test/');
    await expect(page.locator('[data-preset-card]')).toHaveCount(3);

    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      cardWidths: Array.from(document.querySelectorAll<HTMLElement>('[data-preset-card]')).map(
        (card) => card.getBoundingClientRect().width,
      ),
    }));
    expect(layout.page).toBeLessThanOrEqual(layout.viewport);
    expect(layout.cardWidths.every((width) => width <= layout.viewport)).toBe(true);
    const playBox = await play.boundingBox();
    expect(playBox).not.toBeNull();
    expect(playBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((playBox?.x ?? 0) + (playBox?.width ?? 0)).toBeLessThanOrEqual(layout.viewport);
    expect(playBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    const brandHeight = await page
      .locator('.nav-brand')
      .evaluate((brand) => brand.getBoundingClientRect().height);
    expect(brandHeight).toBeGreaterThanOrEqual(44);

    const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
    await menu.click();
    await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the playground' }).nth(1)).toBeVisible();
    const panelBox = await page.locator('#nav-mobile-panel').boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((panelBox?.x ?? 0) + (panelBox?.width ?? 0)).toBeLessThanOrEqual(layout.viewport);
    await page.keyboard.press('Escape');
    await expect(page.locator('#nav-mobile-panel')).toBeHidden();

    // Long code and header lines scroll inside their panels, never the page.
    await page.goto('/#start');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(
      await page.locator('.qs-code').evaluate((code) => code.scrollWidth > code.clientWidth),
    ).toBe(true);
  });
}
