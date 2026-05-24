import { expect, test } from '@playwright/test';

test.describe('M2 — Modules', () => {
  test('require() resolves a CJS module loaded into the worker VFS', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await expect(term).toContainText('[worker ready]', { timeout: 10_000 });
    await term.click();
    await page.keyboard.type("typeof require === 'function' ? 'have-require' : 'missing-require'");
    await page.keyboard.press('Enter');
    await expect(term).toContainText('have-require', { timeout: 5000 });
  });

  test("require('node:path').join works inside the worker", async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await expect(term).toContainText('[worker ready]', { timeout: 10_000 });
    await term.click();
    await page.keyboard.type("require('node:path').join('a','b','c')");
    await page.keyboard.press('Enter');
    await expect(term).toContainText('a/b/c', { timeout: 5000 });
  });

  test('dynamic import() of a built-in resolves', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await expect(term).toContainText('[worker ready]', { timeout: 10_000 });
    await term.click();
    await page.keyboard.type(
      "__riftyImport('node:path').then(m => console.log('dyn:' + typeof m.join))",
    );
    await page.keyboard.press('Enter');
    await expect(term).toContainText('dyn:function', { timeout: 5000 });
  });
});
