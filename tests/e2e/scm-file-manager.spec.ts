import { readFile } from 'node:fs/promises';
import { type Page, expect, test } from '@playwright/test';
import { readWorkspaceJson, readWorkspaceText } from './helpers/opfs.ts';
import { openShellTerminal, runTerminalLineSettled, terminalBuffer } from './helpers/playground.ts';

const OWNER_DURABLE_TIMEOUT = 90_000;
type ProjectIndexSnapshot = {
  activeId: string;
  scratch: { starter: string; dirty: boolean } | null;
  projects: { id: string; name: string }[];
};

async function readProjectIndex(page: Page): Promise<ProjectIndexSnapshot | null> {
  return readWorkspaceJson<ProjectIndexSnapshot>(page, '/.rifty-project-index.json');
}

async function openProjects(page: Page): Promise<void> {
  await page.click('[data-action="open-launcher"]');
  await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /^Projects/ }).click();
}

async function projectIdForName(page: Page, name: string): Promise<string> {
  const readId = async (): Promise<string> => {
    const index = await readProjectIndex(page);
    return index?.projects.find((p) => p.name === name)?.id ?? '';
  };
  await expect.poll(readId, { timeout: OWNER_DURABLE_TIMEOUT }).not.toBe('');
  return readId();
}

async function saveScratchAs(page: Page, name: string): Promise<string> {
  await openProjects(page);
  await page.click('[data-action="save-scratch"]');
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.locator('input.rf-dialog__input').fill(name);
  await dialog.getByRole('button', { name: 'Save project' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 5_000 });
  const id = await projectIdForName(page, name);
  await page.locator('.rf-launcher__close').click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator('[data-action="open-launcher"] .rf-chip__name')).toHaveText(name, {
    timeout: OWNER_DURABLE_TIMEOUT,
  });
  return id;
}

async function bootScmFileManager(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.removeItem('rf.layout.v2');
  });
  await page.goto('/');
  await expect.poll(() => terminalBuffer(page), { timeout: 30_000 }).toMatch(/VITE v.*ready/u);
}

function explorerRow(page: Page, name: string, kind?: 'file' | 'dir') {
  const selector =
    kind === undefined
      ? '.rf-row[role="treeitem"]'
      : `.rf-row[role="treeitem"][data-kind="${kind}"]`;
  return page.locator(selector, { hasText: name }).first();
}

