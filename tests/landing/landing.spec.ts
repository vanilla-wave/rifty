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

test('serves configured search, sharing, crawl, and pre-JavaScript contracts', async ({
  browser,
  page,
  request,
}) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Open Node-compatible runtime for the browser | rifty');
  await expect(page.locator('.nav-version')).toHaveText('v0.2 · M11');
  await expect(page.locator('.hero-host')).toHaveText('@riftydev/sdk · v0.2');
  await expect(page.locator('.cta-footer-stamp')).toHaveText('v0.2 · M11 active');
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

  const fontRequests = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes('.woff2')),
  );
  expect(fontRequests.length).toBeGreaterThan(0);
  const landingOrigin = new URL(page.url()).origin;
  expect(fontRequests.every((name) => new URL(name).origin === landingOrigin)).toBe(true);

  const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
  const noScriptPage = await noScriptContext.newPage();
  await noScriptPage.goto('/');
  await expect(
    noScriptPage.getByRole('heading', { name: /Node, npm, and a dev server/ }),
  ).toBeVisible();
  await expect(noScriptPage.getByText(/Vite 7 HMR, Vite 8\/Rolldown/)).toBeVisible();
  await expect(noScriptPage.getByRole('link', { name: 'View rifty on GitHub' })).toHaveAttribute(
    'href',
    'https://forge.example.test/org/rifty',
  );
  await noScriptContext.close();
});

test('positions the open runtime honestly and shows only public Sandbox API', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByText(
      'rifty is an open, self-hostable Node-compatible runtime and WASI runner for Chromium.',
      { exact: true },
    ),
  ).toBeVisible();

  const publicApi = page.locator('.hero-code');
  await expect(publicApi.locator('.hero-code-line')).toHaveText([
    "import { createSandbox } from '@riftydev/sdk'",
    'export async function boot(workerUrl: string | URL) {',
    '  const sandbox = await createSandbox({',
    '    workerUrl,',
    '    skipServiceWorker: true,',
    '  })',
    '  sandbox.runtime.on((event) => {',
    "    if (event.type === 'stdout') console.log(event.chunk)",
    '  })',
    "  await sandbox.fs.writeFile('/hello.txt', 'hello')",
    '  await sandbox.runtime.eval(\'console.log("hello")\')',
    '  return sandbox',
    '}',
  ]);
  expect(await publicApi.innerText()).not.toMatch(/\.spawn\s*\(/);
  expect(await publicApi.evaluate((code) => code.scrollWidth <= code.clientWidth)).toBe(true);
  await expect(
    page.getByText(
      'The host supplies a bundled module-Worker URL. This eval-only example uses the public Sandbox façade: runtime.eval/on + fs. Command execution and preview routing are separate APIs.',
      { exact: true },
    ),
  ).toBeVisible();

  const quickStart = page.locator('.qs-code-body');
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
  await expect(page.getByRole('heading', { name: 'Vite host wiring' })).toBeVisible();

  const howItWorks = page.getByRole('link', { name: 'How it works', exact: true });
  await expect(howItWorks).toBeVisible();
  await expect(howItWorks).toHaveAttribute('href', '#arch');

  const runSomethingReal = page.getByRole('link', { name: 'Run something real', exact: true });
  await expect(runSomethingReal).toBeVisible();
  await expect(runSomethingReal).toHaveAttribute('href', 'https://play.example.test/');
});

test('keeps the animated hero terminal height stable while rows appear', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');

  const measured = page.locator('.hero-term, .hero-window');
  const before = await measured.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height),
  );

  await page.clock.runFor(3_200);
  await expect(page.locator('.hero-term-row')).toHaveCount(5);
  expect(
    await measured.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    ),
  ).toEqual(before);
});

test('offers proven preset outcomes before the architecture deep dive', async ({ page }) => {
  await page.goto('/');

  const cards = page.locator('[data-preset-card]');
  await expect(cards).toHaveCount(5);
  await expect(page.getByRole('link', { name: /Vite 7 \+ HMR/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Vite 8 \+ Rolldown/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Express \+ SQLite/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /CLI report/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Markdown SSG/ })).toBeVisible();
  await expect(page.locator('[data-preset-card="real-vite"]')).toHaveAttribute(
    'href',
    'https://play.example.test/?preset=real-vite&autorun=1',
  );
  await expect(page.locator('[data-preset-card="vite8"]')).toHaveAttribute(
    'href',
    'https://play.example.test/?preset=vite8&autorun=1',
  );
  await expect(page.locator('[data-preset-card="vite8"]')).toContainText(
    'production build and preview are also proven. HMR stays disabled.',
  );
  await expect(page.locator('[data-preset-card="express-sqlite"]')).toHaveAttribute(
    'href',
    'https://play.example.test/?preset=express-sqlite&autorun=1',
  );
  await expect(page.locator('[data-preset-card="cli-report"]')).toHaveAttribute(
    'href',
    'https://play.example.test/?preset=cli-report&autorun=1',
  );
  await expect(page.locator('[data-preset-card="markdown-ssg"]')).toHaveAttribute(
    'href',
    'https://play.example.test/?preset=markdown-ssg&autorun=1',
  );

  const sectionOrder = await page
    .locator('#demos, #arch')
    .evaluateAll((sections) => sections.map((section) => section.id));
  expect(sectionOrder).toEqual(['demos', 'arch']);
  const positions = await page
    .locator('#demos, #arch')
    .evaluateAll((sections) => sections.map((section) => section.getBoundingClientRect().top));
  expect(positions[0]).toBeLessThan(positions[1] ?? 0);
});

