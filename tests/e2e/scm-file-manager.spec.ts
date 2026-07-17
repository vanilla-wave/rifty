import { readFile } from 'node:fs/promises';
import { type Page, expect, test } from '@playwright/test';
import {
  type TerminalSessionTarget,
  expectViteDevServerReady,
  insertTerminalLineSettled,
  openShellTerminal,
  pickStarter,
  terminalBuffer,
} from './helpers/playground.ts';

const OWNER_DURABLE_TIMEOUT = 90_000;

async function openProjects(page: Page): Promise<void> {
  const trigger = page.locator('[data-action="open-launcher"]');
  await expect(trigger).toBeEnabled({ timeout: OWNER_DURABLE_TIMEOUT });
  await trigger.click();
  await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /^Projects/ }).click();
}

function projectCard(page: Page, name: string) {
  return page
    .locator('.rf-pcard')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
}

function editorTab(page: Page, name: string) {
  return page
    .locator('[role="tablist"][aria-label="Open editors"] [role="tab"]')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
}

async function saveScratchAs(page: Page, name: string): Promise<void> {
  await openProjects(page);
  await page.click('[data-action="save-scratch"]');
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.locator('input.rf-dialog__input').fill(name);
  await dialog.getByRole('button', { name: 'Save project' }).click();
  await expect(dialog).toHaveCount(0, { timeout: OWNER_DURABLE_TIMEOUT });
  const card = projectCard(page, name);
  await expect(card).toBeVisible({ timeout: OWNER_DURABLE_TIMEOUT });
  await expect(card).toHaveAttribute('data-active', 'true');
  await page.locator('.rf-launcher__close').click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator('[data-action="open-launcher"] .rf-chip__name')).toHaveText(name, {
    timeout: OWNER_DURABLE_TIMEOUT,
  });
}

async function runShellLine(
  page: Page,
  shell: TerminalSessionTarget,
  line: string,
  timeout = 60_000,
): Promise<void> {
  await insertTerminalLineSettled(page, line, timeout, shell);
}

async function expectShellContains(
  page: Page,
  shell: TerminalSessionTarget,
  text: string,
  timeout = 15_000,
): Promise<void> {
  await expect.poll(() => terminalBuffer(page, shell), { timeout }).toContain(text);
}

async function bootScmFileManager(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.removeItem('rf.layout.v2');
  });
  await page.goto('/');
  await pickStarter(page, 'project-files');
  await expectViteDevServerReady(page, 5174, OWNER_DURABLE_TIMEOUT);
}

function explorerRow(page: Page, name: string, kind?: 'file' | 'dir') {
  const selector =
    kind === undefined
      ? '.rf-row[role="treeitem"]'
      : `.rf-row[role="treeitem"][data-kind="${kind}"]`;
  return page.locator(selector, { hasText: name }).first();
}

async function openSrcFolder(page: Page, timeout = 30_000): Promise<void> {
  const srcRow = explorerRow(page, 'src', 'dir');
  await expect(srcRow).toBeVisible({ timeout });
  if ((await srcRow.getAttribute('aria-expanded')) !== 'true') await srcRow.click({ force: true });
}

async function openExplorerContextMenu(
  page: Page,
  name: string,
  kind: 'file' | 'dir',
): Promise<void> {
  const row = explorerRow(page, name, kind);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click({ button: 'right', force: true });
  await expect(page.locator('.rf-rowmenu')).toBeVisible({ timeout: 10_000 });
}

async function openExplorerContextMenuAt(
  page: Page,
  name: string,
  kind: 'file' | 'dir',
  point: { readonly x: number; readonly y: number },
): Promise<void> {
  const row = explorerRow(page, name, kind);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.evaluate((element, anchor) => {
    element.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: anchor.x,
        clientY: anchor.y,
      }),
    );
  }, point);
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });
}

async function createExplorerEntry(
  page: Page,
  parent: string,
  kind: 'file' | 'folder',
  name: string,
): Promise<void> {
  await openExplorerContextMenu(page, parent, 'dir');
  await page.getByRole('menuitem', { name: kind === 'file' ? 'New File' : 'New Folder' }).click();
  await page.locator('.rf-row__input').fill(name);
  await page.locator('.rf-row__input').press('Enter');
  await expect(explorerRow(page, name, kind === 'file' ? 'file' : 'dir')).toBeVisible({
    timeout: 30_000,
  });
}

