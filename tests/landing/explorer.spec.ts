import { type Page, expect, test } from '@playwright/test';
import { minimumTextContrast } from './contrast';

const HINT =
  '// selected runtime topology — solid = import · arrow = data · dashed = control · dotted = IPC';

function chip(page: Page, name: string) {
  return page.locator('.exp-bar').getByRole('button', { name, exact: true });
}

async function openExplorer(page: Page): Promise<void> {
  await page.goto('/#arch');
  await expect(page.locator('.exp-node')).toHaveCount(20);
}

// Fake timers from before navigation; pause once mounted so scenario steps
// advance only through page.clock.runFor.
async function openExplorerPaused(page: Page): Promise<void> {
  await page.clock.install();
  await openExplorer(page);
  await page.clock.pauseAt(Date.now() + 10 * 60_000);
}

async function progressWidth(page: Page): Promise<number> {
  return page
    .locator('.exp-progress-fill')
    .evaluate((fill) => Number.parseFloat((fill as HTMLElement).style.width));
}

test('renders the whole schema by default with every module interactive', async ({ page }) => {
  await openExplorer(page);

  await expect(chip(page, 'Whole schema')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.exp-chip')).toHaveCount(7);
  for (const name of [
    'Boot',
    'npm install',
    'Express + preview',
    'Vite HMR',
    'Raw WASI',
    'Child sync fs (SAB)',
  ]) {
    await expect(chip(page, name)).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(page.locator('[data-scn-title]')).toHaveText('Whole schema');
  await expect(page.locator('.exp-inspector')).toHaveText(HINT);
  await expect(page.locator('.exp-node-dim')).toHaveCount(0);
  await expect(page.locator('.exp-node[role="button"][tabindex="0"]')).toHaveCount(20);
  await expect(page.locator('.exp-edges line')).toHaveCount(30);
});

test('plays a scenario step by step and replays from the active chip', async ({ page }) => {
  await openExplorerPaused(page);

  await chip(page, 'npm install').click();
  await expect(chip(page, 'npm install')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'Whole schema')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-scn-title]')).toHaveText('npm install express');
  await expect(page.locator('[data-step-num]')).toContainText('1 / 6');
  await expect(page.locator('[data-step-num]')).toContainText('$ npm install express');
  await expect(page.locator('[data-step-caption]')).toHaveText(
    'Submit npm install express through the Workbench terminal',
  );
  await expect(page.locator('[data-node="terminal"]')).toHaveClass(/exp-node-cur/);
  const firstWidth = await progressWidth(page);
  expect(firstWidth).toBeGreaterThan(0);

  await page.clock.runFor(1400);
  await expect(page.locator('[data-step-num]')).toContainText('2 / 6');
  await expect(page.locator('[data-step-caption]')).toHaveText(
    'The workspace owner executes the shell command',
  );
  await expect(page.locator('[data-node="owner"]')).toHaveClass(/exp-node-cur/);
  await expect(page.locator('[data-node="terminal"]')).toHaveClass(/exp-node-tc/);
  expect(await progressWidth(page)).toBeGreaterThan(firstWidth);

  await expect(page.locator('.exp-node-dim')).not.toHaveCount(0);
  expect(
    await page
      .locator('.exp-node')
      .evaluateAll((nodes) => Math.min(...nodes.map((n) => Number(getComputedStyle(n).opacity)))),
  ).toBe(1);
  expect(await minimumTextContrast(page, '.exp-node-dim .exp-node-label')).toBeGreaterThanOrEqual(
    4.5,
  );

  await chip(page, 'npm install').click();
  await expect(page.locator('[data-step-num]')).toContainText('1 / 6');
  await expect(page.locator('[data-node="terminal"]')).toHaveClass(/exp-node-cur/);

  await chip(page, 'Whole schema').click();
  await expect(page.locator('[data-scn-title]')).toHaveText('Whole schema');
  await expect(page.locator('[data-step-num]')).toHaveText('');
  await expect(page.locator('.exp-node-dim')).toHaveCount(0);
  expect(await progressWidth(page)).toBe(0);
});

test('keeps raw WASI free of SAB claims and flags the esbuild CLI gap', async ({ page }) => {
  await openExplorerPaused(page);

  await chip(page, 'Raw WASI').click();
  await expect(page.locator('[data-scn-title]')).toHaveText('Run a raw WASI guest');
  for (let step = 1; step <= 5; step++) {
    await expect(page.locator('[data-step-num]')).toContainText(`${step} / 5`);
    await expect(page.locator('[data-step-caption]')).not.toContainText('SAB');
    if (step < 5) await page.clock.runFor(1400);
  }
  await expect(page.locator('[data-node="sab"]')).toHaveClass(/exp-node-dim/);

  const esbuild = page.locator('[data-node="esbuild"]');
  await expect(esbuild).toHaveAttribute('aria-label', 'esbuild JS API (partial)');
  await expect(esbuild.locator('.exp-node-warn')).toHaveText('⚠');
  await expect(esbuild.locator('.exp-node-warn')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.exp-node-warn')).toHaveCount(1);

  await esbuild.click();
  await expect(esbuild).toHaveAttribute('aria-pressed', 'true');
  await expect(esbuild).toHaveClass(/exp-node-pin/);
  await expect(page.locator('.exp-inspector .exp-ins-name')).toHaveText('esbuild JS API');
  await expect(page.locator('.exp-inspector .exp-ins-realm')).toHaveText('WORKERS');
  await expect(page.locator('.exp-inspector .exp-ins-role')).toHaveText(
    "npm esbuild@0.28.0 transform APIs use the registry-attested esbuild-wasm adapter. The esbuild CLI/bin throws NotImplementedError('esbuild.cli').",
  );
});

test('highlights adjacency on hover and restores on leave', async ({ page }) => {
  await openExplorer(page);

  await page.locator('[data-node="kernel"]').hover();
  await expect(page.locator('[data-node="kernel"]')).toHaveClass(/exp-node-cur/);
  for (const neighbour of ['owner', 'runtimejs', 'runtimewasi']) {
    await expect(page.locator(`[data-node="${neighbour}"]`)).toHaveClass(/exp-node-nb/);
  }
  await expect(page.locator('[data-node="sw"]')).toHaveClass(/exp-node-dim/);
  await expect(page.locator('.exp-node-nb')).toHaveCount(3);
  await expect(page.locator('.exp-node-dim')).toHaveCount(16);
  await expect(page.locator('.exp-inspector .exp-ins-name')).toHaveText('kernel');
  await expect(page.locator('.exp-edge-hot')).toHaveCount(3);

  await page.mouse.move(0, 0);
  await expect(page.locator('.exp-node-dim')).toHaveCount(0);
  await expect(page.locator('.exp-node-nb')).toHaveCount(0);
  await expect(page.locator('.exp-edge-hot')).toHaveCount(0);
  await expect(page.locator('.exp-inspector')).toHaveText(HINT);
});

test('pins modules from the keyboard', async ({ page }) => {
  await openExplorer(page);

  const kernel = page.locator('[data-node="kernel"]');
  await kernel.focus();
  await kernel.press('Enter');
  await expect(kernel).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.exp-inspector')).toContainText('kernel');
  await expect(page.locator('.exp-inspector .exp-ins-role')).toContainText(
    'Process / scheduling / IPC core',
  );

  await kernel.press('Space');
  await expect(kernel).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.exp-inspector')).not.toContainText('kernel');
  await expect(page.locator('.exp-inspector')).toHaveText(HINT);
});

test('lays out five realm zones and lights the current realm during a scenario', async ({
  page,
}) => {
  await openExplorerPaused(page);

  await expect(page.locator('[data-zone]')).toHaveCount(5);
  await expect(page.locator('[data-zone] .exp-zname')).toHaveText([
    'PAGE',
    'WORKERS',
    'SERVICE WORKER',
    'PREVIEW IFRAME',
    'EXTERNAL',
  ]);
  await expect(page.locator('.exp-zone-on')).toHaveCount(0);

  await chip(page, 'Express + preview').click();
  await expect(page.locator('[data-zone="worker"]')).toHaveClass(/exp-zone-on/);
  await expect(page.locator('.exp-zone-on')).toHaveCount(1);

  await page.clock.runFor(2800);
  await expect(page.locator('[data-step-num]')).toContainText('3 / 7');
  await expect(page.locator('[data-node="preview"]')).toHaveClass(/exp-node-cur/);
  await expect(page.locator('[data-zone="iframe"]')).toHaveClass(/exp-zone-on/);
  await expect(page.locator('[data-zone="worker"]')).not.toHaveClass(/exp-zone-on/);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]) {
  test(`pans the board instead of overflowing the page at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openExplorer(page);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const board = page.locator('.exp-board');
    await expect(board).toHaveClass(/exp-board-scroll/);
    expect(await board.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await board.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');

    expect(
      await page
        .locator('.exp-node')
        .evaluateAll((nodes) => Math.min(...nodes.map((n) => n.getBoundingClientRect().height))),
    ).toBeGreaterThanOrEqual(28);
    expect(
      await page
        .locator('.exp-chip')
        .evaluateAll((chips) => Math.min(...chips.map((c) => c.getBoundingClientRect().height))),
    ).toBeGreaterThanOrEqual(32);

    expect(
      await page.evaluate(
        () =>
          typeof (window as Window & { __riftyDisposeExplorer?: unknown }).__riftyDisposeExplorer,
      ),
    ).toBe('function');
  });
}

test('drops the current-node pulse under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openExplorerPaused(page);

  await chip(page, 'Boot').click();
  const current = page.locator('.exp-node-cur');
  await expect(current).toHaveCount(1);
  const animation = await current.evaluate((node) => {
    const style = getComputedStyle(node);
    return { name: style.animationName, duration: style.animationDuration };
  });
  // Chromium serializes computed durations in seconds (0.01ms → "0.00001s").
  const seconds = animation.duration.endsWith('ms')
    ? Number.parseFloat(animation.duration) / 1000
    : Number.parseFloat(animation.duration);
  expect(animation.name === 'none' || seconds <= 0.001, JSON.stringify(animation)).toBe(true);
});
