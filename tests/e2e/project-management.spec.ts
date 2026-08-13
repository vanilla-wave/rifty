/**
 * ADR-0165 post-review e2e — the multi-project flows the review found shipped
 * broken or unguarded, driven end-to-end against the real owner:
 *  - §9 dirty-scratch SWITCH dialog: "Discard & continue" activates the target
 *    project (it used to re-open the dialog + respawn the wrong starter), and
 *    "Save scratch, then continue" saves the draft AND continues (it used to stop
 *    after the save).
 *  - §6 named-project RESET really re-seeds the project tree (it used to toast +
 *    bump editedAt while the tree was untouched — a lying happy-path).
 *
 * SERIAL (test.describe.configure): each test boots its own COI/SAB workspace
 * owner (heavy WASI), so running them concurrently would starve owner transitions.
 * Serial keeps peak owner-concurrency from this file at one; it still overlaps the
 * rest of the fullyParallel suite.
 *
 * RED-checks:
 *  - Discard: restore `applyPending` to re-call the dirty-guarded `requestSwitch`
 *    → the dialog re-opens and the target project never becomes active.
 *  - Save-then: restore `onSwitchSaveThen` to only open the save dialog → after
 *    Save the chip shows the SAVED draft, not Alpha.
 *  - Reset: make the owner reset a no-op → `stray.txt` survives after activating
 *    the reset project.
 */
import { type Page, expect, test } from '@playwright/test';
import {
  pickStarter as pickStarterFromLauncher,
  readActiveProjectText,
  runTerminalLineSettled,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

// A taller viewport centers the launcher modal BELOW the top-right toast, so the
// close button is never transiently covered (the toast auto-dismisses too, but this
// keeps the clicks immediate under the full-suite load).
test.use({ viewport: { width: 1280, height: 940 } });

// Owner transitions slow down when several workers boot under full-suite load.
const OWNER_TIMEOUT = 90_000;
const TERMINAL_TAB = '.rf-terminal-tab__select[role="tab"]';

async function bootScratch(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 15_000,
  });
  await pickStarterFromLauncher(page, 'project-files');
  await expect(hintLocator(page)).toContainText('Commands run in /;', { timeout: 30_000 });
}

function hintLocator(page: Page) {
  return page.locator('[data-testid="terminal-mode-hint"]').first();
}

async function newShell(page: Page): Promise<void> {
  const before = await page.locator(TERMINAL_TAB).count();
  await page.getByRole('button', { name: 'New terminal' }).click();
  await expect(page.locator(TERMINAL_TAB)).toHaveCount(before + 1, { timeout: 10_000 });
  await expect(page.locator('.rf-terminal-slot[data-active="true"]')).toBeVisible({
    timeout: 10_000,
  });
}

async function pickStarter(page: Page, id: string): Promise<void> {
  await page.click('[data-action="open-launcher"]');
  await page.getByRole('button', { name: 'Starters', exact: true }).click();
  await page.click(`[data-preset="${id}"]`);
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, {
    timeout: OWNER_TIMEOUT,
  });
}

async function openProjects(page: Page): Promise<void> {
  await page.click('[data-action="open-launcher"]');
  await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /^Projects/ }).click();
}

async function expectProjectChipName(page: Page, name: string): Promise<void> {
  await expect(page.locator('[data-action="open-launcher"] .rf-chip__name')).toHaveText(name, {
    timeout: OWNER_TIMEOUT,
  });
}

async function saveScratchAs(page: Page, name: string): Promise<string> {
  await openProjects(page);
  await page.click('[data-action="save-scratch"]');
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.locator('input.rf-dialog__input').fill(name);
  await dialog.getByRole('button', { name: 'Save project' }).click();
  await expect(dialog).toHaveCount(0, { timeout: OWNER_TIMEOUT });
  const card = page.locator('.rf-pcard', { hasText: name }).first();
  await expect(card).toBeVisible({ timeout: OWNER_TIMEOUT });
  await expect(card).toHaveAttribute('data-active', 'true');
  const projectId = await card.getAttribute('data-project');
  if (projectId === null || projectId.length === 0) {
    throw new Error(`Saved project ${name} has no owner project id`);
  }
  await page.locator('.rf-launcher__close').click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, { timeout: 5_000 });
  await expectProjectChipName(page, name);
  return projectId;
}