test('keeps primary navigation labels aligned with document order', async ({ page }) => {
  await page.goto('/');

  const links = page.getByRole('navigation', { name: 'Primary' }).getByRole('link');
  await expect(links).toHaveText(['Demos', 'Overview', 'Architecture', 'Quick start']);
  expect(
    await links.evaluateAll((items) => items.map((item) => item.getAttribute('href'))),
  ).toEqual(['#demos', '#what', '#arch', '#start']);
});

test('keeps the preset footer divider and labels on a balanced rhythm', async ({ page }) => {
  await page.goto('/');

  const dividers = page.locator('.demo-divider');
  await expect(dividers).toHaveCount(5);
  const rhythm = await page.locator('[data-preset-card]').evaluateAll((cards) =>
    cards.map((card) => {
      const body = card.querySelector<HTMLElement>('.demo-body');
      const divider = card.querySelector<HTMLElement>('.demo-divider');
      const meta = card.querySelector<HTMLElement>('.demo-meta');
      const action = card.querySelector<HTMLElement>('.demo-action');
      if (!body || !divider || !meta || !action) return null;
      const bodyBox = body.getBoundingClientRect();
      const dividerBox = divider.getBoundingClientRect();
      const metaBox = meta.getBoundingClientRect();
      const actionBox = action.getBoundingClientRect();
      return {
        copyToDivider: dividerBox.top - bodyBox.bottom,
        dividerToMeta: metaBox.top - dividerBox.bottom,
        metaToAction: actionBox.top - metaBox.bottom,
        dividerTop: dividerBox.top,
      };
    }),
  );

  expect(rhythm.every((item) => item !== null)).toBe(true);
  const measuredRhythm = rhythm.filter((item) => item !== null);
  expect(measuredRhythm.every((item) => item.copyToDivider >= 16)).toBe(true);
  expect(measuredRhythm.every((item) => item.dividerToMeta >= 11 && item.dividerToMeta <= 13)).toBe(
    true,
  );
  expect(measuredRhythm.every((item) => item.metaToAction >= 7 && item.metaToAction <= 9)).toBe(
    true,
  );
  const dividerTops = measuredRhythm.map((item) => item.dividerTop);
  expect(Math.max(...dividerTops) - Math.min(...dividerTops)).toBeLessThanOrEqual(1);
});

test('renders semantic landmarks and subsection headings', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('contentinfo')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'A Node-compatible runtime' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Embeddable Workbench' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'TypeScript + Git over VFS' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Cross-origin isolation + ESM Workers' }),
  ).toBeVisible();
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
  await expect(page.getByRole('button', { name: '01 Schema', exact: true })).toBeVisible();
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