async function openSrcFolder(page: Page): Promise<void> {
  const srcRow = explorerRow(page, 'src', 'dir');
  await expect(srcRow).toBeVisible({ timeout: 30_000 });
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

async function createExplorerEntry(
  page: Page,
  parent: string,
  kind: 'file' | 'folder',
  name: string,
): Promise<void> {
  await openExplorerContextMenu(page, parent, 'dir');
  await page
    .getByRole('menuitem', { name: kind === 'file' ? 'New File' : 'New Folder' })
    .click({ force: true });
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

async function setOpenEditorValue(page: Page, path: string, text: string): Promise<void> {
  const ok = await page.evaluate(
    ({ path: targetPath, text: targetText }) => {
      const fn = (globalThis as { __riftySetEditorValue?: (path: string, text: string) => boolean })
        .__riftySetEditorValue;
      return fn?.(targetPath, targetText) ?? false;
    },
    { path, text },
  );
  expect(ok).toBe(true);
}

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
    await openSrcFolder(page);

    const seq = Date.now().toString(36);
    const file = `ctx-${seq}.txt`;
    const dir = `ctx-dir-${seq}`;
    await openExplorerContextMenu(page, 'src', 'dir');
    await page.getByRole('menuitem', { name: 'New File' }).click({ force: true });
    await page.locator('.rf-row__input').fill(file);
    await page.locator('.rf-row__input').press('Enter');
    await expect(explorerRow(page, file, 'file')).toBeVisible({ timeout: 30_000 });

    await openExplorerContextMenu(page, 'src', 'dir');
    await page.getByRole('menuitem', { name: 'New Folder' }).click({ force: true });
    await page.locator('.rf-row__input').fill(dir);
    await page.locator('.rf-row__input').press('Enter');
    await expect(explorerRow(page, dir, 'dir')).toBeVisible({ timeout: 30_000 });

    await openShellTerminal(page);
    await runTerminalLineSettled(
      page,
      `test -f src/${file} && test -d src/${dir} && echo context-crud-ok-${seq}`,
      60_000,
    );
    await expect
      .poll(() => terminalBuffer(page), { timeout: 15_000 })
      .toContain(`context-crud-ok-${seq}`);
  });

  test('SCM stage uses the latest pending editor bytes', async ({ page, browserName }) => {
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

    await page.getByRole('tab', { name: 'SCM' }).click({ timeout: 10_000 });
    const scmRow = page.locator('.rf-scm__row', { hasText: 'README.md' }).first();
    await expect(scmRow).toBeVisible({ timeout: 30_000 });
    await scmRow.getByLabel('Stage README.md').click();

    const stagedGroup = page.locator('.rf-scm__group').nth(0);
    await expect(stagedGroup.locator('.rf-scm__row', { hasText: 'README.md' })).toBeVisible({
      timeout: 30_000,
    });

    await openShellTerminal(page);
    await runTerminalLineSettled(page, `git diff --cached -- README.md | grep ${marker}`, 60_000);
    await expect.poll(() => terminalBuffer(page), { timeout: 15_000 }).toContain(marker);

    const message = `scm-stage-commit-${Date.now().toString(36)}`;
    await page.getByLabel('Commit message').fill(message);
    await page.getByRole('button', { name: 'Commit' }).click();
    await expect(page.locator('.rf-scm__commit', { hasText: message })).toBeVisible({
      timeout: 30_000,
    });
    await runTerminalLineSettled(page, `git log --oneline -1 | grep ${message}`, 60_000);
    await expect.poll(() => terminalBuffer(page), { timeout: 15_000 }).toContain(message);
  });

  test('clipboard duplicate and cut-paste mutate the owner tree', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    await openSrcFolder(page);

    const seq = Date.now().toString(36);
    const file = `clip-${seq}.txt`;
    const copy = `clip-${seq} copy.txt`;
    const dest = `clip-dest-${seq}`;
    await createExplorerEntry(page, 'src', 'file', file);
    await createExplorerEntry(page, 'src', 'folder', dest);

    await openExplorerContextMenu(page, file, 'file');
    await page.getByRole('menuitem', { name: 'Duplicate' }).click({ force: true });
    await expect(explorerRow(page, copy, 'file')).toBeVisible({ timeout: 30_000 });

    await openExplorerContextMenu(page, file, 'file');
    await page.getByRole('menuitem', { name: 'Cut' }).click({ force: true });
    await openExplorerContextMenu(page, dest, 'dir');
    await page.getByRole('menuitem', { name: 'Paste' }).click({ force: true });

    const destRow = explorerRow(page, dest, 'dir');
    if ((await destRow.getAttribute('aria-expanded')) !== 'true')
      await destRow.click({ force: true });
    await expect(explorerRow(page, file, 'file')).toBeVisible({ timeout: 30_000 });

    await openShellTerminal(page);
    await runTerminalLineSettled(
      page,
      `test -f src/${copy} && test -f src/${dest}/${file} && test ! -e src/${file} && echo clipboard-ok-${seq}`,
      60_000,
    );
    await expect
      .poll(() => terminalBuffer(page), { timeout: 15_000 })
      .toContain(`clipboard-ok-${seq}`);
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
    await page.getByRole('menuitem', { name: 'Download' }).click({ force: true });
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(file);
    const downloadedPath = await download.path();
    expect(downloadedPath).not.toBeNull();
    expect(await readFile(downloadedPath!, 'utf8')).toBe(content);

    await createExplorerEntry(page, 'src', 'folder', dest);
    await dropExplorerPathOnDir(page, `/scratch/src/${file}`, dest);
    const destRow = explorerRow(page, dest, 'dir');
    if ((await destRow.getAttribute('aria-expanded')) !== 'true')
      await destRow.click({ force: true });
    await expect(explorerRow(page, file, 'file')).toBeVisible({ timeout: 30_000 });

    await openShellTerminal(page);
    await runTerminalLineSettled(
      page,
      `test ! -e src/${file} && grep uploaded-owner-bytes-${seq} src/${dest}/${file} && echo upload-move-ok-${seq}`,
      60_000,
    );
    await expect
      .poll(() => terminalBuffer(page), { timeout: 15_000 })
      .toContain(`upload-move-ok-${seq}`);
  });

  test('SCM splits staged and worktree rows for MM and AD states', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    await openShellTerminal(page);

    const seq = Date.now().toString(36);
    const stagedDelete = `staged-delete-${seq}.txt`;
    await runTerminalLineSettled(
      page,
      `printf '\\nmm-staged-${seq}\\n' >> README.md && printf 'ad-${seq}\\n' > ${stagedDelete}`,
      60_000,
    );

    await page.getByRole('tab', { name: 'SCM' }).click({ timeout: 10_000 });
    await expect(page.getByLabel('Source Control')).toBeVisible({ timeout: 10_000 });
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

    await runTerminalLineSettled(
      page,
      `printf 'mm-worktree-${seq}\\n' >> README.md && rm ${stagedDelete}`,
      60_000,
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
    await page.getByRole('menuitem', { name: 'New File' }).click({ force: true });
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

    await setOpenEditorValue(page, `/scratch/src/${oldName}`, `edited-before-rename-${seq}\n`);
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

    await runTerminalLineSettled(
      page,
      `test ! -e src/${oldName} && grep edited-before-rename-${seq} src/${newName} && echo rename-ok-${seq}`,
      60_000,
    );
    await expect
      .poll(() => terminalBuffer(page), { timeout: 15_000 })
      .toContain(`rename-ok-${seq}`);

    await setOpenEditorValue(page, `/scratch/src/${newName}`, `edited-before-delete-${seq}\n`);
    page.once('dialog', (dialog) => void dialog.accept());
    await newRow.focus();
    await page.keyboard.press('Delete');
    await expect(
      page.locator('.rf-row[role="treeitem"][data-kind="file"]', { hasText: newName }),
    ).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(700);
    await runTerminalLineSettled(page, `test ! -e src/${newName} && echo delete-ok-${seq}`, 60_000);
    await expect
      .poll(() => terminalBuffer(page), { timeout: 15_000 })
      .toContain(`delete-ok-${seq}`);
  });

  test('renaming the program mirror path does not silently recreate src/main.js', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootScmFileManager(page);
    await openSrcFolder(page);

    const seq = Date.now().toString(36);
    const renamed = `main-renamed-${seq}.js`;
    await setOpenEditorValue(
      page,
      '/scratch/src/main.js',
      `console.log("program-before-${seq}");\n`,
    );
    const mainRow = explorerRow(page, 'main.js', 'file');
    await expect(mainRow).toBeVisible({ timeout: 30_000 });
    await mainRow.focus();
    await page.keyboard.press('F2');
    await page.locator('.rf-row__input').fill(renamed);
    await page.locator('.rf-row__input').press('Enter');
    await expect(explorerRow(page, renamed, 'file')).toBeVisible({ timeout: 30_000 });

    await setOpenEditorValue(
      page,
      '/scratch/src/main.js',
      `console.log("should-not-recreate-${seq}");\n`,
    );

    await openShellTerminal(page);
    await runTerminalLineSettled(
      page,
      `node -e "const fs=require('fs'); if (fs.existsSync('src/main.js')) process.exit(1); const text=fs.readFileSync('src/${renamed}','utf8'); if (!text.includes('program-before-${seq}')) process.exit(2); if (text.includes('should-not-recreate-${seq}')) process.exit(3); console.log('program-mirror-ok-${seq}')"`,
      60_000,
    );
    await expect
      .poll(() => terminalBuffer(page), { timeout: 15_000 })
      .toContain(`program-mirror-ok-${seq}`);

    const projectName = `Program Mirror Reset ${seq}`;
    const projectId = await saveScratchAs(page, projectName);
    await expect
      .poll(
        async () => {
          const index = await readProjectIndex(page);
          return index?.activeId ?? '';
        },
        { timeout: OWNER_DURABLE_TIMEOUT },
      )
      .toBe(projectId);

    const resetMarker = `program-root-reset-${seq}`;
    await page.getByRole('tab', { name: 'src/main.js' }).click();
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
    await page.keyboard.insertText(`// ${resetMarker}\n`);
    await expect(editorLines).toContainText(resetMarker);
    await expect
      .poll(() => readWorkspaceText(page, `/projects/${projectId}/src/main.js`), {
        timeout: OWNER_DURABLE_TIMEOUT,
      })
      .toContain(resetMarker);
  });

  test('editor writes appear in SCM and mark changed editor lines', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await page.addInitScript(() => {
      localStorage.removeItem('rf.layout.v2');
    });
    await page.goto('/');
    await expect.poll(() => terminalBuffer(page), { timeout: 30_000 }).toMatch(/VITE v.*ready/u);

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

    await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
    await expect(readmeRow).toHaveAttribute('data-git', 'modified', { timeout: 30_000 });
    await expect(readmeRow.locator('.rf-row__gitbadge')).toHaveText('M');

    await page.getByRole('tab', { name: 'SCM' }).click({ timeout: 10_000 });
    const scmRow = page.locator('.rf-scm__row', { hasText: 'README.md' }).first();
    await expect(scmRow).toBeVisible({ timeout: 30_000 });
    await expect(scmRow).toHaveAttribute('data-code', 'M');

    await page.getByRole('tab', { name: 'README.md' }).click();
    await expect(page.locator('.rf-dirty-gutter').first()).toBeVisible({ timeout: 30_000 });

    await openShellTerminal(page);
    await runTerminalLineSettled(page, `grep ${marker} README.md`, 60_000);
    await expect.poll(() => terminalBuffer(page), { timeout: 15_000 }).toContain(marker);
  });

  test('program editor writes appear in SCM and mark changed lines', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await page.addInitScript(() => {
      localStorage.removeItem('rf.layout.v2');
    });
    await page.goto('/');
    await expect.poll(() => terminalBuffer(page), { timeout: 30_000 }).toMatch(/VITE v.*ready/u);
    await expect(page.getByRole('tab', { name: 'src/main.js' })).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 30_000 },
    );

    const marker = `scm-program-${Date.now().toString(36)}`;
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

    await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
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

    await page.getByRole('tab', { name: 'SCM' }).click({ timeout: 10_000 });
    const scmRow = page.locator('.rf-scm__row', { hasText: 'src/main.js' }).first();
    await expect(scmRow).toBeVisible({ timeout: 30_000 });
    await expect(scmRow).toHaveAttribute('data-code', 'M');

    await page.getByRole('tab', { name: 'src/main.js' }).click();
    await expect(page.locator('.rf-dirty-gutter').first()).toBeVisible({ timeout: 30_000 });

    await openShellTerminal(page);
    await runTerminalLineSettled(page, `grep ${marker} src/main.js`, 60_000);
    await expect.poll(() => terminalBuffer(page), { timeout: 15_000 }).toContain(marker);
  });

  test('program editor autosave updates already-open SCM and then Files', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await page.addInitScript(() => {
      localStorage.removeItem('rf.layout.v2');
    });
    await page.goto('/');
    await expect.poll(() => terminalBuffer(page), { timeout: 30_000 }).toMatch(/VITE v.*ready/u);
    await expect(page.getByRole('tab', { name: 'src/main.js' })).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 30_000 },
    );

    await page.getByRole('tab', { name: 'SCM' }).click({ timeout: 10_000 });
    await expect(page.getByLabel('Source Control')).toBeVisible({ timeout: 10_000 });

    const marker = `scm-open-${Date.now().toString(36)}`;
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

    await page.getByRole('tab', { name: 'Files' }).click({ timeout: 10_000 });
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

  test('saved project program edits appear in SCM and Files under the project root', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await page.addInitScript(() => {
      localStorage.removeItem('rf.layout.v2');
    });
    await page.goto('/');
    await expect.poll(() => terminalBuffer(page), { timeout: 30_000 }).toMatch(/VITE v.*ready/u);

    const projectName = `SCM Project ${Date.now().toString(36)}`;
    const projectId = await saveScratchAs(page, projectName);
    await expect
      .poll(
        async () => {
          const index = await readProjectIndex(page);
          return index?.activeId ?? '';
        },
        { timeout: OWNER_DURABLE_TIMEOUT },
      )
      .toBe(projectId);
    await expect(
      page.locator('.rf-row[role="treeitem"][data-kind="dir"]', { hasText: 'src' }).first(),
    ).toBeVisible({ timeout: OWNER_DURABLE_TIMEOUT });

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

    await page.getByRole('tab', { name: 'SCM' }).click({ timeout: 10_000 });
    const scmRow = page.locator('.rf-scm__row', { hasText: 'src/main.js' }).first();
    await expect(scmRow).toBeVisible({ timeout: 30_000 });
    await expect(scmRow).toHaveAttribute('data-code', 'M');

    await page.getByRole('tab', { name: 'Files' }).click({ timeout: 10_000 });
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
