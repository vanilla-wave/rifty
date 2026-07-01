import { expect, test } from '@playwright/test';
import {
  bootShell,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLineSettled,
} from './helpers/playground.ts';

test.describe('Terminal command blocks UX', () => {
  test('bottom panel exposes shell context in the terminal hint', async ({ page }) => {
    await bootShell(page);
    await openShellTerminal(page);
    await expect(page.getByRole('tab', { name: 'Terminal 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-testid="problems-tab"]')).toBeVisible();
    const modeHint = page.locator(
      '.rf-terminal-slot[data-active="true"] [data-testid="terminal-mode-hint"]',
    );
    await expect(modeHint).toContainText('Shell');
    await expect(modeHint).toContainText('/scratch');
  });

  test('terminal commands run without legacy command overlays', async ({ page }) => {
    await bootShell(page);
    await openShellTerminal(page);

    await runTerminalLineSettled(page, 'echo block-preview-output');
    await expectTerminalContains(page, 'block-preview-output');
    await runTerminalLineSettled(page, 'pwd');
    await expectTerminalContains(page, '/scratch');

    await expect(page.locator('.rf-terminal-blockrail__item')).toHaveCount(0);
    await expect(page.locator('#terminal-block-preview')).toHaveCount(0);
    await expect(page.locator('.rf-terminal-sticky')).toHaveCount(0);
  });
});
