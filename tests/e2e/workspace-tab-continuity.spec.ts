import { type Page, expect, test } from '@playwright/test';
import { openShellTerminal, pickStarter, readActiveProjectText } from './helpers/playground.ts';

const OWNER_TIMEOUT = 90_000;
const LEGACY_WORKSPACE_KEY = 'rifty.workspaceId';

async function setOpenEditorValue(page: Page, path: string, text: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ targetPath, targetText }) => {
            const setter = (
              globalThis as {
                __riftySetEditorValue?: (filePath: string, content: string) => boolean;
              }
            ).__riftySetEditorValue;
            return setter?.(targetPath, targetText) ?? false;
          },
          { targetPath: path, targetText: text },
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function saveWorkspace(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+KeyS');
  await expect(
    page.locator('.rf-toast[data-tone="success"]').filter({ hasText: /^Saved$/ }),
  ).toBeVisible({ timeout: OWNER_TIMEOUT });
}

async function expectExactReopenedScratch(
  page: Page,
  marker: string,
  expected: string,
): Promise<void> {
  await expect(page.locator('.rf-app[data-workspace-owner="workspace"]')).toBeVisible({
    timeout: OWNER_TIMEOUT,
  });
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0);
  await expect(page.locator('[data-action="open-launcher"] .rf-chip__name')).toHaveText(
    'Project files scratch',
    { timeout: OWNER_TIMEOUT },
  );
  await expect(page.getByRole('tab', { name: /main\.js/ })).toBeVisible({
    timeout: OWNER_TIMEOUT,
  });
  await expect(page.locator('[data-testid="editor"] .view-lines').first()).toContainText(marker, {
    timeout: OWNER_TIMEOUT,
  });

  await openShellTerminal(page);
  await expect(readActiveProjectText(page, './src/main.js', OWNER_TIMEOUT)).resolves.toEqual({
    exists: true,
    text: expected,
  });
}

test('a live second tab is directed to the owner, then reloads the exact Saved bytes after close', async ({
  page: owner,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Workbench Web Locks and OPFS are Chromium-only');
  test.setTimeout(240_000);

  const marker = `tab-continuity-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const source = [
    `const marker = ${JSON.stringify(marker)};`,
    "const target = document.getElementById('app');",
    "if (!target) throw new Error('missing preview root');",
    'target.textContent = marker;',
  ].join('\n');

  await owner.goto('/');
  await pickStarter(owner, 'project-files');
  await setOpenEditorValue(owner, '/src/main.js', source);
  await expect(owner.locator('[data-action="open-launcher"][data-dirty="true"]')).toBeVisible({
    timeout: 15_000,
  });
  await saveWorkspace(owner);

  const contender = await context.newPage();
  const contenderWorkers: string[] = [];
  contender.on('worker', (worker) => contenderWorkers.push(worker.url()));
  await contender.goto('/');

  const occupied = contender.getByTestId('workspace-occupied');
  await expect(occupied).toBeVisible({ timeout: 30_000 });
  await expect(occupied).toHaveAttribute('role', 'alert');
  await expect(
    occupied.getByRole('heading', { name: 'Workspace is open in another tab' }),
  ).toBeVisible();
  await expect(occupied).toContainText('Continue editing there.');
  await expect(occupied).toContainText('If that tab is closed, reload this page.');
  await expect(occupied.getByRole('button', { name: 'Reload' })).toBeVisible();
  await expect(contender.locator('.rf-app')).toHaveCount(0);
  await expect(contender.locator('[data-testid="terminal"]')).toHaveCount(0);
  expect(contenderWorkers).toEqual([]);
  expect(contender.workers()).toEqual([]);
  expect(await contender.evaluate((key) => sessionStorage.getItem(key), LEGACY_WORKSPACE_KEY)).toBe(
    null,
  );

  await owner.close();
  await expect(occupied).toBeVisible();
  await expect(contender.locator('.rf-app')).toHaveCount(0);

  await Promise.all([
    contender.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    occupied.getByRole('button', { name: 'Reload' }).click(),
  ]);
  expect(await contender.evaluate((key) => sessionStorage.getItem(key), LEGACY_WORKSPACE_KEY)).toBe(
    null,
  );
  await expectExactReopenedScratch(contender, marker, source);
});
