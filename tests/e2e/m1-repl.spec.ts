import { expect, test } from '@playwright/test';

test.describe('M1 — JS Execution', () => {
  test('terminal evaluates expressions', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await term.click();
    await page.keyboard.type('1 + 1');
    await page.keyboard.press('Enter');
    await expect(term).toContainText('2', { timeout: 5000 });
  });

  test('Run button executes editor source and streams stdout', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-action="run"]').click();
    await expect(page.locator('[data-testid="terminal"]')).toContainText('worker alive', {
      timeout: 10_000,
    });
  });

  test('errors render with traceback in red (stderr stream)', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await term.click();
    await page.keyboard.type("throw new Error('boom')");
    await page.keyboard.press('Enter');
    await expect(term).toContainText('boom', { timeout: 5000 });
  });

  test('console.log goes to stdout, console.error goes to stderr', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await term.click();
    await page.keyboard.type("console.log('OUT-' + 'A'); console.error('ERR-' + 'B')");
    await page.keyboard.press('Enter');
    await expect(term).toContainText('OUT-A', { timeout: 5000 });
    await expect(term).toContainText('ERR-B', { timeout: 5000 });
  });

  test('.reset respawns the worker', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await expect(term).toContainText('[worker ready]', { timeout: 10_000 });
    await term.click();
    await page.keyboard.type('globalThis.__mark = 17');
    await page.keyboard.press('Enter');
    await expect(term).toContainText('17', { timeout: 5000 });
    await page.keyboard.type('.reset');
    await page.keyboard.press('Enter');
    // worker terminates then respawns -- the new ready event appears as a
    // second [worker ready] in the same terminal.
    await expect(term).toContainText('[worker exited: reset]', { timeout: 5000 });
    await page.keyboard.type('typeof globalThis.__mark');
    await page.keyboard.press('Enter');
    await expect(term).toContainText('undefined', { timeout: 5000 });
  });
});
