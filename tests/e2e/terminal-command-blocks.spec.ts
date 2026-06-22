import { expect, test } from '@playwright/test';
import { openShellTerminal, runTerminalLine } from './helpers/playground.ts';

test.describe('Terminal command blocks UX', () => {
  test('bottom panel exposes shell context in the terminal hint', async ({ page }) => {
    await page.goto('/');
    await openShellTerminal(page);
    // Bottom panel header shows the Terminal view tab (ADR-0166 P1.9c added the
    // Terminal|Problems view switcher; the collapse control is now a chevron).
    await expect(page.getByRole('tab', { name: 'Terminal', exact: true })).toBeVisible();
    const modeHint = page.locator(
      '.rf-terminal-slot[data-active="true"] [data-testid="terminal-mode-hint"]',
    );
    await expect(modeHint).toContainText('Shell');
    await expect(modeHint).toContainText('/workspace');
  });

  test('rail items expose command preview and copy actions without reading renderer rows', async ({
    page,
  }) => {
    await page.goto('/');
    await openShellTerminal(page);

    await runTerminalLine(page, 'echo block-preview');
    const railItem = page.locator('.rf-terminal-blockrail__item[aria-label*="echo block-preview"]');
    await expect(railItem).toHaveAttribute('data-status', 'ok', { timeout: 5000 });
    await expect
      .poll(async () => {
        const railBox = await railItem.boundingBox();
        const rowsBox = await page
          .locator('.rf-terminal-slot[data-active="true"] .rf-terminal .xterm-rows')
          .boundingBox();
        if (!railBox || !rowsBox) return 'missing';
        return railBox.x + railBox.width <= rowsBox.x ? 'clear' : 'overlap';
      })
      .toBe('clear');
    await runTerminalLine(page, 'pwd');
    await expect(page.locator('.rf-terminal-blockrail__item[aria-label*="pwd"]')).toHaveAttribute(
      'data-status',
      'ok',
    );
    await railItem.hover();

    const preview = page.locator('#terminal-block-preview');
    await expect(preview).toContainText('echo block-preview');
    await expect(preview.getByRole('button', { name: 'Copy command', exact: true })).toBeVisible();
    await expect(preview.getByRole('button', { name: 'Copy command block output' })).toBeVisible();

    const railItems = page.locator('.rf-terminal-blockrail__item');
    await railItems.nth(0).focus();
    await page.keyboard.press('ArrowDown');
    await expect(railItems.nth(1)).toBeFocused();
  });
});
