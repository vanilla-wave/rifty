/**
 * ADR-0165 post-review e2e — the multi-project flows the review found shipped
 * broken or unguarded, driven end-to-end against the real owner:
 *  - §9 dirty-scratch SWITCH dialog: "Discard & continue" lands at the target
 *    root (it used to re-open the dialog + respawn at the wrong template), and
 *    "Save scratch, then continue" saves the draft AND continues (it used to stop
 *    after the save).
 *  - §6 named-project RESET is a REAL on-disk re-seed (it used to toast + bump
 *    editedAt while the tree was untouched — a lying happy-path).
 *
 * SERIAL (test.describe.configure): each test boots its own COI/SAB workspace
 * owner (heavy WASI), so running them concurrently with each other would starve
 * the OPFS flush. Serial keeps peak owner-concurrency from this file at one — they
 * still overlap the rest of the fullyParallel suite, which already tolerates
 * several concurrent owner-heavy specs.
 *
 * RED-checks:
 *  - Discard: restore `applyPending` to re-call the dirty-guarded `requestSwitch`
 *    → the dialog re-opens, the hint stays `/scratch`, the assert times out.
 *  - Save-then: restore `onSwitchSaveThen` to only open the save dialog → after
 *    Save the hint shows the SAVED draft's root, not Alpha's.
 *  - Reset: revert the owner `index-reset-project` handler (resetProjectTree →
 *    no-op) → `/projects/<id>/stray.txt` survives → the MISSING poll times out.
 */
import { type Page, expect, test } from '@playwright/test';
import { readWorkspaceJson, readWorkspaceText } from './helpers/opfs.ts';
import { runTerminalLineSettled } from './helpers/playground.ts';

// A taller viewport centers the launcher modal BELOW the top-right toast, so the
// close button is never transiently covered (the toast auto-dismisses too, but this
// keeps the clicks immediate under the full-suite load).
test.use({ viewport: { width: 1280, height: 940 } });

// OPFS reads/flushes slow down when several owner workers boot under load (full
// parallel suite); durable-state polls are generous so a starved flush still lands.
const OPFS_POLL = 90_000;
const TERMINAL_TAB = '.rf-terminal-tab__select[role="tab"]';
type ProjectIndexSnapshot = {
  activeId: string;
  scratch: { starter: string; dirty: boolean } | null;
  projects: { id: string; name: string }[];
};

async function bootScratch(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 15_000,
  });
  await expect(hintLocator(page)).toContainText('Commands run in /scratch;', { timeout: 30_000 });
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
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, { timeout: OPFS_POLL });
}

async function openProjects(page: Page): Promise<void> {
  await page.click('[data-action="open-launcher"]');
  await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /^Projects/ }).click();
}

async function readProjectIndex(page: Page): Promise<ProjectIndexSnapshot | null> {
  return readWorkspaceJson<ProjectIndexSnapshot>(page, '/.rifty-project-index.json');
}

async function waitDurableScratch(page: Page, starter?: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const index = await readProjectIndex(page);
        return index?.activeId === 'scratch' &&
          index.scratch &&
          (starter === undefined || index.scratch.starter === starter)
          ? `${index.activeId}:${index.scratch.dirty ? 'dirty' : 'clean'}`
          : '';
      },
      { timeout: OPFS_POLL },
    )
    .toBe('scratch:clean');
}

async function projectIdFromDurableIndex(page: Page, name: string): Promise<string> {
  const readId = async (): Promise<string> => {
    const index = await readProjectIndex(page);
    return index?.projects.find((p) => p.name === name)?.id ?? '';
  };
  await expect.poll(readId, { timeout: OPFS_POLL }).not.toBe('');
  return readId();
}

async function saveScratchAs(page: Page, name: string): Promise<string> {
  await waitDurableScratch(page);
  await openProjects(page);
  await page.click('[data-action="save-scratch"]');
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.locator('input.rf-dialog__input').fill(name);
  await dialog.getByRole('button', { name: 'Save project' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 5_000 });
  const id = await projectIdFromDurableIndex(page, name);
  await page.locator('.rf-launcher__close').click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, { timeout: 5_000 });
  return id;
}

async function projectCardIdForName(page: Page, name: string): Promise<string> {
  await openProjects(page);
  const card = page.locator('.rf-pcard', { hasText: name }).first();
  await expect(card).toBeVisible({ timeout: OPFS_POLL });
  const id = (await card.getAttribute('data-project')) ?? '';
  expect(id).not.toBe('');
  await page.locator('.rf-launcher__close').click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, { timeout: 5_000 });
  return id;
}

/** Read `/projects/<id>/<rel>` from OPFS, or `MISSING:<reason>` when absent. */
async function readProjectFile(page: Page, id: string, rel: string): Promise<string> {
  return await readWorkspaceText(page, `/projects/${id}/${rel}`);
}

