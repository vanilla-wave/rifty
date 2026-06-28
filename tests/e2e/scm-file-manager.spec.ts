import { type Page, expect, test } from '@playwright/test';
import { readWorkspaceJson } from './helpers/opfs.ts';
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
