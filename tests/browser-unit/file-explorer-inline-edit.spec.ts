import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

test.describe('FileExplorer inline edit DOM lifecycle', () => {
  test('rename commits and leaves edit mode on blur', async ({ page }) => {
    await gotoHarness(page);

    await page.evaluate(async () => {
      const { mountFileExplorerInlineEditHarness } = await import(
        '/src/browser-unit/file-explorer-inline-edit-harness.tsx'
      );
      const root = document.createElement('div');
      root.id = 'file-explorer-test-root';
      document.body.append(root);
      mountFileExplorerInlineEditHarness(root);
    });

    const oldRow = page.locator('.rf-row[role="treeitem"][data-kind="file"]', {
      hasText: 'main.ts',
    });
    await expect(oldRow).toBeVisible();
    await oldRow.focus();
    await page.keyboard.press('F2');

    const input = page.getByLabel('File name');
    await expect(input).toBeFocused();
    await input.fill('renamed.ts');
    await page.locator('#browser-unit-harness').click();

    await expect(input).toHaveCount(0);
    await expect(
      page.locator('.rf-row[role="treeitem"][data-kind="file"]', { hasText: 'renamed.ts' }),
    ).toBeVisible();
  });
});
