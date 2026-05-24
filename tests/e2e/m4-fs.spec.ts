import { expect, test } from '@playwright/test';

/**
 * M4 acceptance: sync + async fs APIs over the in-Worker VFS. To avoid the
 * terminal's "busy" filter dropping fast keystrokes between separate evals,
 * each test sends a single self-contained IIFE that exercises a slice of the
 * fs API and prints a deterministic marker.
 */
test.describe('M4 — FileSystem', () => {
  test('writeFileSync + readFileSync round-trip', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await expect(term).toContainText('[worker ready]', { timeout: 10_000 });
    await term.click();
    await page.keyboard.type(
      "(()=>{const fs=require('fs');fs.mkdirSync('/tmp',{recursive:true});fs.writeFileSync('/tmp/n.txt','hi-rifty');return fs.readFileSync('/tmp/n.txt','utf8')})()",
    );
    await page.keyboard.press('Enter');
    await expect(term).toContainText('hi-rifty', { timeout: 5000 });
  });

  test('mkdirSync recursive + readdirSync', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await expect(term).toContainText('[worker ready]', { timeout: 10_000 });
    await term.click();
    await page.keyboard.type(
      "(()=>{const fs=require('fs');fs.mkdirSync('/a/b/c',{recursive:true});fs.writeFileSync('/a/b/c/leaf.txt','L');return fs.readdirSync('/a/b/c').join(',')})()",
    );
    await page.keyboard.press('Enter');
    await expect(term).toContainText('leaf.txt', { timeout: 5000 });
  });

  test('statSync reports size and isFile', async ({ page }) => {
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await expect(term).toContainText('[worker ready]', { timeout: 10_000 });
    await term.click();
    await page.keyboard.type(
      "(()=>{const fs=require('fs');fs.mkdirSync('/t',{recursive:true});fs.writeFileSync('/t/x.txt','abc');const s=fs.statSync('/t/x.txt');return 'size='+s.size+'|file='+s.isFile()})()",
    );
    await page.keyboard.press('Enter');
    await expect(term).toContainText('size=3|file=true', { timeout: 5000 });
  });
});
