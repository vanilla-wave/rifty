import { type Page, expect, test } from '@playwright/test';
import {
  type TerminalSessionTarget,
  openShellTerminal,
  pickStarter,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

const OWNER_TIMEOUT = 90_000;

async function expectReopenedWorkspace(page: Page): Promise<void> {
  await expect(page.locator('.rf-app[data-workspace-owner="workspace"]')).toBeVisible({
    timeout: OWNER_TIMEOUT,
  });
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0);
}

async function expectSessionContains(
  page: Page,
  target: TerminalSessionTarget,
  marker: string,
  timeout: number,
): Promise<void> {
  await expect.poll(() => terminalBuffer(page, target), { timeout }).toContain(marker);
}

async function openProjects(page: Page): Promise<void> {
  const trigger = page.locator('[data-action="open-launcher"]');
  await expect(trigger).toBeEnabled({ timeout: OWNER_TIMEOUT });
  await trigger.click();
  await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /^Projects/ }).click();
}

async function closeLauncher(page: Page): Promise<void> {
  await page.locator('.rf-launcher__close').click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, { timeout: 5_000 });
}

async function saveWorkspace(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+KeyS');
  await expect(
    page.locator('.rf-toast[data-tone="success"]').filter({ hasText: /^Saved$/ }),
  ).toBeVisible({ timeout: OWNER_TIMEOUT });
}

async function setOpenEditorValue(page: Page, path: string, text: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ p, t }) => {
            const fn = (
              globalThis as {
                __riftySetEditorValue?: (path: string, text: string) => boolean;
              }
            ).__riftySetEditorValue;
            return fn ? fn(p, t) : false;
          },
          { p: path, t: text },
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function recordMainJsTabPaintsOnNextDocument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = globalThis as typeof globalThis & { __riftySawMainJsTab?: boolean };
    state.__riftySawMainJsTab = false;
    const scan = (): void => {
      for (const tab of document.querySelectorAll(
        '[role="tablist"][aria-label="Open editors"] [role="tab"]',
      )) {
        if (tab.querySelector('.rf-tab__label')?.textContent?.trim() === 'main.js') {
          state.__riftySawMainJsTab = true;
        }
      }
    };
    const start = (): void => {
      scan();
      new MutationObserver(scan).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });
}

/**
 * The public Saved acknowledgement is the durability boundary. Every scenario
 * establishes project identity and bytes through the public editor, explorer,
 * catalog, chip, preview, or a stable shell session, awaits Saved, then reloads.
 * Owner storage paths and catalog files are deliberately outside this contract.
 */
