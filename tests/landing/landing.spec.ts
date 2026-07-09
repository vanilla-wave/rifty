import { expect, test } from '@playwright/test';

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
    '// public SDK: eval + filesystem + events',
    "import { createSandbox } from '@riftydev/sdk'",
    'const sandbox = await createSandbox({',
    '  workerUrl,',
    '  skipServiceWorker: true,',
    '})',
    'sandbox.runtime.on((event) => {',
    "  if (event.type === 'stdout') console.log(event.chunk)",
    '})',
    "await sandbox.fs.writeFile('/hello.js', 'console.log(\"hello\")')",
    'await sandbox.runtime.eval(\'console.log("hello")\')',
  ]);
  expect(await publicApi.innerText()).not.toMatch(/\.spawn\s*\(/);
  expect(await publicApi.evaluate((code) => code.scrollWidth <= code.clientWidth)).toBe(true);
  await expect(
    page.getByText(
      'Shown API is the public Sandbox façade: runtime.eval/on + fs. Command execution lives at @riftydev/sdk/shell and preview routing at @riftydev/sdk/service-worker — neither is a Sandbox method.',
      { exact: true },
    ),
  ).toBeVisible();

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
  await expect(page.locator('.hero-term-row')).toHaveCount(6);
  expect(
    await measured.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    ),
  ).toEqual(before);
});

test('offers proven preset outcomes before the architecture deep dive', async ({ page }) => {
  await page.goto('/');

  const cards = page.locator('[data-preset-card]');
  await expect(cards).toHaveCount(4);
  await expect(page.getByRole('link', { name: /Vite 7 \+ npm/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Express \+ SQLite/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /CLI report/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Markdown SSG/ })).toBeVisible();
  await expect(page.locator('[data-preset-card="real-vite"]')).toHaveAttribute(
    'href',
    'https://play.example.test/?preset=real-vite&autorun=1',
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

test('keeps the preset footer divider and labels on a balanced rhythm', async ({ page }) => {
  await page.goto('/');

  const dividers = page.locator('.demo-divider');
  await expect(dividers).toHaveCount(4);
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
    await expect(page.locator('[data-preset-card]')).toHaveCount(4);

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