async function dropOsFileOnRow(
  page: Page,
  rowName: string,
  rowKind: 'file' | 'dir',
  fileName: string,
  text: string,
): Promise<void> {
  const dataTransfer = await page.evaluateHandle(
    ({ name, content }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([content], name, { type: 'text/plain' }));
      return dt;
    },
    { name: fileName, content: text },
  );
  const row = explorerRow(page, rowName, rowKind);
  await row.dispatchEvent('dragover', { dataTransfer });
  await row.dispatchEvent('drop', { dataTransfer });
}

async function dropExplorerPathOnDir(
  page: Page,
  sourcePath: string,
  targetDirName: string,
): Promise<void> {
  const dataTransfer = await page.evaluateHandle((path) => {
    const dt = new DataTransfer();
    dt.setData('application/x-rifty-paths', JSON.stringify([path]));
    return dt;
  }, sourcePath);
  const target = explorerRow(page, targetDirName, 'dir');
  await target.dispatchEvent('dragover', { dataTransfer });
  await target.dispatchEvent('drop', { dataTransfer });
}

async function trySetOpenEditorValue(page: Page, path: string, text: string): Promise<boolean> {
  return await page.evaluate(
    ({ path: targetPath, text: targetText }) => {
      const fn = (globalThis as { __riftySetEditorValue?: (path: string, text: string) => boolean })
        .__riftySetEditorValue;
      return fn?.(targetPath, targetText) ?? false;
    },
    { path, text },
  );
}

async function setOpenEditorValue(page: Page, path: string, text: string): Promise<void> {
  const ok = await trySetOpenEditorValue(page, path, text);
  expect(ok).toBe(true);
}