test.describe('workspace state persists across reload', () => {
  test('a shell-written file survives page.reload()', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    const marker = `persist-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    await page.goto('/');
    await pickStarter(page, 'project-files');
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 60_000 });
    const shell = await openShellTerminal(page);

    await runTerminalLine(page, `echo ${marker} > ./persist.txt`, shell);
    await runTerminalLine(page, 'cat ./persist.txt', shell);
    await expectSessionContains(page, shell, marker, 15_000);
    const persistedFile = page.getByRole('treeitem', { name: /persist\.txt/ });
    await expect(persistedFile).toBeVisible({ timeout: 15_000 });
    await saveWorkspace(page);

    await page.reload();
    await expectReopenedWorkspace(page);
    await expect(page.locator('[data-action="open-launcher"] .rf-chip__name')).toHaveText(
      'Project files scratch',
      { timeout: OWNER_TIMEOUT },
    );
    await expect(persistedFile).toBeVisible({ timeout: OWNER_TIMEOUT });
    await persistedFile.click();
    await expect(page.locator('[data-testid="editor"] .view-lines').first()).toContainText(marker, {
      timeout: 15_000,
    });

    const reopenedShell = await openShellTerminal(page);
    await runTerminalLine(page, 'cat ./persist.txt', reopenedShell);
    await expectSessionContains(page, reopenedShell, marker, 20_000);
  });

  test('an edited starter becomes a durable scratch draft and reopens after reload', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    const marker = `draft-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    await page.goto('/');
    await pickStarter(page, 'project-files');

    const editor = page.locator('[data-testid="editor"]');
    await setOpenEditorValue(page, '/src/main.js', `// ${marker}\n`);
    await expect(editor.locator('.view-lines').first()).toContainText(marker);
    await expect(page.locator('[data-action="open-launcher"][data-dirty="true"]')).toBeVisible({
      timeout: 10_000,
    });

    await openProjects(page);
    const scratch = page.locator('.rf-scratch[data-active="true"]');
    await expect(scratch).toContainText('Project files scratch', { timeout: OWNER_TIMEOUT });
    await expect(scratch).toContainText('edited just now · not yet saved');
    await closeLauncher(page);
    await saveWorkspace(page);

    await page.reload();
    await expectReopenedWorkspace(page);
    const chip = page.locator('[data-action="open-launcher"]');
    await expect(chip.locator('.rf-chip__name')).toHaveText('Project files scratch', {
      timeout: OWNER_TIMEOUT,
    });
    await expect(chip).toHaveAttribute('data-dirty', 'true');
    await expect(page.getByRole('tab', { name: /main\.js/ })).toBeVisible({
      timeout: OWNER_TIMEOUT,
    });
    await expect(editor.locator('.view-lines').first()).toContainText(marker, {
      timeout: OWNER_TIMEOUT,
    });

    await openProjects(page);
    await expect(scratch).toContainText('Project files scratch', { timeout: OWNER_TIMEOUT });
    await expect(scratch).toContainText('edited just now · not yet saved');
    await closeLauncher(page);
  });

  test('a TypeScript scratch draft reloads without painting the default JavaScript entry tab', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    const marker = `ts-draft-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    await page.goto('/');
    await pickStarter(page, 'typescript-ls');
    const editorLines = page.locator('[data-testid="editor"] .view-lines').first();
    await expect(editorLines).toContainText('LibraryShape', { timeout: 60_000 });

    await setOpenEditorValue(page, '/src/main.ts', `// ${marker}\n`);
    await expect(editorLines).toContainText(marker);
    await expect(page.locator('[data-action="open-launcher"][data-dirty="true"]')).toBeVisible({
      timeout: 10_000,
    });
    await saveWorkspace(page);

    await recordMainJsTabPaintsOnNextDocument(page);
    await page.reload();
    await expectReopenedWorkspace(page);
    await expect(page.locator('[data-action="open-launcher"][data-dirty="true"]')).toBeVisible({
      timeout: OWNER_TIMEOUT,
    });
    await expect(page.getByRole('tab', { name: /main\.ts/ })).toBeVisible({
      timeout: OWNER_TIMEOUT,
    });
    await expect(editorLines).toContainText(marker, { timeout: OWNER_TIMEOUT });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (globalThis as typeof globalThis & { __riftySawMainJsTab?: boolean })
              .__riftySawMainJsTab === true,
        ),
      )
      .toBe(false);
  });

  test('a reopened scratch draft relaunches its dev server (console + preview) after reload', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    const marker = `revive-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    await page.goto('/');
    await pickStarter(page, 'typescript-ls');
    await expect(page.locator('.rf-livepill[data-state="running"]')).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.locator('[data-testid="preview"]')).toBeVisible({ timeout: 90_000 });

    const editorLines = page.locator('[data-testid="editor"] .view-lines').first();
    await setOpenEditorValue(page, '/src/main.ts', `// ${marker}\n`);
    await expect(editorLines).toContainText(marker);
    await expect(page.locator('[data-action="open-launcher"][data-dirty="true"]')).toBeVisible({
      timeout: 10_000,
    });
    await saveWorkspace(page);

    // After Saved, reload must restore both halves of the same user session: the
    // edited draft and its running dev-server surface.
    await page.reload();
    await expectReopenedWorkspace(page);
    await expect(page.locator('[data-action="open-launcher"][data-dirty="true"]')).toBeVisible({
      timeout: OWNER_TIMEOUT,
    });
    await expect(page.getByRole('tab', { name: /main\.ts/ })).toBeVisible({
      timeout: OWNER_TIMEOUT,
    });
    await expect(editorLines).toContainText(marker, { timeout: OWNER_TIMEOUT });
    await expect(page.locator('.rf-livepill[data-state="running"]')).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.locator('[data-testid="preview"]')).toBeVisible({ timeout: 90_000 });
  });

  test('a saved project reopens after reload instead of an empty scratch', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    const marker = `saved-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const projectName = `Saved ${marker}`;

    await page.goto('/');
    await pickStarter(page, 'project-files');

    await setOpenEditorValue(page, '/src/main.js', `// ${marker}\n`);
    await expect(page.locator('[data-action="open-launcher"][data-dirty="true"]')).toBeVisible({
      timeout: 10_000,
    });
    await openProjects(page);
    await page.click('[data-action="save-scratch"]');
    const dialog = page.locator('.rf-dialog[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.locator('input.rf-dialog__input').fill(projectName);
    await dialog.getByRole('button', { name: 'Save project' }).click();
    await expect(dialog).toHaveCount(0, { timeout: OWNER_TIMEOUT });
    const projectCard = page.locator('.rf-pcard', { hasText: projectName }).first();
    await expect(projectCard).toBeVisible({ timeout: OWNER_TIMEOUT });
    await expect(projectCard).toHaveAttribute('data-active', 'true');
    await closeLauncher(page);
    const chip = page.locator('[data-action="open-launcher"]');
    await expect(chip.locator('.rf-chip__name')).toHaveText(projectName, {
      timeout: OWNER_TIMEOUT,
    });
    await expect(chip).toHaveAttribute('data-dirty', 'false');
    await saveWorkspace(page);

    await page.reload();
    await expectReopenedWorkspace(page);
    await expect(chip.locator('.rf-chip__name')).toHaveText(projectName, {
      timeout: OWNER_TIMEOUT,
    });
    await expect(chip).toHaveAttribute('data-dirty', 'false');
    await expect(page.getByRole('tab', { name: /main\.js/ })).toBeVisible({
      timeout: OWNER_TIMEOUT,
    });
    await expect(page.locator('[data-testid="editor"] .view-lines').first()).toContainText(marker, {
      timeout: OWNER_TIMEOUT,
    });

    await openProjects(page);
    await expect(projectCard).toBeVisible({ timeout: OWNER_TIMEOUT });
    await expect(projectCard).toHaveAttribute('data-active', 'true');
    await closeLauncher(page);

    const reopenedShell = await openShellTerminal(page);
    const modeHint = page.locator(
      `.rf-terminal-slot[data-session-id="${reopenedShell.sessionId}"] [data-testid="terminal-mode-hint"]`,
    );
    await expect(modeHint).toContainText('Commands run in /;', { timeout: 30_000 });
    await runTerminalLine(page, 'cat ./src/main.js', reopenedShell);
    await expectSessionContains(page, reopenedShell, marker, 20_000);
  });
});
