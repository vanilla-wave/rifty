import { type Page, expect, test } from '@playwright/test';

async function selectDevPreset(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Templates' }).click();
  const devPreset = page.locator('button[data-preset="dev-hmr"]');
  await devPreset.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(devPreset).toHaveAttribute('aria-pressed', 'true');
}

test.describe('Terminal mouse reporting', () => {
  test('DECSET 1000/1006 mouse click reaches foreground stdin', async ({ page }) => {
    await page.goto('/');
    await selectDevPreset(page);

    const term = page.locator('[data-testid="terminal"]');
    await term.click();
    await page.keyboard.type('mouse-demo');
    await page.keyboard.press('Enter');

    await term.click({ position: { x: 120, y: 48 } });

    const rows = page.locator('.xterm-rows');
    await expect(rows).toBeVisible();
    await expect.poll(async () => rows.textContent()).toMatch(/mouse \\x1b\[<\d+;\d+;\d+M/u);
  });
});
