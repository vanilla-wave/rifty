import { type Page, expect, test } from '@playwright/test';
import {
  openShellTerminal,
  pickStarter,
  runTerminalLineSettled,
  terminalBuffer,
} from './helpers/playground.ts';

const OWNER_TIMEOUT = 90_000;
const LEGACY_WORKSPACE_KEY = 'rifty.workspaceId';
let projectByteReadSequence = 0;

async function readActiveMainByteNotation(page: Page): Promise<string> {
  const marker = `__rifty_tab_bytes_${String(Date.now())}_${String(++projectByteReadSequence)}__`;
  const begin = `${marker}begin`;
  const end = `${marker}end`;
  await runTerminalLineSettled(
    page,
    `printf '${begin}\\n'; cat -A './src/main.js'; printf '\\n${end}\\n'`,
    OWNER_TIMEOUT,
  );
  const buffer = await terminalBuffer(page);
  const start = buffer.lastIndexOf(begin);
  const finish = start < 0 ? -1 : buffer.indexOf(end, start + begin.length);
  if (start < 0 || finish < 0) throw new Error('Project byte-read markers missing');
  return buffer
    .slice(start + begin.length, finish)
    .replace(/^\r?\n/u, '')
    .replace(/\r?\n$/u, '');
}

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
  await expect(readActiveMainByteNotation(page)).resolves.toBe(expected.replaceAll('\n', '$\r\n'));
}

test('occupied reload and a later fresh tab both reopen the exact Saved bytes', async ({
  page: owner,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Workbench Web Locks and OPFS are Chromium-only');
  test.setTimeout(300_000);

  const marker = `tab-continuity-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const source = [
    `const marker = ${JSON.stringify(marker)};`,
    "const target = document.getElementById('app');",
    "if (!target) throw new Error('missing preview root');",
    'target.textContent = marker;',
    '',
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

  await contender.close();
  const fresh = await context.newPage();
  await fresh.goto('/');
  expect(await fresh.evaluate((key) => sessionStorage.getItem(key), LEGACY_WORKSPACE_KEY)).toBe(
    null,
  );
  await expectExactReopenedScratch(fresh, marker, source);
});
