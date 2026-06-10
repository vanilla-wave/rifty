import { type Page, expect, test } from '@playwright/test';

async function selectDevPreset(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Templates' }).click();
  const devPreset = page.locator('button[data-preset="dev-hmr"]');
  await devPreset.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(devPreset).toHaveAttribute('aria-pressed', 'true');
}

test.describe('Terminal command blocks UX', () => {
  test('bottom panel is named Shell in dev mode', async ({ page }) => {
    await page.goto('/');
    await selectDevPreset(page);
    await expect(page.getByRole('button', { name: 'Collapse Shell' })).toContainText('Shell');
    await expect(page.locator('[data-testid="console"] .rf-console__sub')).toContainText(
      '/workspace',
    );
  });

  test('rail items expose command preview and copy actions without reading renderer rows', async ({
    page,
  }) => {
    await page.goto('/');
    await selectDevPreset(page);

    const term = page.locator('[data-testid="terminal"]');
    await term.click();
    await page.keyboard.type('echo block-preview');
    await page.keyboard.press('Enter');
    const railItem = page.locator('.rf-terminal-blockrail__item[aria-label*="echo block-preview"]');
    await expect(railItem).toHaveAttribute('data-status', 'ok', { timeout: 5000 });
    await expect
      .poll(async () => {
        const railBox = await railItem.boundingBox();
        const rowsBox = await page.locator('.rf-terminal .xterm-rows').boundingBox();
        if (!railBox || !rowsBox) return 'missing';
        return railBox.x + railBox.width <= rowsBox.x ? 'clear' : 'overlap';
      })
      .toBe('clear');
    await page.keyboard.type('pwd');
    await page.keyboard.press('Enter');
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