test.describe('GIT file manager', () => {
  test('File Explorer context menu retains viewport placement in the real App', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('viewport is required');

    await openExplorerContextMenuAt(page, 'README.md', 'file', {
      x: viewport.width - 4,
      y: viewport.height - 4,
    });
    const menu = page.getByRole('menu');
    await expect(menu).toHaveCSS('position', 'fixed');
    const menuBox = await menu.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    });
    expect(menuBox.left).toBeGreaterThanOrEqual(4);
    expect(menuBox.top).toBeGreaterThanOrEqual(4);
    expect(menuBox.right).toBe(viewport.width - 4);
    expect(menuBox.bottom).toBe(viewport.height - 4);

    const download = page.getByRole('menuitem', { name: 'Download' });
    const ownsHitTarget = await download.evaluate((item) => {
      const box = item.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit !== null && (hit === item || item.contains(hit));
    });
    expect(ownsHitTarget).toBe(true);
    const downloadPromise = page.waitForEvent('download');
    await download.click();
    expect((await downloadPromise).suggestedFilename()).toBe('README.md');

    await openExplorerContextMenuAt(page, 'README.md', 'file', { x: 100, y: 100 });
    const reopenedBox = await page.getByRole('menu').boundingBox();
    expect(reopenedBox?.x).toBe(100);
    expect(reopenedBox?.y).toBe(100);
    await page.setViewportSize({ width: viewport.width, height: 240 });
    await expect(page.getByRole('menu')).toHaveCount(0);

    const shortViewport = page.viewportSize();
    if (!shortViewport) throw new Error('short viewport is required');
    await openExplorerContextMenuAt(page, 'README.md', 'file', {
      x: shortViewport.width - 4,
      y: shortViewport.height - 4,
    });
    const shortMenu = page.getByRole('menu');
    const shortGeometry = await shortMenu.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      };
    });
    expect(shortGeometry.top).toBe(4);
    expect(shortGeometry.bottom).toBe(shortViewport.height - 4);
    expect(shortGeometry.scrollHeight).toBeGreaterThan(shortGeometry.clientHeight);
    const shortDownloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download' }).click();
    expect((await shortDownloadPromise).suggestedFilename()).toBe('README.md');
  });

  test('Projects row menu retains card placement in the real App', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    const projectName = `Menu placement ${Date.now().toString(36)}`;
    await saveScratchAs(page, projectName);
    await openProjects(page);
    const card = projectCard(page, projectName);
    await card.getByRole('button', { name: 'Project actions' }).click();
    const projectMenu = card.locator('.rf-rowmenu');
    await expect(projectMenu).toBeVisible();
    await expect(projectMenu).toHaveCSS('position', 'absolute');
    await projectMenu.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const projectGeometry = await card.evaluate((element) => {
      const menu = element.querySelector<HTMLElement>('.rf-rowmenu');
      if (!menu) throw new Error('project row menu did not render');
      const cardBox = element.getBoundingClientRect();
      const menuBox = menu.getBoundingClientRect();
      const cardStyle = getComputedStyle(element);
      return {
        cardTop: cardBox.top,
        cardRight: cardBox.right,
        cardBorderTop: Number.parseFloat(cardStyle.borderTopWidth),
        cardBorderRight: Number.parseFloat(cardStyle.borderRightWidth),
        menuTop: menuBox.top,
        menuRight: menuBox.right,
        menuWidth: menuBox.width,
      };
    });
    expect(projectGeometry.menuTop).toBe(
      projectGeometry.cardTop + projectGeometry.cardBorderTop + 40,
    );
    expect(projectGeometry.menuRight).toBe(
      projectGeometry.cardRight - projectGeometry.cardBorderRight - 12,
    );
    expect(projectGeometry.menuWidth).toBe(200);
    await projectMenu.getByRole('button', { name: 'Rename…' }).click();
    await expect(page.getByRole('heading', { name: 'Rename project' })).toBeVisible();
  });

  test('shows owner git decorations and opens a GIT diff from real owner content', async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);

    const shell = await openShellTerminal(page);
    await runShellLine(page, shell, `echo scm-e2e-${Date.now().toString(36)} >> README.md`);

    await expect(page.getByRole('tab', { name: 'Files', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
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

    await page.getByRole('tab', { name: 'GIT', exact: true }).click({ timeout: 10_000 });
    await expect(page.getByLabel('Git', { exact: true })).toBeVisible({ timeout: 10_000 });
    const scmRow = page.locator('.rf-scm__row', { hasText: 'README.md' }).first();
    await expect(scmRow).toBeVisible({ timeout: 30_000 });
    await expect(scmRow).toHaveAttribute('data-code', 'M');

    await scmRow.locator('.rf-scm__open').click({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: /README\.md.*Working Tree/u })).toBeVisible({
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

  test('folder context menu creates real owner files and folders', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    await openSrcFolder(page, OWNER_DURABLE_TIMEOUT);

    const seq = Date.now().toString(36);
    const file = `ctx-${seq}.txt`;
    const dir = `ctx-dir-${seq}`;
    await openExplorerContextMenu(page, 'src', 'dir');
    await page.getByRole('menuitem', { name: 'New File' }).click();
    await page.locator('.rf-row__input').fill(file);
    await page.locator('.rf-row__input').press('Enter');
    await expect(explorerRow(page, file, 'file')).toBeVisible({ timeout: 30_000 });

    await openExplorerContextMenu(page, 'src', 'dir');
    await page.getByRole('menuitem', { name: 'New Folder' }).click();
    await page.locator('.rf-row__input').fill(dir);
    await page.locator('.rf-row__input').press('Enter');
    await expect(explorerRow(page, dir, 'dir')).toBeVisible({ timeout: 30_000 });

    const shell = await openShellTerminal(page);
    await runShellLine(
      page,
      shell,
      `test -f src/${file} && test -d src/${dir} && echo context-crud-ok-${seq}`,
    );
    await expectShellContains(page, shell, `context-crud-ok-${seq}`);
  });

  test('GIT stage uses the latest pending editor bytes', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);

    const readmeRow = explorerRow(page, 'README.md', 'file');
    await expect(readmeRow).toBeVisible({ timeout: 30_000 });
    await readmeRow.click();
    await expect(page.getByRole('tab', { name: 'README.md' })).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 30_000 },
    );

    const marker = `stage-latest-${Date.now().toString(36)}`;
    const editor = page.locator('[data-testid="editor"]');
    const editorInput = editor.locator('textarea.inputarea').first();
    await editor
      .locator('.view-line')
      .first()
      .click({ position: { x: 0, y: 8 } });
    await editorInput.click({ force: true });
    await expect(editorInput).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.insertText(`${marker}\n`);
    await expect(editor.locator('.view-lines').first()).toContainText(marker);

    await page.getByRole('tab', { name: 'GIT', exact: true }).click({ timeout: 10_000 });
    const scmRow = page.locator('.rf-scm__row', { hasText: 'README.md' }).first();
    await expect(scmRow).toBeVisible({ timeout: 30_000 });
    await scmRow.getByLabel('Stage README.md').click();

    const stagedGroup = page.locator('.rf-scm__group').nth(0);
    await expect(stagedGroup.locator('.rf-scm__row', { hasText: 'README.md' })).toBeVisible({
      timeout: 30_000,
    });

    const shell = await openShellTerminal(page);
    await runShellLine(page, shell, `git diff --cached -- README.md | grep ${marker}`);
    await expectShellContains(page, shell, marker);

    const message = `scm-stage-commit-${Date.now().toString(36)}`;
    await page.getByLabel('Commit message').fill(message);
    await page.getByRole('button', { name: 'Commit' }).click();
    await expect(page.locator('.rf-scm__commit', { hasText: message })).toBeVisible({
      timeout: 30_000,
    });
    await runShellLine(page, shell, `git log --oneline -1 | grep ${message}`);
    await expectShellContains(page, shell, message);
  });

  test('clipboard duplicate and cut-paste mutate the owner tree', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    await openSrcFolder(page, OWNER_DURABLE_TIMEOUT);

    const seq = Date.now().toString(36);
    const file = `clip-${seq}.txt`;
    const copy = `clip-${seq} copy.txt`;
    const dest = `clip-dest-${seq}`;
    await createExplorerEntry(page, 'src', 'file', file);
    await createExplorerEntry(page, 'src', 'folder', dest);

    await openExplorerContextMenu(page, file, 'file');
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(explorerRow(page, copy, 'file')).toBeVisible({ timeout: 30_000 });

    await openExplorerContextMenu(page, file, 'file');
    await page.getByRole('menuitem', { name: 'Cut' }).click();
    await openExplorerContextMenu(page, dest, 'dir');
    await page.getByRole('menuitem', { name: 'Paste' }).click();

    const destRow = explorerRow(page, dest, 'dir');
    if ((await destRow.getAttribute('aria-expanded')) !== 'true')
      await destRow.click({ force: true });
    await expect(explorerRow(page, file, 'file')).toBeVisible({ timeout: 30_000 });

    const shell = await openShellTerminal(page);
    await runShellLine(
      page,
      shell,
      `test -f src/${copy} && test -f src/${dest}/${file} && test ! -e src/${file} && echo clipboard-ok-${seq}`,
    );
    await expectShellContains(page, shell, `clipboard-ok-${seq}`);
  });

  test('OS upload, single-file download, and drag-move use owner bytes', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    await openSrcFolder(page);

    const seq = Date.now().toString(36);
    const file = `upload-${seq}.txt`;
    const dest = `upload-dest-${seq}`;
    const content = `uploaded-owner-bytes-${seq}\n`;
    await dropOsFileOnRow(page, 'src', 'dir', file, content);
    await expect(explorerRow(page, file, 'file')).toBeVisible({ timeout: 30_000 });

    const downloadPromise = page.waitForEvent('download');
    await openExplorerContextMenu(page, file, 'file');
    await page.getByRole('menuitem', { name: 'Download' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(file);
    const downloadedPath = await download.path();
    expect(downloadedPath).not.toBeNull();
    expect(await readFile(downloadedPath!, 'utf8')).toBe(content);

    await createExplorerEntry(page, 'src', 'folder', dest);
    await dropExplorerPathOnDir(page, `/src/${file}`, dest);
    const destRow = explorerRow(page, dest, 'dir');
    if ((await destRow.getAttribute('aria-expanded')) !== 'true')
      await destRow.click({ force: true });
    await expect(explorerRow(page, file, 'file')).toBeVisible({ timeout: 30_000 });

    const shell = await openShellTerminal(page);
    await runShellLine(
      page,
      shell,
      `test ! -e src/${file} && grep uploaded-owner-bytes-${seq} src/${dest}/${file} && echo upload-move-ok-${seq}`,
    );
    await expectShellContains(page, shell, `upload-move-ok-${seq}`);
  });

  test('GIT splits staged and worktree rows for MM and AD states', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    const shell = await openShellTerminal(page);

    const seq = Date.now().toString(36);
    const stagedDelete = `staged-delete-${seq}.txt`;
    await runShellLine(
      page,
      shell,
      `printf '\\nmm-staged-${seq}\\n' >> README.md && printf 'ad-${seq}\\n' > ${stagedDelete}`,
    );

    await page.getByRole('tab', { name: 'GIT', exact: true }).click({ timeout: 10_000 });
    await expect(page.getByLabel('Git', { exact: true })).toBeVisible({ timeout: 10_000 });
    const stagedGroup = page.locator('.rf-scm__group').nth(0);
    const changesGroup = page.locator('.rf-scm__group').nth(1);
    await changesGroup
      .locator('.rf-scm__row', { hasText: 'README.md' })
      .getByLabel('Stage README.md')
      .click();
    await expect(stagedGroup.locator('.rf-scm__row', { hasText: 'README.md' })).toBeVisible({
      timeout: 30_000,
    });
    await changesGroup
      .locator('.rf-scm__row', { hasText: stagedDelete })
      .getByLabel(`Stage ${stagedDelete}`)
      .click();
    await expect(stagedGroup.locator('.rf-scm__row', { hasText: stagedDelete })).toBeVisible({
      timeout: 30_000,
    });

    await runShellLine(
      page,
      shell,
      `printf 'mm-worktree-${seq}\\n' >> README.md && rm ${stagedDelete}`,
    );

    const stagedReadme = stagedGroup.locator('.rf-scm__row', { hasText: 'README.md' }).first();
    const worktreeReadme = changesGroup.locator('.rf-scm__row', { hasText: 'README.md' }).first();
    const stagedAdd = stagedGroup.locator('.rf-scm__row', { hasText: stagedDelete }).first();
    const worktreeDelete = changesGroup.locator('.rf-scm__row', { hasText: stagedDelete }).first();
    await expect(stagedReadme).toHaveAttribute('data-code', 'M', { timeout: 30_000 });
    await expect(worktreeReadme).toHaveAttribute('data-code', 'M', { timeout: 30_000 });
    await expect(stagedAdd).toHaveAttribute('data-code', 'A', { timeout: 30_000 });
    await expect(worktreeDelete).toHaveAttribute('data-code', 'D', { timeout: 30_000 });

    await stagedReadme.locator('.rf-scm__open').click();
    await expect(page.getByRole('tab', { name: /README\.md.*Index/u })).toBeVisible({
      timeout: 30_000,
    });
    await worktreeReadme.locator('.rf-scm__open').click();
    await expect(page.getByRole('tab', { name: /README\.md.*Working Tree/u })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('renaming and deleting an open file does not recreate the old path', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    await openSrcFolder(page);

    const seq = Date.now().toString(36);
    const oldName = `open-rename-${seq}.txt`;
    const newName = `open-renamed-${seq}.txt`;
    await openExplorerContextMenu(page, 'src', 'dir');
    await page.getByRole('menuitem', { name: 'New File' }).click();
    await page.locator('.rf-row__input').fill(oldName);
    await page.locator('.rf-row__input').press('Enter');
    const oldRow = explorerRow(page, oldName, 'file');
    await expect(oldRow).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: oldName })).toHaveAttribute(
      'aria-selected',
      'true',
      {
        timeout: 30_000,
      },
    );

    await setOpenEditorValue(page, `/src/${oldName}`, `edited-before-rename-${seq}\n`);
    await oldRow.focus();
    await page.keyboard.press('F2');
    await page.locator('.rf-row__input').fill(newName);
    await page.locator('.rf-row__input').press('Enter');

    const newRow = explorerRow(page, newName, 'file');
    await expect(newRow).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator('.rf-row[role="treeitem"][data-kind="file"]', { hasText: oldName }),
    ).toHaveCount(0);
    await expect(page.getByRole('tab', { name: newName })).toHaveAttribute(
      'aria-selected',
      'true',
      {
        timeout: 30_000,
      },
    );

    const shell = await openShellTerminal(page);
    await runShellLine(
      page,
      shell,
      `test ! -e src/${oldName} && grep edited-before-rename-${seq} src/${newName} && echo rename-ok-${seq}`,
    );
    await expectShellContains(page, shell, `rename-ok-${seq}`);

    await setOpenEditorValue(page, `/src/${newName}`, `edited-before-delete-${seq}\n`);
    page.once('dialog', (dialog) => void dialog.accept());
    await newRow.focus();
    await page.keyboard.press('Delete');
    await expect(
      page.locator('.rf-row[role="treeitem"][data-kind="file"]', { hasText: newName }),
    ).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(700);
    await runShellLine(page, shell, `test ! -e src/${newName} && echo delete-ok-${seq}`);
    await expectShellContains(page, shell, `delete-ok-${seq}`);
  });

  test('renaming an open entry file survives Save without silently recreating src/main.js', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    await openSrcFolder(page);

    const seq = Date.now().toString(36);
    const renamed = `main-renamed-${seq}.js`;
    await setOpenEditorValue(page, '/src/main.js', `console.log("entry-before-${seq}");\n`);
    const mainRow = explorerRow(page, 'main.js', 'file');
    await expect(mainRow).toBeVisible({ timeout: 30_000 });
    await mainRow.focus();
    await page.keyboard.press('F2');
    await page.locator('.rf-row__input').fill(renamed);
    await page.locator('.rf-row__input').press('Enter');
    await expect(explorerRow(page, renamed, 'file')).toBeVisible({ timeout: 30_000 });

    await expect(
      trySetOpenEditorValue(page, '/src/main.js', `console.log("should-not-recreate-${seq}");\n`),
    ).resolves.toBe(false);
    await setOpenEditorValue(
      page,
      `/src/${renamed}`,
      `console.log("entry-after-rename-${seq}");\n`,
    );

    const shell = await openShellTerminal(page);
    await runShellLine(
      page,
      shell,
      `test ! -e src/main.js && grep entry-after-rename-${seq} src/${renamed} && echo entry-rename-ok-${seq}`,
    );
    await expectShellContains(page, shell, `entry-rename-ok-${seq}`);

    const projectName = `Program Mirror Reset ${seq}`;
    await saveScratchAs(page, projectName);

    const resetMarker = `program-root-reset-${seq}`;
    await expect(editorTab(page, 'main.js')).toHaveCount(0);
    await expect(
      trySetOpenEditorValue(page, '/src/main.js', `console.log("${resetMarker}");\n`),
    ).resolves.toBe(false);
    await openSrcFolder(page);
    await explorerRow(page, renamed, 'file').click();
    await expect(editorTab(page, renamed)).toHaveAttribute('aria-selected', 'true', {
      timeout: 30_000,
    });
    await setOpenEditorValue(page, `/src/${renamed}`, `console.log("${resetMarker}");\n`);
    const savedProjectShell = await openShellTerminal(page);
    await runShellLine(
      page,
      savedProjectShell,
      `test ! -e src/main.js && grep ${resetMarker} src/${renamed}`,
    );
    await expectShellContains(page, savedProjectShell, resetMarker);
  });

  test('editor writes appear in GIT and mark changed editor lines', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);

    const readmeRow = page.locator('.rf-row[role="treeitem"]', { hasText: 'README.md' }).first();
    await expect(readmeRow).toBeVisible({ timeout: 30_000 });
    await readmeRow.click();
    await expect(page.getByRole('tab', { name: 'README.md' })).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 30_000 },
    );

    const marker = `scm-editor-${Date.now().toString(36)}`;
    const editor = page.locator('[data-testid="editor"]');
    const editorInput = editor.locator('textarea.inputarea').first();
    const editorLines = editor.locator('.view-lines').first();
    await editor
      .locator('.view-line')
      .first()
      .click({ position: { x: 0, y: 8 } });
    await editorInput.click({ force: true });
    await expect(editorInput).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.insertText(`${marker}\n`);
    await expect(editorLines).toContainText(marker);
    await expect(page.locator('.rf-dirty-gutter--added').first()).toBeVisible({ timeout: 30_000 });

    await expect(page.getByRole('tab', { name: 'Files', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(readmeRow).toHaveAttribute('data-git', 'modified', { timeout: 30_000 });
    await expect(readmeRow.locator('.rf-row__gitbadge')).toHaveText('M');

    await page.getByRole('tab', { name: 'GIT', exact: true }).click({ timeout: 10_000 });
    const scmRow = page.locator('.rf-scm__row', { hasText: 'README.md' }).first();
    await expect(scmRow).toBeVisible({ timeout: 30_000 });
    await expect(scmRow).toHaveAttribute('data-code', 'M');

    await page.getByRole('tab', { name: 'README.md' }).click();
    await expect(page.locator('.rf-dirty-gutter').first()).toBeVisible({ timeout: 30_000 });

    const shell = await openShellTerminal(page);
    await runShellLine(page, shell, `grep ${marker} README.md`);
    await expectShellContains(page, shell, marker);
  });

  test('entry file editor writes appear in GIT and mark changed lines', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    await expect(editorTab(page, 'main.js')).toHaveAttribute('aria-selected', 'true', {
      timeout: 30_000,
    });

    const marker = `git-entry-${Date.now().toString(36)}`;
    const editor = page.locator('[data-testid="editor"]');
    const editorInput = editor.locator('textarea.inputarea').first();
    const editorLines = editor.locator('.view-lines').first();
    await editor
      .locator('.view-line')
      .first()
      .click({ position: { x: 0, y: 8 } });
    await editorInput.click({ force: true });
    await expect(editorInput).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.insertText(`// ${marker}\n`);
    await expect(editorLines).toContainText(marker);
    await expect(page.locator('.rf-dirty-gutter--added').first()).toBeVisible({ timeout: 30_000 });

    await expect(page.getByRole('tab', { name: 'Files', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const srcRow = page
      .locator('.rf-row[role="treeitem"][data-kind="dir"]', { hasText: 'src' })
      .first();
    await expect(srcRow).toBeVisible({ timeout: 30_000 });
    await expect(srcRow).toHaveAttribute('data-git', 'modified', { timeout: 30_000 });
    await srcRow.click();
    const mainRow = page
      .locator('.rf-row[role="treeitem"][data-kind="file"]', { hasText: 'main.js' })
      .first();
    await expect(mainRow).toBeVisible({ timeout: 30_000 });
    await expect(mainRow).toHaveAttribute('data-git', 'modified', { timeout: 30_000 });
    await expect(mainRow.locator('.rf-row__gitbadge')).toHaveText('M');

    await page.getByRole('tab', { name: 'GIT', exact: true }).click({ timeout: 10_000 });
    const scmRow = page.locator('.rf-scm__row', { hasText: 'src/main.js' }).first();
    await expect(scmRow).toBeVisible({ timeout: 30_000 });
    await expect(scmRow).toHaveAttribute('data-code', 'M');

    await editorTab(page, 'main.js').click();
    await expect(page.locator('.rf-dirty-gutter').first()).toBeVisible({ timeout: 30_000 });

    const shell = await openShellTerminal(page);
    await runShellLine(page, shell, `grep ${marker} src/main.js`);
    await expectShellContains(page, shell, marker);
  });

  test('main.js can close, reopen from Files, and appear in GIT after edits', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    await expect(editorTab(page, 'main.js')).toHaveAttribute('aria-selected', 'true', {
      timeout: 30_000,
    });

    await page.getByLabel('Close main.js').click();
    await expect(editorTab(page, 'main.js')).toHaveCount(0);
    await expect(
      trySetOpenEditorValue(page, '/src/main.js', 'console.log("hidden write");\n'),
    ).resolves.toBe(false);

    await openSrcFolder(page);
    await explorerRow(page, 'main.js', 'file').click();
    const mainTab = editorTab(page, 'main.js');
    await expect(mainTab).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });

    const marker = `git-main-reopen-${Date.now().toString(36)}`;
    const editor = page.locator('[data-testid="editor"]');
    const editorInput = editor.locator('textarea.inputarea').first();
    await editor
      .locator('.view-line')
      .first()
      .click({ position: { x: 0, y: 8 } });
    await editorInput.click({ force: true });
    await expect(editorInput).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.insertText(`// ${marker}\n`);
    await expect(editor.locator('.view-lines').first()).toContainText(marker);
    await expect(mainTab).toHaveAttribute('data-dirty', 'true');

    await expect(page.getByRole('tab', { name: 'Files', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const mainRow = explorerRow(page, 'main.js', 'file');
    await expect(mainRow).toHaveAttribute('data-git', 'modified', { timeout: 30_000 });
    await expect(mainRow.locator('.rf-row__gitbadge')).toHaveText('M');

    await page.getByRole('tab', { name: 'GIT', exact: true }).click({ timeout: 10_000 });
    await expect(page.getByLabel('Git', { exact: true })).toBeVisible({ timeout: 10_000 });
    const gitRow = page.locator('.rf-scm__row', { hasText: 'src/main.js' }).first();
    await expect(gitRow).toBeVisible({ timeout: 30_000 });
    await expect(gitRow).toHaveAttribute('data-code', 'M');
  });

  test('entry file autosave updates already-open GIT and then Files', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    await expect(editorTab(page, 'main.js')).toHaveAttribute('aria-selected', 'true', {
      timeout: 30_000,
    });

    await page.getByRole('tab', { name: 'GIT', exact: true }).click({ timeout: 10_000 });
    await expect(page.getByLabel('Git', { exact: true })).toBeVisible({ timeout: 10_000 });

    const marker = `git-open-${Date.now().toString(36)}`;
    const editor = page.locator('[data-testid="editor"]');
    const editorInput = editor.locator('textarea.inputarea').first();
    const editorLines = editor.locator('.view-lines').first();
    await editor
      .locator('.view-line')
      .first()
      .click({ position: { x: 0, y: 8 } });
    await editorInput.click({ force: true });
    await expect(editorInput).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.insertText(`// ${marker}\n`);
    await expect(editorLines).toContainText(marker);
    await expect(page.locator('.rf-dirty-gutter--added').first()).toBeVisible({ timeout: 30_000 });

    const scmRow = page.locator('.rf-scm__row', { hasText: 'src/main.js' }).first();
    await expect(scmRow).toBeVisible({ timeout: 30_000 });
    await expect(scmRow).toHaveAttribute('data-code', 'M');

    await page.getByRole('tab', { name: 'Files', exact: true }).click({ timeout: 10_000 });
    const srcRow = page
      .locator('.rf-row[role="treeitem"][data-kind="dir"]', { hasText: 'src' })
      .first();
    await expect(srcRow).toHaveAttribute('data-git', 'modified', { timeout: 30_000 });
    await srcRow.click();
    const mainRow = page
      .locator('.rf-row[role="treeitem"][data-kind="file"]', { hasText: 'main.js' })
      .first();
    await expect(mainRow).toBeVisible({ timeout: 30_000 });
    await expect(mainRow).toHaveAttribute('data-git', 'modified');
    await expect(mainRow.locator('.rf-row__gitbadge')).toHaveText('M');
  });

  test('same-path starter switch reopens entry tab from the fresh owner snapshot', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    const editorLines = page.locator('[data-testid="editor"] .view-lines').first();
    await expect(editorLines).toContainText("import project from './project.json'", {
      timeout: 30_000,
    });

    await pickStarter(page, 'node-worker');
    await expect(page.locator('[data-action="open-launcher"] .rf-chip__name')).toContainText(
      'Node worker map',
      { timeout: OWNER_DURABLE_TIMEOUT },
    );
    await expect(editorTab(page, 'main.js')).toHaveAttribute('aria-selected', 'true', {
      timeout: 30_000,
    });
    await expect(editorLines).toContainText("const notesUrl = new URL('src/runtime-notes.js'", {
      timeout: 30_000,
    });
    await expect(editorLines).not.toContainText("import project from './project.json'");

    const shell = await openShellTerminal(page);
    await runShellLine(page, shell, `grep "const notesUrl" src/main.js`);
    await expectShellContains(page, shell, 'const notesUrl');
  });

  test('saved project entry-file edits appear in GIT and Files under the project root', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);

    const projectName = `GIT Project ${Date.now().toString(36)}`;
    await saveScratchAs(page, projectName);
    await openSrcFolder(page, OWNER_DURABLE_TIMEOUT);
    const activeSavedMainRow = explorerRow(page, 'main.js', 'file');
    await expect(activeSavedMainRow).toBeVisible({ timeout: OWNER_DURABLE_TIMEOUT });
    await expect(activeSavedMainRow).toHaveAttribute('data-active', 'true', {
      timeout: OWNER_DURABLE_TIMEOUT,
    });

    const marker = `scm-project-${Date.now().toString(36)}`;
    const editor = page.locator('[data-testid="editor"]');
    const editorInput = editor.locator('textarea.inputarea').first();
    const editorLines = editor.locator('.view-lines').first();
    await editor
      .locator('.view-line')
      .first()
      .click({ position: { x: 0, y: 8 } });
    await editorInput.click({ force: true });
    await expect(editorInput).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.insertText(`// ${marker}\n`);
    await expect(editorLines).toContainText(marker);
    await expect(page.locator('.rf-dirty-gutter--added').first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('tab', { name: 'GIT', exact: true }).click({ timeout: 10_000 });
    const scmRow = page.locator('.rf-scm__row', { hasText: 'src/main.js' }).first();
    await expect(scmRow).toBeVisible({ timeout: 30_000 });
    await expect(scmRow).toHaveAttribute('data-code', 'M');

    await page.getByRole('tab', { name: 'Files', exact: true }).click({ timeout: 10_000 });
    const srcRow = page
      .locator('.rf-row[role="treeitem"][data-kind="dir"]', { hasText: 'src' })
      .first();
    await expect(srcRow).toHaveAttribute('data-git', 'modified', { timeout: 30_000 });
    await srcRow.click();
    const mainRow = page
      .locator('.rf-row[role="treeitem"][data-kind="file"]', { hasText: 'main.js' })
      .first();
    await expect(mainRow).toBeVisible({ timeout: 30_000 });
    await expect(mainRow).toHaveAttribute('data-git', 'modified');
    await expect(mainRow.locator('.rf-row__gitbadge')).toHaveText('M');
  });
});