async function expectSavedProject(page: Page, name: string): Promise<void> {
  await openProjects(page);
  const card = page.locator('.rf-pcard', { hasText: name }).first();
  await expect(card).toBeVisible({ timeout: OWNER_TIMEOUT });
  await page.locator('.rf-launcher__close').click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, { timeout: 5_000 });
}

async function switchToSavedProject(
  page: Page,
  name: string,
  options: { readonly discardDirtyScratch?: boolean } = {},
): Promise<void> {
  await openProjects(page);
  const card = page.locator('.rf-pcard', { hasText: name }).first();
  await expect(card).toHaveAttribute('role', 'button', { timeout: OWNER_TIMEOUT });
  await card.click();
  if (options.discardDirtyScratch) {
    const dialog = page.locator('.rf-dialog[role="dialog"]');
    await expect(dialog).toContainText('Discard unsaved scratch?', { timeout: 5_000 });
    await dialog.getByRole('button', { name: 'Discard & continue' }).click();
  }
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, {
    timeout: OWNER_TIMEOUT,
  });
  await expectProjectChipName(page, name);
  await expect(page.locator('.rf-livepill[data-state="switching"]')).toHaveCount(0, {
    timeout: OWNER_TIMEOUT,
  });
}

/** Insert a marker via Monaco's real input path → owner file write → scratch dirty. */
async function dirtyScratchViaEditor(page: Page): Promise<string> {
  const marker = `// dirty-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const editor = page.locator('[data-testid="editor"]');
  await editor
    .locator('.view-line')
    .first()
    .click({ position: { x: 0, y: 8 } });
  const editorInput = editor.locator('textarea.inputarea').first();
  await editorInput.click({ force: true });
  await expect(editorInput).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.insertText(`${marker}\n`);
  await expect(page.locator('[data-action="open-launcher"][data-dirty="true"]')).toBeVisible({
    timeout: 10_000,
  });
  return marker;
}

/** Save scratch → Alpha, then spin a fresh DIRTY node-worker scratch to switch FROM. */
async function bootDirtyScratchWithSavedAlpha(
  page: Page,
  alphaName: string,
): Promise<{
  readonly alphaMarker: string;
  readonly dirtyMarker: string;
  readonly alphaProjectId: string;
}> {
  const hint = hintLocator(page);
  const alphaMarker = `alpha-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await bootScratch(page);
  await newShell(page);
  await runTerminalLineSettled(page, `echo ${alphaMarker} > project-proof.txt`, 30_000);
  const alphaProjectId = await saveScratchAs(page, alphaName);
  await pickStarter(page, 'node-worker');
  await expect(hint).toContainText('Commands run in /;', { timeout: 30_000 });
  const dirtyMarker = await dirtyScratchViaEditor(page);
  return Object.freeze({ alphaMarker, dirtyMarker, alphaProjectId });
}

test.describe.configure({ mode: 'serial' });

test.describe('starter git baseline', () => {
  test('fresh default starter keeps generated package-lock.json inside Initial commit', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);

    await bootScratch(page);
    await newShell(page);
    const packageLock = await readActiveProjectText(page, 'package-lock.json', OWNER_TIMEOUT);
    expect(packageLock.exists).toBe(true);
    await runTerminalLineSettled(page, 'git status --porcelain && echo STATUS_DONE', 60_000);
    const output = await terminalBuffer(page);
    const statusBlock = output.slice(output.lastIndexOf('git status --porcelain'));
    expect(statusBlock).toContain('STATUS_DONE');
    expect(statusBlock).not.toContain('package-lock.json');
    expect(statusBlock).not.toContain('??');
  });

  test('reopen without .gitignore excludes the materialized dependency tree from HEAD', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(300_000);

    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const projectName = `No-ignore-baseline-${tag}`;
    await bootScratch(page);
    await newShell(page);

    expect(
      await readActiveProjectText(page, 'node_modules/vite/package.json', OWNER_TIMEOUT),
    ).toMatchObject({
      exists: true,
    });
    await runTerminalLineSettled(page, 'rm -rf .git .gitignore', 60_000);
    expect(await readActiveProjectText(page, '.gitignore')).toEqual({ exists: false, text: '' });

    // Save keeps the owner tree. Opening it again is the public boundary that
    // creates the unborn Starter baseline over materialized dependencies.
    await saveScratchAs(page, projectName);
    await pickStarter(page, 'node-worker');
    await switchToSavedProject(page, projectName);
    await newShell(page);

    expect(await readActiveProjectText(page, '.gitignore')).toEqual({ exists: false, text: '' });
    expect(await readActiveProjectText(page, 'node_modules/vite/package.json')).toMatchObject({
      exists: true,
    });
    const sourceProbe = 'git show HEAD:src/main.js';
    const dependencyProbe = 'git show HEAD:node_modules/vite/package.json';
    await runTerminalLineSettled(page, sourceProbe, 60_000);
    await runTerminalLineSettled(page, dependencyProbe, 60_000);
    expect(await terminalHistoryExitCode(page, sourceProbe)).toBe(0);
    expect(await terminalHistoryExitCode(page, dependencyProbe)).not.toBe(0);
  });
});

