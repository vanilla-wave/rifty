import { expect, test } from '@playwright/test';
import { pickStarter } from './helpers/playground.ts';
test('Playground names legacy storage loss without a false recovery action', async ({ page }) => {
  await page.goto('/unit-harness.html');
  await page.evaluate(async () => {
    let root = await navigator.storage.getDirectory();
    for (const name of ['.rifty', 'workbench', 'v1', 'projects', 'old-project', 'tree'])
      root = await root.getDirectoryHandle(name, { create: true });
    const writer = await (
      await root.getFileHandle('old-edit.txt', { create: true })
    ).createWritable();
    await writer.write('legacy edit preserved');
    await writer.close();
  });
  await page.goto('/');
  const notice = page.locator('[data-health-scope="storage-layout"]');
  await expect(notice).toContainText('legacy per-file OPFS v1');
  await expect(notice).toContainText('not carried over');
  for (const category of ['edited source', 'npm installs', 'cloned repositories', 'Git history'])
    await expect(notice).toContainText(category);
  await expect(notice.locator('button')).toHaveCount(0);
  await pickStarter(page, 'project-files');
  await expect(notice).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-workbench-health="opening"]')).toHaveCount(0);
  await expect(page.locator('[data-action="open-launcher"]')).toBeEnabled();
  await expect(notice).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      let root = await navigator.storage.getDirectory();
      for (const name of ['.rifty', 'workbench', 'v1', 'projects', 'old-project', 'tree'])
        root = await root.getDirectoryHandle(name);
      return (await (await root.getFileHandle('old-edit.txt')).getFile()).text();
    }),
  ).toBe('legacy edit preserved');
});
