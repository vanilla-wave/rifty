/**
 * ADR-0165 §4 switch coherence — public App surfaces follow the active project
 * across launcher transitions. A starter pick creates a fresh scratch, restarts
 * its dev server, and keeps the shell at the logical project root `/`.
 *
 * The second describe exercises the durable two-project save→switch round-trip
 * exclusively through user-visible controls and the active project's shell.
 */
import { type Page, expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectViteDevServerReady,
  pickStarter,
  readActiveProjectText,
  runTerminalLineSettled,
} from './helpers/playground.ts';

/** Terminal-session tabs only (editor tabs also use role=tab — scope to the shell). */
const TERMINAL_TAB = '.rf-terminal-tab__select[role="tab"]';
// Full-suite concurrency can delay project transitions beyond UI animation budgets.
const PROJECT_TRANSITION_TIMEOUT = 90_000;

interface MismatchToastState {
  readonly chip: string | null;
  readonly liveCount: number;
  readonly alphaActive: string | null;
  readonly betaActive: string | null;
}

/**
 * Open a FRESH shell terminal and make it the active slot — robust to the running
 * tab count (the dev-server boot owns one session; a switch recreates sessions, so
 * the numbering is not stable across the round-trip). Waits for the new terminal
 * tab to appear rather than asserting a fixed "Terminal N".
 */
async function newIdleShell(page: Page): Promise<void> {
  const before = await page.locator(TERMINAL_TAB).count();
  await page.getByRole('button', { name: 'New terminal' }).click();
  await expect(page.locator(TERMINAL_TAB)).toHaveCount(before + 1, { timeout: 10_000 });
  // The newly-created tab is auto-selected (manager.select on create).
  await expect(page.locator('.rf-terminal-slot[data-active="true"]')).toBeVisible({
    timeout: 10_000,
  });
  await runTerminalLineSettled(page, 'pwd');
}

/** Open the launcher Projects tab via the top-bar chip. */
async function openProjects(page: Page): Promise<void> {
  await page.click('[data-action="open-launcher"]');
  await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /^Projects/ }).click();
}

/** Save the active scratch as a named project via the launcher Projects tab. */
async function saveScratchAs(page: Page, name: string): Promise<string> {
  await openProjects(page);
  const save = page.locator('[data-action="save-scratch"]');
  await expect(save).toBeEnabled({ timeout: PROJECT_TRANSITION_TIMEOUT });
  await save.click();
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.locator('input.rf-dialog__input').fill(name);
  await dialog.getByRole('button', { name: 'Save project' }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.rf-dialog[role="dialog"]') === null ||
      document.querySelector('.rf-toast[data-tone="error"]') !== null,
    undefined,
    { timeout: PROJECT_TRANSITION_TIMEOUT },
  );
  const errorToast = page.locator('.rf-toast[data-tone="error"]');
  const transitionError = (await errorToast.count()) === 0 ? null : await errorToast.textContent();
  if (transitionError !== null) throw new Error(`Save transition failed: ${transitionError}`);
  // Save closes the DIALOG but leaves the launcher open (the new project appears in
  // the Projects tab). Close the launcher explicitly so the editor regains focus.
  await expect(dialog).toHaveCount(0, { timeout: PROJECT_TRANSITION_TIMEOUT });
  const card = page.locator('.rf-pcard[data-project]', { hasText: name }).first();
  await expect(card).toBeVisible({ timeout: PROJECT_TRANSITION_TIMEOUT });
  const projectId = await card.getAttribute('data-project');
  if (projectId === null || projectId.length === 0) {
    throw new Error(`Saved project ${name} has no owner project id`);
  }
  await page.locator('.rf-launcher__close').click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, { timeout: 5_000 });
  return projectId;
}

/** Switch to a named project by clicking its durable project card. */
async function switchToProject(page: Page, name: string): Promise<void> {
  await openProjects(page);
  const card = page.locator('.rf-pcard[data-project]', { hasText: name }).first();
  await expect(card).toBeVisible({ timeout: PROJECT_TRANSITION_TIMEOUT });
  await expect(card).toHaveAttribute('role', 'button', {
    timeout: PROJECT_TRANSITION_TIMEOUT,
  });
  await card.click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, {
    timeout: PROJECT_TRANSITION_TIMEOUT,
  });
}

