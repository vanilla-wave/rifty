import { expect, test } from '@playwright/test';
import { openShellTerminal, runTerminalLineSettled, terminalBuffer } from './helpers/playground.ts';

test.describe('SCM file manager', () => {
  test('shows owner git decorations and opens an SCM diff from real owner content', async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await page.addInitScript(() => {
      localStorage.removeItem('rf.layout.v2');
    });
    await page.goto('/');
    await expect.poll(() => terminalBuffer(page), { timeout: 30_000 }).toMatch(/VITE v.*ready/u);

    await openShellTerminal(page);
    await runTerminalLineSettled(
      page,
      `echo scm-e2e-${Date.now().toString(36)} >> README.md`,
      60_000,
    );

    await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
    const readmeRow = page.locator('.rf-row[role="treeitem"]', { hasText: 'README.md' }).first();
    await expect(readmeRow).toBeVisible({ timeout: 30_000 });
    await expect(readmeRow).toHaveAttribute('data-git', 'modified', { timeout: 30_000 });
    await expect(readmeRow.locator('.rf-row__gitbadge')).toHaveText('M');
    const explorerScreenshot = testInfo.outputPath('scm-file-manager-explorer.png');
    await page.screenshot({ path: explorerScreenshot, fullPage: false, timeout: 10_000 });
    await testInfo.attach('scm-file-manager-explorer', {
      path: explorerScreenshot,
      contentType: 'image/png',
    });

    await page.getByRole('tab', { name: 'SCM' }).click({ timeout: 10_000 });
    await expect(page.getByLabel('Source Control')).toBeVisible({ timeout: 10_000 });
    const scmRow = page.locator('.rf-scm__row', { hasText: 'README.md' }).first();
    await expect(scmRow).toBeVisible({ timeout: 30_000 });
    await expect(scmRow).toHaveAttribute('data-code', 'M');

    await scmRow.locator('.rf-scm__open').click({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: /README\.md.*HEAD/u })).toBeVisible({
      timeout: 30_000,
    });
    const activeDiff = page.locator('.rf-diff-editor[data-active="true"] .monaco-diff-editor');
    await expect(activeDiff).toBeVisible({ timeout: 30_000 });
    const diffScreenshot = testInfo.outputPath('scm-file-manager-diff.png');
    await page.screenshot({ path: diffScreenshot, fullPage: false, timeout: 10_000 });
    await testInfo.attach('scm-file-manager-diff', {
      path: diffScreenshot,
      contentType: 'image/png',
    });
  });
});