test.describe('ADR-0165 §9 — dirty-scratch switch dialog', () => {
  test('Discard & continue switches to the target project (target active, no re-opened dialog)', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(240_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));

    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const alphaName = `Alpha-${tag}`;
    const { alphaMarker, alphaProjectId } = await bootDirtyScratchWithSavedAlpha(page, alphaName);
    const hint = hintLocator(page);

    // A program in the active scratch must not address the retained Alpha tree
    // through the owner's physical layout. Before ADR-0280 this exact absolute
    // path overwrote Alpha; the project-rooted namespace rejects it before I/O.
    await newShell(page);
    await runTerminalLineSettled(
      page,
      `echo corrupted > '/.rifty/workbench/v1/projects/${alphaProjectId}/tree/project-proof.txt'`,
      30_000,
    );

    await openProjects(page);
    const target = page.locator('.rf-pcard', { hasText: alphaName }).first();
    await expect(target).toHaveAttribute('role', 'button', { timeout: OWNER_TIMEOUT });
    await target.click();
    const dialog = page.locator('.rf-dialog[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toContainText('Discard unsaved scratch');

    await dialog.getByRole('button', { name: 'Discard & continue' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });
    await expectProjectChipName(page, alphaName);
    await expect(hint).toContainText('Commands run in /;', { timeout: OWNER_TIMEOUT });
    await newShell(page);
    expect(await readActiveProjectText(page, 'project-proof.txt', OWNER_TIMEOUT)).toEqual({
      exists: true,
      text: alphaMarker,
    });
  });

  test('Save scratch, then continue saves the draft AND continues to the target', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(240_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));

    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const gammaName = `Gamma-${tag}`;
    const alphaName = `Alpha-${tag}`;
    const { alphaMarker, dirtyMarker } = await bootDirtyScratchWithSavedAlpha(page, alphaName);
    const hint = hintLocator(page);

    await openProjects(page);
    const target = page.locator('.rf-pcard', { hasText: alphaName }).first();
    await expect(target).toHaveAttribute('role', 'button', { timeout: OWNER_TIMEOUT });
    await target.click();
    const dialog = page.locator('.rf-dialog[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.getByRole('button', { name: 'Save scratch, then continue' }).click();
    await expect(dialog).toContainText('Save as project', { timeout: 5_000 });
    await dialog.locator('input.rf-dialog__input').fill(gammaName);
    await dialog.getByRole('button', { name: 'Save project' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });

    await expectProjectChipName(page, alphaName);
    await expect(hint).toContainText('Commands run in /;', { timeout: OWNER_TIMEOUT });
    await expectSavedProject(page, gammaName);
    await newShell(page);
    expect(await readActiveProjectText(page, 'project-proof.txt', OWNER_TIMEOUT)).toEqual({
      exists: true,
      text: alphaMarker,
    });

    await switchToSavedProject(page, gammaName);
    await newShell(page);
    expect(await readActiveProjectText(page, 'src/main.js', OWNER_TIMEOUT)).toMatchObject({
      exists: true,
      text: expect.stringContaining(dirtyMarker),
    });
  });

  test('re-picking the current dirty scratch starter reopens it without a discard prompt', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(240_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));

    await bootScratch(page);
    const marker = await dirtyScratchViaEditor(page);

    await page.click('[data-action="open-launcher"]');
    await page.getByRole('button', { name: 'Starters', exact: true }).click();
    await page.click('[data-preset="project-files"]');

    // Same starter as the dirty scratch: the owner preserve contract
    // (preserveDirtySameStarter) keeps the draft, so no dialog may threaten a
    // discard it will not perform — the pick just reopens the scratch.
    await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('.rf-dialog[role="dialog"]')).toHaveCount(0);
    await expect(page.locator('[data-action="open-launcher"][data-dirty="true"]')).toBeVisible();

    await newShell(page);
    expect(await readActiveProjectText(page, 'src/main.js', OWNER_TIMEOUT)).toMatchObject({
      exists: true,
      text: expect.stringContaining(marker),
    });
  });
});