async function expectProjectChipName(page: Page, name: string): Promise<void> {
  const chipName = page.locator('[data-action="open-launcher"] .rf-chip__name');
  await expect(chipName).toHaveText(name, { timeout: 15_000 });
  await expect(chipName).not.toHaveText('Untitled scratch');
  await expect(chipName).toHaveCSS('font-family', /JetBrains Mono/);
}

async function mismatchPersistedDefinitionIdentity(
  page: Page,
  projectId: string,
  replacement: string,
): Promise<void> {
  await page.evaluate(
    async ({ projectId, replacement }) => {
      let directory = await navigator.storage.getDirectory();
      for (const segment of ['.rifty', 'workbench', 'v1', 'projects', projectId]) {
        directory = await directory.getDirectoryHandle(segment);
      }
      const handle = await directory.getFileHandle('definition.json');
      const metadata = JSON.parse(await (await handle.getFile()).text()) as Record<string, unknown>;
      if (
        metadata.version !== 1 ||
        metadata.projectKey !== projectId ||
        typeof metadata.definitionIdentity !== 'string'
      ) {
        throw new Error(`Unexpected persisted definition metadata for ${projectId}`);
      }
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify({ ...metadata, definitionIdentity: replacement }));
      await writable.close();
    },
    { projectId, replacement },
  );
}

async function armFirstMismatchToastState(
  page: Page,
  alphaId: string,
  betaId: string,
): Promise<void> {
  await page.evaluate(
    ({ alphaId, betaId }) => {
      const state = window as unknown as Record<string, unknown>;
      state.__riftyFirstMismatchToastState = null;
      const project = (id: string): Element | undefined =>
        [...document.querySelectorAll('.rf-pcard[data-project]')].find(
          (card) => card.getAttribute('data-project') === id,
        );
      const observer = new MutationObserver(() => {
        if (document.querySelector('.rf-toast[data-tone="error"]') === null) return;
        state.__riftyFirstMismatchToastState = {
          chip:
            document.querySelector('[data-action="open-launcher"] .rf-chip__name')?.textContent ??
            null,
          liveCount: document.querySelectorAll('.rf-livepill[data-state="running"]').length,
          alphaActive: project(alphaId)?.getAttribute('data-active') ?? null,
          betaActive: project(betaId)?.getAttribute('data-active') ?? null,
        } satisfies MismatchToastState;
        observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    },
    { alphaId, betaId },
  );
}

async function firstMismatchToastState(page: Page): Promise<MismatchToastState> {
  const read = (): Promise<MismatchToastState | null> =>
    page.evaluate(
      () =>
        ((window as unknown as Record<string, unknown>)
          .__riftyFirstMismatchToastState as MismatchToastState | null) ?? null,
    );
  await expect.poll(read, { timeout: PROJECT_TRANSITION_TIMEOUT }).not.toBeNull();
  const state = await read();
  if (state === null) throw new Error('First mismatch toast state was not captured');
  return state;
}

test.describe('ADR-0165 §4 — switch coherence: surfaces follow the active project', () => {
  test('a starter pick opens a fresh scratch and reboots its dev server at logical root', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));

    // Boot through the same launcher path a user follows.
    await bootProjectFiles(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });

    // Boot: the default Vite scratch is active at the App's logical project root.
    const hint = page.locator('[data-testid="terminal-mode-hint"]').first();
    await expect(hint).toContainText('Commands run in /;', { timeout: 15_000 });
    await expectProjectChipName(page, 'Project files scratch');
    await expectViteDevServerReady(page, 5174, 30_000);

    // Pick a different starter. The chip and logical shell root must follow the
    // newly active scratch, never the prior starter.
    await pickStarter(page, 'node-worker');

    await expect(hint).toContainText('Commands run in /;', { timeout: 15_000 });
    await expectProjectChipName(page, 'Node worker map scratch');

    // The switched-in scratch's dev server reboots too.
    await expectViteDevServerReady(page);
  });
});

