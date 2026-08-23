import { expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

test('owner-backed completion discovers installed and direct commands, then runs the selection', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
  test.setTimeout(180_000);

  await bootProjectFiles(page);
  await expectViteDevServerReady(page, 5174, 90_000);
  await openShellTerminal(page);

  // Seed through the public terminal so the next completion must observe the
  // live owner VFS; the instant preset already supplies installed Vite.
  await runTerminalLineSettled(page, 'mkdir -p scripts');
  await runTerminalLineSettled(
    page,
    `echo 'console.log("DIRECT_COMPLETION:" + process.argv.slice(2).join(",")); process.exitCode = process.argv[2] === "selected" ? 0 : 9;' > scripts/tool.mjs`,
  );

  const activeSlot = page.locator('.rf-terminal-slot[data-active="true"]');
  const terminal = activeSlot.locator('[data-testid="terminal"]');
  await terminal.click();

  await page.keyboard.insertText('vit');
  await page.keyboard.press('Tab');
  const menu = activeSlot.locator('.rf-terminal-autocomplete');
  await expect(menu).toBeVisible({ timeout: 15_000 });
  await expect(menu.getByRole('button', { name: 'vite', exact: true })).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.keyboard.press('Control+u');

  await page.keyboard.insertText('./scripts/to');
  await page.keyboard.press('Tab');
  await expect(menu).toBeVisible({ timeout: 15_000 });
  await expect(menu.getByRole('button', { name: 'tool.mjs', exact: true })).toHaveCount(1);

  // Tab chooses the active DOM-menu entry. Supplying an argument and Enter then
  // exercises that exact completed direct path, rather than a separately typed
  // approximation of it.
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  await page.keyboard.insertText('selected');
  await page.keyboard.press('Enter');

  const directCommand = './scripts/tool.mjs selected';
  await expectTerminalContains(page, 'DIRECT_COMPLETION:selected', 30_000);
  await expect(page.locator('.rf-terminal-tab[data-active="true"]')).toHaveAttribute(
    'data-running',
    'false',
    { timeout: 30_000 },
  );
  await expect.poll(() => terminalBuffer(page), { timeout: 30_000 }).toMatch(/>\s*$/u);
  expect(await terminalHistoryExitCode(page, directCommand)).toBe(0);
});
