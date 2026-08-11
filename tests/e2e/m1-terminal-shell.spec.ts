import { type Locator, type Page, expect, test } from '@playwright/test';
import {
  type TerminalSessionTarget,
  bootProjectFiles,
  expectTerminalContains,
  expectViteDevServerReady,
  insertTerminalLineSettled,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

const terminalSessionTabs = (page: Page): Locator =>
  page.locator('.rf-terminal-tabs > .rf-terminal-tab');

function terminalTab(page: Page, target: TerminalSessionTarget): Locator {
  return page.locator(`.rf-terminal-tab__select[data-session-id="${target.sessionId}"]`);
}

function terminalTabContainer(page: Page, target: TerminalSessionTarget): Locator {
  return page.locator('.rf-terminal-tab').filter({ has: terminalTab(page, target) });
}

async function firstTerminalSession(page: Page): Promise<TerminalSessionTarget> {
  const tab = terminalSessionTabs(page)
    .first()
    .locator('.rf-terminal-tab__select[data-session-id]');
  await expect(tab).toBeVisible();
  const sessionId = await tab.getAttribute('data-session-id');
  if (sessionId === null) throw new Error('terminal tab has no session id');
  return Object.freeze({ sessionId });
}

async function activeTerminalSession(page: Page): Promise<TerminalSessionTarget> {
  const tab = page.locator(
    '.rf-terminal-tabs .rf-terminal-tab__select[data-session-id][aria-selected="true"]',
  );
  await expect(tab).toHaveCount(1);
  const sessionId = await tab.getAttribute('data-session-id');
  if (sessionId === null) throw new Error('active terminal tab has no session id');
  return Object.freeze({ sessionId });
}

async function closeTerminal(page: Page, target: TerminalSessionTarget): Promise<void> {
  const close = terminalTabContainer(page, target).locator('.rf-terminal-tab__close');
  await expect(close).toBeVisible();
  await close.click();
}

const DEFAULT_VITE_READY = /VITE v.*ready/u;

async function expectDefaultViteReady(page: Page, timeout = 60_000): Promise<void> {
  await expectTerminalContains(page, DEFAULT_VITE_READY, timeout);
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
    await bootProjectFiles(page);
    const primary = await firstTerminalSession(page);

    // Bottom panel header shows terminal sessions plus the permanent Problems tab.
    await expect(terminalTab(page, primary)).toBeVisible();
    await expect(page.locator('[data-testid="problems-tab"]')).toBeVisible();
    await expect(page.locator('[data-testid="terminal-mode-hint"]')).toContainText(
      'Commands run in /;',
    );
    await expect(page.locator('[data-testid="terminal-mode-hint"]')).toContainText(
      'Use + to open another shell while a program is running.',
    );
    await expectDefaultViteReady(page);
    await expect(terminalSessionTabs(page)).toHaveCount(1);
    await expect(terminalTab(page, primary)).toHaveAttribute('aria-selected', 'true');
  });

  test('instant preset boots straight to vite — deps pre-seeded, NO install (ADR-0135)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await bootProjectFiles(page);
    await expectDefaultViteReady(page);

    // Fresh browser context = empty OPFS = no stamp: an instant preset's deps are
    // PRE-SEEDED from the baked snapshot (owner-seed), so the dev line just runs.
    // Faithful: `vite` does NOT install — no `npm: +` lines ever — and serves.
    await expectViteDevServerReady(page, 5174, 60_000);
    const buf = await terminalBuffer(page);
    expect(buf).not.toMatch(/npm: \+ /);
    expect(buf).not.toContain('installing');
  });

  test('new terminal opens a separate idle shell while Vite keeps running', async ({ page }) => {
    await bootProjectFiles(page);
    await expectDefaultViteReady(page);
    const primary = await firstTerminalSession(page);

    await openShellTerminal(page);

    await expect(terminalSessionTabs(page)).toHaveCount(2);
    await expect(terminalTabContainer(page, primary)).toHaveAttribute('data-running', 'true');

    await runTerminalLine(page, 'echo hello-from-shell');

    await expectTerminalContains(page, 'hello-from-shell');
    expect(await terminalBuffer(page)).not.toContain('[worker ready]');
  });

  test('new terminal receives keyboard focus immediately', async ({ page }) => {
    await bootProjectFiles(page);
    await expectDefaultViteReady(page);

    await openShellTerminal(page, { focus: false });

    await expect.poll(() => terminalOwnsFocus(page), { timeout: 2_000 }).toBe(true);
  });

  test('empty Enter keeps the running Vite terminal quiet', async ({ page }) => {
    await bootProjectFiles(page);
    // Tool-owned readiness anchors the terminal in the steady streaming state.
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
    await bootProjectFiles(page);
    await expectDefaultViteReady(page);
    const shell = await openShellTerminal(page);
    await expect
      .poll(async () => terminalPromptCount(await terminalBuffer(page, shell)), {
        timeout: 5_000,
      })
      .toBeGreaterThan(0);
    const before = await terminalBuffer(page, shell);

    await insertTerminalLineSettled(page, '', 5_000, shell);
    await insertTerminalLineSettled(page, '', 5_000, shell);
    await insertTerminalLineSettled(page, '', 5_000, shell);

    const after = await terminalBuffer(page, shell);
    expect(terminalPromptCount(after)).toBe(terminalPromptCount(before) + 3);
    expect(after).not.toMatch(/(?:^|\n)> \n\n> /u);
  });

  test('terminal tabs switch between their own buffers', async ({ page }) => {
    await bootProjectFiles(page);
    await expectDefaultViteReady(page);
    const primary = await firstTerminalSession(page);

    const shell = await openShellTerminal(page);
    await runTerminalLine(page, 'echo hello-from-terminal-2');
    await expectTerminalContains(page, 'hello-from-terminal-2');

    await terminalTab(page, primary).click();
    await expect(terminalTab(page, primary)).toHaveAttribute('aria-selected', 'true');
    await expectDefaultViteReady(page);
    expect(await terminalBuffer(page)).not.toContain('hello-from-terminal-2');

    await terminalTab(page, shell).click();
    await expect(terminalTab(page, shell)).toHaveAttribute('aria-selected', 'true');
    await expectTerminalContains(page, 'hello-from-terminal-2');
  });

  test('closing an idle terminal returns to the running terminal cleanly', async ({ page }) => {
    await bootProjectFiles(page);
    await expectDefaultViteReady(page);
    const primary = await firstTerminalSession(page);

    const shell = await openShellTerminal(page);
    await closeTerminal(page, shell);

    await expect(terminalSessionTabs(page)).toHaveCount(1);
    await expect(terminalTab(page, primary)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.rf-terminal-slot[data-active="true"]')).toHaveCount(1);
    await expectDefaultViteReady(page);
  });

  test('closing the active idle terminal focuses the previous terminal tab', async ({ page }) => {
    await bootProjectFiles(page);
    await firstTerminalSession(page);

    const previous = await openShellTerminal(page);
    await page.getByRole('button', { name: 'New terminal' }).click();
    await expect(terminalSessionTabs(page)).toHaveCount(3);
    const active = await activeTerminalSession(page);
    await expect(terminalTab(page, active)).toHaveAttribute('aria-selected', 'true');

    await closeTerminal(page, active);

    await expect(terminalSessionTabs(page)).toHaveCount(2);
    await expect(terminalTab(page, previous)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => terminalOwnsFocus(page), { timeout: 2_000 }).toBe(true);
  });

  test('new-terminal button stays attached while Problems stays pinned left', async ({ page }) => {
    await bootProjectFiles(page);
    await firstTerminalSession(page);

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
    await bootProjectFiles(page);
    // ADR-0148: the chosen project-files starter boots its dev server in the owner — wait up.
    // Readiness = the LIVE pill (derived from the listening-port set), never a
    // rifty-authored terminal marker.
    await expectViteDevServerReady(page, 5174, 90_000);

    await openShellTerminal(page);
    await runTerminalLine(page, 'npm run vite');

    // The owner npm resolves the seeded `vite` script through the shell/bin path,
    // so this proves package scripts do not fall back to the old co-resident
    // special-case or a missing-script stub.
    await expectViteDevServerReady(page, 5173, 30_000);
    const buf = await terminalBuffer(page);
    expect(buf).not.toContain("unknown subcommand 'run'");
    expect(buf).not.toContain('missing script');
    expect(buf).not.toContain('dev server already running');
  });
});