test.describe('Project activation/open compensation', () => {
  test('definition mismatch restores the prior saved project before the error is shown', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner and durable OPFS require Chromium');
    test.setTimeout(240_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));

    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const alphaName = `Activation-A-${tag}`;
    const betaName = `Activation-B-${tag}`;

    await bootProjectFiles(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    const alphaId = await saveScratchAs(page, alphaName);
    await pickStarter(page, 'node-worker');
    const betaId = await saveScratchAs(page, betaName);

    await mismatchPersistedDefinitionIdentity(page, alphaId, `mismatch-${tag}`);
    await page.reload();
    await expect(page.locator('.rf-app[data-project-index="ready"]')).toBeVisible({
      timeout: PROJECT_TRANSITION_TIMEOUT,
    });
    await expectProjectChipName(page, betaName);

    await openProjects(page);
    const alphaCard = page.locator('.rf-pcard[data-project]', { hasText: alphaName }).first();
    const betaCard = page.locator('.rf-pcard[data-project]', { hasText: betaName }).first();
    await expect(alphaCard).toHaveAttribute('role', 'button', {
      timeout: PROJECT_TRANSITION_TIMEOUT,
    });
    await expect(betaCard).toHaveAttribute('data-active', 'true');

    await armFirstMismatchToastState(page, alphaId, betaId);
    await alphaCard.click();
    const mismatch = page.locator('.rf-toast[data-tone="error"]');
    await expect(mismatch).toContainText('ProjectDefinitionMismatchError', {
      timeout: PROJECT_TRANSITION_TIMEOUT,
    });
    await expect(mismatch).toContainText('has a different definition');

    expect(await firstMismatchToastState(page)).toEqual({
      chip: betaName,
      liveCount: 1,
      alphaActive: 'false',
      betaActive: 'true',
    });
  });
});

/**
 * ADR-0165 §7 — the FULL durable round-trip: Save two scratches as named projects,
 * switch between them through their cards, and read each distinct tree through an
 * idle shell at the logical project root. A missing save or stale switch exposes
 * the absent or sibling marker without depending on storage layout.
 */
test.describe('ADR-0165 §7 — durable Save + switch round-trip (two projects)', () => {
  test('two saved projects keep distinct trees across project switches', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));

    // Unique names avoid collisions with projects retained by the browser context.
    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const alphaName = `Alpha-${tag}`;
    const betaName = `Beta-${tag}`;
    const alphaMark = `ALPHA-${tag}`;
    const betaMark = `BETA-${tag}`;

    await bootProjectFiles(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });

    // Write Alpha at the active project's logical root, then save it by name.
    const hint = page.locator('[data-testid="terminal-mode-hint"]').first();
    await expect(hint).toContainText('Commands run in /;', { timeout: 30_000 });
    await newIdleShell(page);
    await runTerminalLineSettled(page, `echo ${alphaMark} > round-trip.txt`);
    await saveScratchAs(page, alphaName);

    // A different starter creates Beta's fresh scratch; save its distinct marker.
    await pickStarter(page, 'node-worker');
    await expect(hint).toContainText('Commands run in /;', { timeout: 30_000 });
    await newIdleShell(page);
    await runTerminalLineSettled(page, `echo ${betaMark} > round-trip.txt`);
    await saveScratchAs(page, betaName);

    // Alpha survives a switch away and back. Read only through the active project.
    await switchToProject(page, alphaName);
    await expect(hint).toContainText('Commands run in /;', { timeout: 60_000 });
    await expectProjectChipName(page, alphaName);
    await newIdleShell(page);
    const alpha = await readActiveProjectText(page, 'round-trip.txt', 60_000);
    expect(alpha.exists).toBe(true);
    expect(alpha.text).toContain(alphaMark);
    expect(alpha.text).not.toContain(betaMark);

    // Beta remains distinct across the second switch.
    await switchToProject(page, betaName);
    await expect(hint).toContainText('Commands run in /;', { timeout: 60_000 });
    await expectProjectChipName(page, betaName);
    await newIdleShell(page);
    const beta = await readActiveProjectText(page, 'round-trip.txt', 60_000);
    expect(beta.exists).toBe(true);
    expect(beta.text).toContain(betaMark);
    expect(beta.text).not.toContain(alphaMark);
  });
});
