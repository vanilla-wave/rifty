import { type Page, expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

const terminalSessionTabs = (page: Page) =>
  page.locator('.rf-terminal-tab').filter({ hasText: /^Terminal \d+/ });

const DEFAULT_VITE_READY = /VITE v.*ready/u;

async function expectDefaultViteReady(page: Page, timeout = 60_000): Promise<void> {
  await expectTerminalContains(page, DEFAULT_VITE_READY, timeout);
}

async function fetchPreviewOk(page: Page, port: number): Promise<boolean> {
  return page.evaluate(async (targetPort) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4_000);
    try {
      const r = await fetch(`/preview/${targetPort}/`, { cache: 'no-store', signal: ac.signal });
      return r.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }, port);
}

async function terminalOwnsFocus(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const terminal = document.querySelector('[data-testid="terminal"]');
    const active = document.activeElement;
    return terminal != null && active != null && terminal.contains(active);
  });
}

function terminalPromptCount(text: string): number {
  return text.match(/(?:^|\n)> /gu)?.length ?? 0;
}

test.describe('M1 - terminal shell', () => {
  test.describe.configure({ timeout: 90_000 });

  test('bottom panel is a shell terminal and prestarts Vite visibly', async ({ page }) => {
    await page.goto('/');

    // Bottom panel header shows terminal sessions plus the permanent Problems tab.
    await expect(page.getByRole('tab', { name: 'Terminal 1' })).toBeVisible();
    await expect(page.locator('[data-testid="problems-tab"]')).toBeVisible();
    await expect(page.locator('[data-testid="terminal-mode-hint"]')).toContainText(
      'Commands run in /scratch',
    );
    await expectDefaultViteReady(page);
    await expect(terminalSessionTabs(page)).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'Terminal 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('instant preset boots straight to vite — deps pre-seeded, NO install (ADR-0135)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/');

    // Fresh browser context = empty OPFS = no stamp: an instant preset's deps are
    // PRE-SEEDED from the baked snapshot (owner-seed), so the dev line just runs.
    // Faithful: `vite` does NOT install — no `npm: +` lines ever — and serves.
    await expectDefaultViteReady(page);
    await expect
      .poll(() => fetchPreviewOk(page, 5174), {
        timeout: 60_000,
        intervals: [500, 1_000, 2_000],
      })
      .toBe(true);
    const buf = await terminalBuffer(page);
    expect(buf).not.toMatch(/npm: \+ /);
    expect(buf).not.toContain('installing');
  });

  test('new terminal opens a separate idle shell while Vite keeps running', async ({ page }) => {
    await page.goto('/');
    await expectDefaultViteReady(page);

    await openShellTerminal(page);

    await expect(terminalSessionTabs(page)).toHaveCount(2);
    await expect(terminalSessionTabs(page).first()).toHaveAttribute('data-running', 'true');

    await runTerminalLine(page, 'echo hello-from-shell');

    await expectTerminalContains(page, 'hello-from-shell');
    expect(await terminalBuffer(page)).not.toContain('[worker ready]');
  });

  test('new terminal receives keyboard focus immediately', async ({ page }) => {
    await page.goto('/');
    await expectDefaultViteReady(page);

    await openShellTerminal(page, { focus: false });

    await expect.poll(() => terminalOwnsFocus(page), { timeout: 2_000 }).toBe(true);
  });

  test('empty Enter keeps the running Vite terminal quiet', async ({ page }) => {
    await page.goto('/');
    await expectDefaultViteReady(page);
    const before = await terminalBuffer(page);

    await page.locator('[data-testid="terminal"]').click();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);

    const after = await terminalBuffer(page);
    expect(after).not.toContain('terminal is busy');
    expect(terminalPromptCount(after)).toBe(terminalPromptCount(before) + 1);
    expect(after).not.toMatch(/(?:^|\n)> \n\n> /u);
  });

  test('empty Enter in an idle terminal submits without blank prompt rows', async ({ page }) => {
    await page.goto('/');
    await expectDefaultViteReady(page);
    await openShellTerminal(page);
    const before = await terminalBuffer(page);

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);

    const after = await terminalBuffer(page);
    expect(terminalPromptCount(after)).toBe(terminalPromptCount(before) + 3);
    expect(after).not.toMatch(/(?:^|\n)> \n\n> /u);
  });

  test('terminal tabs switch between their own buffers', async ({ page }) => {
    await page.goto('/');
    await expectDefaultViteReady(page);

    await openShellTerminal(page);
    await runTerminalLine(page, 'echo hello-from-terminal-2');
    await expectTerminalContains(page, 'hello-from-terminal-2');

    await page.getByRole('tab', { name: 'Terminal 1' }).click();
    await expect(page.getByRole('tab', { name: 'Terminal 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expectDefaultViteReady(page);
    expect(await terminalBuffer(page)).not.toContain('hello-from-terminal-2');

    await page.getByRole('tab', { name: 'Terminal 2' }).click();
    await expect(page.getByRole('tab', { name: 'Terminal 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expectTerminalContains(page, 'hello-from-terminal-2');
  });

  test('closing an idle terminal returns to the running terminal cleanly', async ({ page }) => {
    await page.goto('/');
    await expectDefaultViteReady(page);

    await openShellTerminal(page);
    await page.getByRole('button', { name: 'Close Terminal 2' }).click();

    await expect(terminalSessionTabs(page)).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'Terminal 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('.rf-terminal-slot[data-active="true"]')).toHaveCount(1);
    await expectDefaultViteReady(page);
  });

  test('closing the active idle terminal focuses the previous terminal tab', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('tab', { name: 'Terminal 1' })).toBeVisible();

    await openShellTerminal(page);
    await page.getByRole('button', { name: 'New terminal' }).click();
    await expect(page.getByRole('tab', { name: 'Terminal 3' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.getByRole('button', { name: 'Close Terminal 3' }).click();

    await expect(terminalSessionTabs(page)).toHaveCount(2);
    await expect(page.getByRole('tab', { name: 'Terminal 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect.poll(() => terminalOwnsFocus(page), { timeout: 2_000 }).toBe(true);
  });

  test('new-terminal button stays attached while Problems stays pinned left', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('tab', { name: 'Terminal 1' })).toBeVisible();

    await openShellTerminal(page);

    const firstTabBox = await terminalSessionTabs(page).first().boundingBox();
    const lastTabBox = await terminalSessionTabs(page).last().boundingBox();
    const actionBox = await page.getByRole('button', { name: 'New terminal' }).boundingBox();
    const problemsBox = await page.locator('[data-testid="problems-tab"]').boundingBox();
    const tabsbarBox = await page.locator('.rf-terminal-tabsbar').boundingBox();

    expect(firstTabBox).not.toBeNull();
    expect(lastTabBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    expect(problemsBox).not.toBeNull();
    expect(tabsbarBox).not.toBeNull();
    const gap = Math.abs((actionBox?.x ?? 0) - ((lastTabBox?.x ?? 0) + (lastTabBox?.width ?? 0)));
    expect(gap).toBeLessThanOrEqual(1);
    expect(problemsBox?.x ?? 0).toBeLessThan(firstTabBox?.x ?? 0);
    const leftGap = Math.abs((problemsBox?.x ?? 0) - (tabsbarBox?.x ?? 0));
    expect(leftGap).toBeLessThanOrEqual(1);
  });

  test('npm run vite resolves the seeded script through the installed Vite CLI', async ({
    page,
  }) => {
    await page.goto('/');
    // ADR-0148: the default preset boots its dev server in the owner — wait up.
    await expectTerminalContains(page, 'starting dev server on port', 15_000);

    await openShellTerminal(page);
    await runTerminalLine(page, 'npm run vite');

    // The owner npm resolves the seeded `vite` script through the shell/bin path,
    // so this proves package scripts do not fall back to the old co-resident
    // special-case or a missing-script stub.
    await expectTerminalContains(page, '[vite] dev server ready on port 5173', 30_000);
    const buf = await terminalBuffer(page);
    expect(buf).not.toContain("unknown subcommand 'run'");
    expect(buf).not.toContain('missing script');
    expect(buf).not.toContain('dev server already running');
  });
});
