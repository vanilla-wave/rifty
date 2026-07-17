import { readFile } from 'node:fs/promises';
import { type Page, expect, test } from '@playwright/test';
import {
  expectViteDevServerReady,
  openActiveProjectFromLauncher,
  openShellTerminal,
  pickStarter,
  readActiveProjectText,
  runTerminalLineSettled,
} from './helpers/playground.ts';

const OWNER_TIMEOUT = 90_000;

function editorTab(page: Page, name: string) {
  return page
    .locator('[role="tablist"][aria-label="Open editors"] [role="tab"]')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
}

function explorerRow(page: Page, name: string, kind?: 'file' | 'dir') {
  const selector =
    kind === undefined
      ? '.rf-row[role="treeitem"]'
      : `.rf-row[role="treeitem"][data-kind="${kind}"]`;
  return page.locator(selector, { hasText: name }).first();
}

async function openSrcFolder(page: Page): Promise<void> {
  const filesTab = page.getByRole('tab', { name: 'Files', exact: true });
  if ((await filesTab.getAttribute('aria-selected')) !== 'true') await filesTab.click();
  const src = explorerRow(page, 'src', 'dir');
  await expect(src).toBeVisible({ timeout: OWNER_TIMEOUT });
  if ((await src.getAttribute('aria-expanded')) !== 'true') await src.click({ force: true });
  await expect(src).toHaveAttribute('aria-expanded', 'true');
}

async function setOpenEditorValue(page: Page, path: string, text: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ targetPath, targetText }) =>
            (
              globalThis as {
                __riftySetEditorValue?: (path: string, value: string) => boolean;
              }
            ).__riftySetEditorValue?.(targetPath, targetText) ?? false,
          { targetPath: path, targetText: text },
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function saveWorkspace(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+KeyS');
  await expect(
    page.locator('.rf-toast[data-tone="success"]').filter({ hasText: /^Saved$/u }),
  ).toBeVisible({ timeout: OWNER_TIMEOUT });
}

async function stopProject(page: Page): Promise<void> {
  await page.locator('[data-action="open-palette"]').click();
  const palette = page.locator('[data-testid="command-palette"]');
  await expect(palette).toBeVisible();
  await palette.getByRole('button', { name: 'Stop project', exact: true }).click();
  await expect(page.locator('.rf-livepill')).toHaveAttribute('data-state', 'stopped', {
    timeout: OWNER_TIMEOUT,
  });
}

async function importArchive(page: Page, path: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-action="open-palette"]').click();
  const palette = page.locator('[data-testid="command-palette"]');
  await expect(palette).toBeVisible();
  await palette.getByRole('button', { name: 'Import workspace archive', exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(path);
  await expect(
    page
      .locator('.rf-toast[data-tone="success"]')
      .filter({ hasText: 'Workspace archive imported' }),
  ).toBeVisible({ timeout: OWNER_TIMEOUT });
}

test('archive restores Files and editor bytes immediately and survives reload', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
  test.setTimeout(240_000);

  const sequence = Date.now().toString(36);
  const archivedMarker = `archive-restored-${sequence}`;
  const mutatedMarker = `archive-mutated-${sequence}`;
  const transientFile = `archive-transient-${sequence}.txt`;

  await page.goto('/');
  await pickStarter(page, 'project-files');
  await expectViteDevServerReady(page, 5174, OWNER_TIMEOUT);
  await expect(editorTab(page, 'main.js')).toHaveAttribute('aria-selected', 'true', {
    timeout: OWNER_TIMEOUT,
  });

  await setOpenEditorValue(page, '/src/main.js', `console.log('${archivedMarker}');\n`);
  await saveWorkspace(page);

  await openShellTerminal(page);
  expect(await readActiveProjectText(page, '.git/HEAD')).toMatchObject({
    exists: true,
    text: expect.stringContaining('ref:'),
  });
  await stopProject(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  const archivePath = await download.path();
  expect(archivePath).not.toBeNull();
  const archive = JSON.parse(await readFile(archivePath!, 'utf8')) as {
    readonly files: readonly {
      readonly path: string;
      readonly encoding: 'base64';
      readonly content: string;
    }[];
  };
  const archivePaths = archive.files.map(({ path }) => path);
  const archivedMain = archive.files.find(({ path }) => path === 'src/main.js');
  expect(archivedMain).toBeDefined();
  expect(Buffer.from(archivedMain!.content, 'base64').toString('utf8')).toContain(archivedMarker);
  expect(
    archivePaths.every((path) =>
      path
        .split('/')
        .every((segment) => !['node_modules', '.git', '.vite', 'dist', '.rifty'].includes(segment)),
    ),
  ).toBe(true);

  await setOpenEditorValue(page, '/src/main.js', `console.log('${mutatedMarker}');\n`);
  await saveWorkspace(page);
  await runTerminalLineSettled(page, `printf 'must disappear' > ${transientFile}`, 30_000);
  await expect(explorerRow(page, transientFile, 'file')).toBeVisible({ timeout: 30_000 });

  await importArchive(page, archivePath!);

  await expect(editorTab(page, 'main.js')).toHaveCount(0);
  expect(await readActiveProjectText(page, 'src/main.js')).toEqual({
    exists: true,
    text: `console.log('${archivedMarker}');`,
  });
  await expect(explorerRow(page, transientFile, 'file')).toHaveCount(0, { timeout: 30_000 });
  await openSrcFolder(page);
  const restoredMain = explorerRow(page, 'main.js', 'file');
  await expect(restoredMain).toBeVisible({ timeout: 30_000 });
  await restoredMain.click();
  const editor = page.locator('[data-testid="editor"] .view-lines').first();
  await expect(editor).toContainText(archivedMarker, { timeout: 30_000 });
  await expect(editor).not.toContainText(mutatedMarker);

  await page.reload();
  await page.locator('[data-action="open-launcher"]').click();
  await openActiveProjectFromLauncher(page);
  await expect(page.locator('.rf-app[data-workspace-owner="workspace"]')).toBeVisible({
    timeout: OWNER_TIMEOUT,
  });
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0);
  await openSrcFolder(page);
  await expect(explorerRow(page, transientFile, 'file')).toHaveCount(0);
  await explorerRow(page, 'main.js', 'file').click();
  await expect(page.locator('[data-testid="editor"] .view-lines').first()).toContainText(
    archivedMarker,
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-testid="editor"] .view-lines').first()).not.toContainText(
    mutatedMarker,
  );
});