test('renders raw WASI separately from the npm esbuild CLI gap', async ({ page }) => {
  await page.goto('/#arch');
  await expect(page.getByRole('button', { name: '01 Schema', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Raw WASI', exact: true }).click();
  const visibleBoard = page.locator('.exp-board:visible');
  await expect(visibleBoard.locator('[data-ed-file]')).toHaveText('run-wasi.js');
  await expect(visibleBoard.locator('[data-ed-code]')).toContainText('createWasiProcess');
  await expect(visibleBoard.locator('[data-ed-code]')).not.toContainText('esbuild');
  await expect(visibleBoard.locator('[data-pv-body]')).toContainText('raw WASI guest · exit 0');
  await expect(page.locator('[data-step-caption]')).not.toContainText('SAB');

  const esbuild = visibleBoard.locator('[data-node="esbuild"]');
  await expect(esbuild).toHaveAttribute('aria-label', 'esbuild JS API');
  await esbuild.click();
  const inspector = visibleBoard.locator('.exp-inspector');
  await expect(inspector.locator('.exp-ins-role')).toHaveText(
    "npm esbuild@0.28.0 transform APIs use the registry-attested esbuild-wasm adapter. The esbuild CLI/bin throws NotImplementedError('esbuild.cli').",
  );
});

test('shows the Workbench owner topology and keeps external registry egress separate', async ({
  page,
}) => {
  await page.goto('/#arch');
  await expect(page.getByRole('button', { name: '01 Schema', exact: true })).toBeVisible();

  const schema = page.locator('.exp-board:visible');
  await expect(schema.locator('[data-node="workbench"]')).toHaveAttribute(
    'aria-label',
    '@riftydev/workbench',
  );
  await expect(schema.locator('[data-node="owner"]')).toHaveAttribute(
    'aria-label',
    'workspace owner',
  );

  await page.getByRole('button', { name: '02 Realms', exact: true }).click();
  const external = page.locator('.exp-realms:visible [data-realm="ext"]');
  await expect(external).toContainText('EXTERNAL');
  await expect(external.locator('[data-lane-node="registry"]')).toBeVisible();
});

test('keeps secondary explorer labels at WCAG AA text contrast', async ({ page }) => {
  await page.goto('/#arch');
  await expect(page.getByRole('button', { name: '01 Schema', exact: true })).toBeVisible();

  for (const selector of ['.exp-view-num', '.exp-legend-grp', '.exp-node-kind']) {
    expect(await minimumTextContrast(page, selector), selector).toBeGreaterThanOrEqual(4.5);
  }
});

test('dims scenario controls without fading their interactive text', async ({ page }) => {
  await page.goto('/#arch');
  await page.getByRole('button', { name: 'npm install', exact: true }).click();

  const graphControls = page.locator('.exp-board:visible .exp-node[role="button"]');
  await expect(graphControls).not.toHaveCount(0);
  expect(
    await graphControls.evaluateAll((controls) =>
      Math.min(...controls.map((control) => Number(getComputedStyle(control).opacity))),
    ),
  ).toBe(1);
  await expect(page.locator('.exp-board:visible .exp-node-dim')).not.toHaveCount(0);
  expect(
    await minimumTextContrast(
      page,
      '.exp-board:visible .exp-node-dim .exp-node-label, .exp-board:visible .exp-node-dim .exp-node-kind',
    ),
  ).toBeGreaterThanOrEqual(4.5);

  await page.getByRole('button', { name: '02 Realms', exact: true }).click();
  const dimRealmControls = page.locator('.exp-realms:visible .exp-lc-dim');
  await expect(dimRealmControls).not.toHaveCount(0);
  expect(
    await dimRealmControls.evaluateAll((controls) =>
      Math.min(...controls.map((control) => Number(getComputedStyle(control).opacity))),
    ),
  ).toBe(1);
  expect(
    await minimumTextContrast(page, '.exp-realms:visible .exp-lc-dim .exp-lane-card-label'),
  ).toBeGreaterThanOrEqual(4.5);
});

test('keeps the landing usable and fails loudly when the explorer chunk cannot load', async ({
  page,
}) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.route('**/src/explorer/explorer.ts*', (route) => route.abort('failed'));

  await page.goto('/#arch');
  await expect(page.getByRole('heading', { name: 'How it actually works' })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  await expect
    .poll(() => errors.map((error) => error.message))
    .toContain('landing: architecture explorer failed to load');
  expect(
    await page.locator('#explorer-root').evaluate((root) => root.clientHeight),
  ).toBeGreaterThan(900);
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

  const copy = page.locator('.nav-right .nav-copy');
  const feedback = page.locator('.nav-right .nav-copy-feedback');
  await copy.click();
  await expect(copy).toHaveClass(/nav-copy-error/);
  await expect(copy).toHaveAttribute('aria-label', 'Copy failed. Select: npm i @riftydev/sdk');
  await expect(feedback).toHaveAttribute('role', 'status');
  await expect(feedback).toHaveText('Copy failed. Select the install command manually.');

  await copy.click();
  await expect(copy).toHaveClass(/nav-copy-done/);
  await expect(copy).not.toHaveClass(/nav-copy-error/);
  await expect(copy).toHaveAttribute('aria-label', 'Install command copied');
  await expect(feedback).toHaveText('Install command copied.');
});

test('keeps node drag distinct from click and exposes graph nodes to the keyboard', async ({
  page,
}) => {
  await page.goto('/#arch');
  await expect(page.getByRole('button', { name: '01 Schema', exact: true })).toBeVisible();

  const kernel = page.locator('.exp-board:visible [data-node="kernel"]');
  await expect(kernel).toHaveAttribute('role', 'button');
  await expect(kernel).toHaveAttribute('tabindex', '0');
  await kernel.focus();
  await kernel.press('Enter');
  await expect(kernel).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.exp-board:visible .exp-inspector')).toContainText('kernel');
  await kernel.press('Space');
  await expect(kernel).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.exp-board:visible .exp-inspector')).not.toContainText('kernel');

  const box = await kernel.boundingBox();
  expect(box).not.toBeNull();
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 24, y + 12, { steps: 4 });
  await page.mouse.up();
  await page.mouse.move(1, 1);
  await expect(page.locator('.exp-board:visible .exp-inspector')).not.toContainText('kernel');
});

test('closes the mobile drawer for every same-page navigation exit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.locator('#nav-mobile-panel')).toBeVisible();
  await page.getByRole('link', { name: 'Try demos', exact: true }).click();
  await expect(page.locator('#nav-mobile-panel')).toBeHidden();

  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.setViewportSize({ width: 1_000, height: 844 });
  await expect(page.locator('#nav-mobile-panel')).toBeHidden();
  await expect(page.locator('.nav-menu-button')).toHaveAttribute('aria-expanded', 'false');
});

test('renders the favicon and respects reduced-motion preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  await expect(page.locator('.hero-term-row')).toHaveCount(5);
  const animationNames = await page
    .locator('.hero-eyebrow-dot, .hero-live-dot, .hero-term-cursor')
    .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).animationName));
  expect(animationNames).toEqual(['none', 'none', 'none']);

  const contrastRatios = await page
    .locator('.hero-term-prompt, .hero-term-dim')
    .evaluateAll((elements) => {
      const rgb = (value: string): number[] =>
        (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = ([r = 0, g = 0, b = 0]: number[]): number => {
        const linear = [r, g, b].map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
      };
      const terminal = document.querySelector('.hero-term');
      if (!terminal) return [];
      const background = luminance(rgb(getComputedStyle(terminal).backgroundColor));
      return elements.map((element) => {
        const foreground = luminance(rgb(getComputedStyle(element).color));
        return (
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        );
      });
    });
  expect(Math.min(...contrastRatios)).toBeGreaterThanOrEqual(4.5);

  const favicon = await page.evaluate(async () => {
    const image = new Image();
    image.src = '/favicon.svg';
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  });
  expect(favicon.width).toBeGreaterThan(0);
  expect(favicon.height).toBe(favicon.width);
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

    const tryDemos = page.getByRole('link', { name: 'Try demos', exact: true });
    await expect(tryDemos).toBeVisible();
    await expect(tryDemos).toHaveAttribute('href', '#demos');
    await expect(page.locator('[data-preset-card]')).toHaveCount(5);

    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      cardWidths: Array.from(document.querySelectorAll<HTMLElement>('[data-preset-card]')).map(
        (card) => card.getBoundingClientRect().width,
      ),
    }));
    expect(layout.page).toBeLessThanOrEqual(layout.viewport);
    expect(layout.cardWidths.every((width) => width <= layout.viewport)).toBe(true);
    const tryDemosBox = await tryDemos.boundingBox();
    expect(tryDemosBox).not.toBeNull();
    expect(tryDemosBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((tryDemosBox?.x ?? 0) + (tryDemosBox?.width ?? 0)).toBeLessThanOrEqual(layout.viewport);
    expect(tryDemosBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    const brandHeight = await page
      .getByRole('link', { name: 'rifty', exact: true })
      .evaluate((brand) => brand.getBoundingClientRect().height);
    expect(brandHeight).toBeGreaterThanOrEqual(44);

    const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
    await menu.click();
    await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Copy install command/ })).toBeVisible();
    const panelBox = await page.locator('#nav-mobile-panel').boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((panelBox?.x ?? 0) + (panelBox?.width ?? 0)).toBeLessThanOrEqual(layout.viewport);
    await page.keyboard.press('Escape');
    await expect(page.locator('#nav-mobile-panel')).toBeHidden();

    await page.goto('/#arch');
    const realms = page.getByRole('button', { name: '02 Realms', exact: true });
    await expect(realms).toHaveAttribute('aria-pressed', 'true');
    expect(
      await page
        .locator('.exp-lanes')
        .evaluate((lanes) => getComputedStyle(lanes).gridTemplateColumns.split(' ').length),
    ).toBe(1);
    expect(
      await page
        .locator('.exp-lane-card')
        .evaluateAll((cards) => cards.every((card) => card.getBoundingClientRect().height >= 44)),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);

    const schema = page.getByRole('button', { name: '01 Schema', exact: true });
    await schema.click();
    expect(
      await page
        .locator('.exp-reset-btn')
        .evaluate((reset) => reset.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
  });
}
