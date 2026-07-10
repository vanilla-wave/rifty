import { type Page, expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  pickStarter,
  runTerminalLineSettled,
  terminalBuffer,
} from './helpers/playground.ts';

// Project-first cold boot auto-opens the chooser. Closing it adopts the real
// hidden-empty scratch; `isVisible()` does NOT wait, so wait before closing.
async function dismissChooser(page: Page): Promise<void> {
  const launcher = page.locator('[data-testid="launcher"]');
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  await page.locator('.rf-launcher__close').click();
  await expect(launcher).toHaveCount(0, { timeout: 5_000 });
  // Closing adopts + respawns onto the authoritative hidden-empty scratch.
  // Do not type into the pre-close owner while that hand-off is still in flight.
  await expect(page.locator('.rf-app')).toHaveAttribute('data-workspace-owner', 'workspace', {
    timeout: 30_000,
  });
  await expect(page.locator('[data-action="open-launcher"]')).toContainText('Empty project', {
    timeout: 30_000,
  });
}

/**
 * The frictionless-first-poke epic Done-gate: a "curious first 15 minutes" walk.
 * A developer pokes the terminal with reflexive moves — they must WORK or fail
 * loud+directed, never with a bare MODULE_NOT_FOUND / command not found /
 * unknown subcommand that reads as fundamentally broken.
 */
test.describe('M0 - curious first 15 minutes', () => {
  // Serial: both tests cold-boot the same dev server; parallel contention over
  // the shared owner garbles the terminal buffer reads.
  test.describe.configure({ mode: 'serial' });

  test('launcher → Project files → real CSS edit → a second working shell', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    const launcher = page.locator('[data-testid="launcher"]');
    await expect(launcher).toBeVisible({ timeout: 30_000 });

    // No unfinished affordances on the first screen; cross-surface Node identity
    // follows the parity target and Vite 8 remains explicitly experimental.
    await expect(page.locator('[data-action="share"]')).toHaveCount(0);
    await expect(launcher.getByText('Node 24 runtime')).toBeVisible();
    await expect(launcher.locator('[data-preset="vite8"]')).toContainText(/experimental/i);
    await launcher.getByRole('button', { name: /^Projects/ }).click();
    await expect(launcher.locator('input[type="search"]')).toHaveCount(0);
    await expect(launcher.locator('.rf-launcher__count')).toHaveText('0');
    await launcher.getByRole('button', { name: 'Starters', exact: true }).click();
    await expect(launcher.locator('input[placeholder="Search starters"]')).toBeVisible();

    await pickStarter(page, 'project-files');
    await expectViteDevServerReady(page, 5174, 90_000, 0);

    // Share is gone from the palette as well as the header.
    await page.locator('[data-action="open-palette"]').click();
    const palette = page.locator('[data-testid="command-palette"]');
    await expect(palette).toBeVisible();
    await palette.locator('input').fill('share');
    await expect(palette.locator('.rf-palette__item', { hasText: /share/i })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Terminal 1 is owned by Vite, so the persistent visible mode hint directs
    // the user to a second shell even when Vite clears its own xterm output.
    await expect(
      page.locator('.rf-terminal-slot[data-active="true"] [data-testid="terminal-mode-hint"]'),
    ).toContainText('Use + to open another shell while a program is running.');
    const devGreeting = await terminalBuffer(page, 0);
    expect(devGreeting).toContain('rifty · node v24.0.0 · npm in your browser');
    expect(devGreeting).not.toContain('try:');

    // Project Files' advertised CSS is now part of the real module graph: edit
    // that file through Monaco and observe Vite update the preview.
    await page.getByRole('tab', { name: /workspace\.css/ }).click();
    const editorInput = page.locator('[data-testid="editor"] textarea.inputarea').first();
    await editorInput.click({ force: true });
    await page.keyboard.press('ControlOrMeta+A');
    // Monaco's hidden textarea can preserve the model selection when
    // `insertText` fires, so this may prepend rather than replace. `!important`
    // makes the user's new declaration observably win either way.
    await page.keyboard.insertText('body { background: rgb(1, 2, 3) !important; }\n');
    const frame = page.frameLocator('iframe[title="Preview port 5174"]');
    await expect
      .poll(
        () => frame.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor),
        { timeout: 30_000 },
      )
      .toBe('rgb(1, 2, 3)');

    // `+` creates an independent idle shell while Vite keeps Terminal 1 busy.
    await openShellTerminal(page);
    await runTerminalLineSettled(page, 'node -v');
    await expectTerminalContains(page, /v24\.0\.0/);
    await runTerminalLineSettled(page, 'help');
    await expectTerminalContains(page, 'run programs');
    await runTerminalLineSettled(page, 'ls');

    // No step surfaced a bare unfixable-looking error.
    const buf = await terminalBuffer(page);
    expect(buf).not.toContain('MODULE_NOT_FOUND');
    expect(buf).not.toContain('Cannot find module');
    expect(buf).not.toContain('unknown subcommand');
  });

  test('every ceiling fails loud + directed, not silently or wrong', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await dismissChooser(page);

    // Unknown node flag → `bad option`, never a MODULE_NOT_FOUND on /workspace/<flag>.
    await runTerminalLineSettled(page, 'node --frobnicate');
    await expectTerminalContains(page, 'node: bad option: --frobnicate');

    // `npm test` with no script → npm's missing-script message, not `unknown subcommand`.
    await runTerminalLineSettled(page, 'npm test');
    await expectTerminalContains(page, /missing script/i);

    // `npm i -g` → a directed sandbox message, not the generic M9-scope line.
    await runTerminalLineSettled(page, 'npm install -g typescript');
    await expectTerminalContains(page, "global installs aren't supported in the browser sandbox");

    // A fat-fingered package manager → an npm nudge, not a wrong one-click `Run npm`.
    await runTerminalLineSettled(page, 'pnpm install left-pad');
    await expectTerminalContains(page, 'pnpm: not available');

    // Command substitution `$(…)` is a loud ceiling (no silent literal pass-through),
    // proven by the shell unit suite — `echo $(date)` runs nothing and prints no
    // `date` value. (Its tokenizer throw is covered in packages/shell/shell.test.ts.)
    const buf = await terminalBuffer(page);
    expect(buf).not.toContain('MODULE_NOT_FOUND');
    expect(buf).not.toContain('unknown subcommand');
    // Not one of the casual ceilings showed a bare command-not-found 127.
    expect(buf).not.toMatch(/bad option[\s\S]*command not found/);
  });
});