test.describe('ADR-0165 §6 — named-project Reset is a real project-tree restore', () => {
  test('resetting a saved project wipes its edits + re-seeds the starter tree', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(240_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));

    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const projName = `Reset-${tag}`;

    await bootScratch(page);
    const hint = hintLocator(page);

    // Write a stray file through the active project's logical root, then save it.
    await newShell(page);
    await runTerminalLineSettled(page, 'echo stray-edit > stray.txt');
    const strayBeforeSave = await readActiveProjectText(page, 'stray.txt');
    expect(strayBeforeSave).toEqual({ exists: true, text: 'stray-edit' });
    await saveScratchAs(page, projName);

    // Make a different scratch active so Reset operates on an inactive project.
    await pickStarter(page, 'node-worker');
    await newShell(page);
    const activeScratchProof = `active-scratch-${tag}`;
    await runTerminalLineSettled(page, `echo ${activeScratchProof} > active-scratch-proof.txt`);
    await resetProjectViaMenu(page, projName);
    await expect(hint).toContainText('Commands run in /;', { timeout: 30_000 });
    await newShell(page);
    expect(await readActiveProjectText(page, 'active-scratch-proof.txt', OWNER_TIMEOUT)).toEqual({
      exists: true,
      text: activeScratchProof,
    });

    // Activate the reset target and inspect it through the public active-project
    // shell boundary. Reset must wipe the stray and restore the starter baseline.
    await switchToSavedProject(page, projName, { discardDirtyScratch: true });
    await expect(hint).toContainText('Commands run in /;', { timeout: OWNER_TIMEOUT });
    await newShell(page);
    expect(await readActiveProjectText(page, 'stray.txt', OWNER_TIMEOUT)).toEqual({
      exists: false,
      text: '',
    });
    expect(await readActiveProjectText(page, 'src/main.js', OWNER_TIMEOUT)).toEqual({
      exists: true,
      text: expect.stringContaining("import project from './project.json'"),
    });
  });
});

/** Open the row menu for project `name` and click "Reset to starter…" → "Reset files". */
async function resetProjectViaMenu(page: Page, name: string): Promise<void> {
  await openProjects(page);
  const card = page.locator('.rf-pcard', { hasText: name }).first();
  await card.locator('.rf-pcard__menu').click();
  // Scope to the row menu; a page-level role query can also match the card's text.
  await card
    .locator('.rf-rowmenu')
    .getByRole('button', { name: /Reset to starter/ })
    .click();
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  const reset = dialog.getByRole('button', { name: 'Reset files' });
  await reset.click();
  await expect(dialog).toHaveCount(0, { timeout: OWNER_TIMEOUT });
  await page.locator('.rf-launcher__close').click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, {
    timeout: OWNER_TIMEOUT,
  });
}

async function openLauncherViaChip(page: Page): Promise<void> {
  await page.click('[data-action="open-launcher"]');
  await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 5_000 });
}
async function closeLauncher(page: Page): Promise<void> {
  await page.locator('.rf-launcher__close').click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, { timeout: 5_000 });
}

test.describe('ADR-0165 §9 — launcher remembers its tab', () => {
  test('opens on Starters when there are no projects, then remembers the chosen tab', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));

    const startersTab = page.getByRole('button', { name: 'Starters', exact: true });
    await bootScratch(page);

    // No saved projects yet → the chip opens the launcher on STARTERS (the gallery),
    // since there is nothing to switch to — only a starter to pick.
    await openLauncherViaChip(page);
    await expect(startersTab).toHaveAttribute('data-active', 'true');
    await expect(page.locator('[data-testid="gallery"]')).toBeVisible();
    await closeLauncher(page);

    // Save a project so the empty-rule no longer forces Starters.
    await saveScratchAs(page, `Tab-${Date.now()}`);

    // Pick the Starters tab → it is REMEMBERED (localStorage) across re-opens, even
    // though a project now exists (the empty-rule would otherwise default Projects).
    await openLauncherViaChip(page);
    await startersTab.click();
    await expect(startersTab).toHaveAttribute('data-active', 'true');
    await closeLauncher(page);

    await openLauncherViaChip(page);
    await expect(startersTab).toHaveAttribute('data-active', 'true');
    await closeLauncher(page);
  });
});