/** Insert a marker via Monaco's real input path → onProgramChange → scratch dirty. */
async function dirtyScratchViaEditor(page: Page): Promise<void> {
  const editor = page.locator('[data-testid="editor"]');
  await editor
    .locator('.view-line')
    .first()
    .click({ position: { x: 0, y: 8 } });
  const editorInput = editor.locator('textarea.inputarea').first();
  await editorInput.click({ force: true });
  await expect(editorInput).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.insertText(`// dirty-${Date.now()}\n`);
  await expect(page.locator('[data-action="open-launcher"][data-dirty="true"]')).toBeVisible({
    timeout: 10_000,
  });
}

/** Save scratch → Alpha, then spin a fresh DIRTY node-worker scratch to switch FROM. */
async function bootDirtyScratchWithSavedAlpha(
  page: Page,
  alphaName: string,
): Promise<{ alphaId: string }> {
  const hint = hintLocator(page);
  await bootScratch(page);
  const alphaId = await saveScratchAs(page, alphaName);
  expect(alphaId).not.toBe('');
  await pickStarter(page, 'node-worker');
  await expect(hint).toContainText('Commands run in /scratch;', { timeout: 30_000 });
  await waitDurableScratch(page, 'node-worker');
  await dirtyScratchViaEditor(page);
  return { alphaId };
}

test.describe.configure({ mode: 'serial' });

test.describe('ADR-0165 §9 — dirty-scratch switch dialog', () => {
  test('Discard & continue switches to the target project (right root, no re-opened dialog)', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(240_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));

    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const { alphaId } = await bootDirtyScratchWithSavedAlpha(page, `Alpha-${tag}`);
    const hint = hintLocator(page);

    await openProjects(page);
    await page
      .locator('.rf-pcard', { hasText: `Alpha-${tag}` })
      .first()
      .click();
    const dialog = page.locator('.rf-dialog[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toContainText('Discard unsaved scratch');

    await dialog.getByRole('button', { name: 'Discard & continue' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });
    await expect(hint).toContainText(`Commands run in /projects/${alphaId};`, { timeout: 90_000 });
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
    const { alphaId } = await bootDirtyScratchWithSavedAlpha(page, `Alpha-${tag}`);
    const hint = hintLocator(page);

    await openProjects(page);
    await page
      .locator('.rf-pcard', { hasText: `Alpha-${tag}` })
      .first()
      .click();
    const dialog = page.locator('.rf-dialog[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.getByRole('button', { name: 'Save scratch, then continue' }).click();
    await expect(dialog).toContainText('Save as project', { timeout: 5_000 });
    await dialog.locator('input.rf-dialog__input').fill(gammaName);
    await dialog.getByRole('button', { name: 'Save project' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });

    await expect(hint).toContainText(`Commands run in /projects/${alphaId};`, { timeout: 90_000 });
    expect(await projectCardIdForName(page, gammaName)).not.toBe('');
  });
});

test.describe('ADR-0165 §6 — named-project Reset is a real on-disk restore', () => {
  test('resetting a saved project wipes its edits + re-seeds the starter tree on disk', async ({
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

    // Boot scratch, write a STRAY file (absolute active root), Save as a project →
    // the stray moves into /projects/<id>/stray.txt.
    await newShell(page);
    await runTerminalLineSettled(page, 'echo stray-edit > /scratch/stray.txt');
    const id = await saveScratchAs(page, projName);
    expect(id).not.toBe('');
    await expect
      .poll(() => readProjectFile(page, id, 'stray.txt'), { timeout: OPFS_POLL })
      .toContain('stray-edit');

    // Make a DIFFERENT scratch active so the reset target is NON-active (no live
    // dev-server restart in the assertion path — purely the on-disk re-seed).
    await pickStarter(page, 'node-worker');
    await expect(hint).toContainText('Commands run in /scratch;', { timeout: 30_000 });
    await waitDurableScratch(page, 'node-worker');

    await resetProjectViaMenu(page, projName);

    // The stray edit is GONE (tree wiped) and the starter baseline is back —
    // proving Reset is a real on-disk restore, not a page-mirror no-op.
    await expect
      .poll(() => readProjectFile(page, id, 'stray.txt'), { timeout: OPFS_POLL })
      .toContain('MISSING');
    await expect
      .poll(() => readProjectFile(page, id, 'src/main.js'), { timeout: OPFS_POLL })
      .not.toContain('MISSING');
  });
});

/** Open the row menu for project `name` and click "Reset to starter…" → "Reset files". */
async function resetProjectViaMenu(page: Page, name: string): Promise<void> {
  await openProjects(page);
  const card = page.locator('.rf-pcard', { hasText: name }).first();
  await card.locator('.rf-pcard__menu').click();
  // Scope to the row menu: the `.rf-pcard` is itself role=button, so its accessible
  // name CONTAINS "Reset to starter…" — a page-level getByRole would be ambiguous.
  await card
    .locator('.rf-rowmenu')
    .getByRole('button', { name: /Reset to starter/ })
    .click();
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.getByRole('button', { name: 'Reset files' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 5_000 });
  await page.locator('.rf-launcher__close').click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, { timeout: 5_000 });
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
