import { type Page, expect, test } from '@playwright/test';
import {
  type TerminalSessionTarget,
  bootProjectFiles,
  expectViteDevServerReady,
  insertTerminalLineSettled,
  openShellTerminal,
  pickStarter,
  resetSandboxThroughUi,
  terminalBuffer,
} from './helpers/playground.ts';

function editorTab(page: Page, name: string) {
  return page
    .locator('[role="tablist"][aria-label="Open editors"] [role="tab"]')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
}

async function expectSessionContains(
  page: Page,
  target: TerminalSessionTarget,
  text: string,
  timeout = 30_000,
): Promise<void> {
  await expect.poll(() => terminalBuffer(page, target), { timeout }).toContain(text);
}

async function recordChooserProjectArtifactsOnNextDocument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = globalThis as typeof globalThis & {
      __riftySawChooserProjectArtifacts?: boolean;
    };
    state.__riftySawChooserProjectArtifacts = false;
    const scan = (): void => {
      const launcherOpen = document.querySelector('[data-testid="launcher"]') !== null;
      if (!launcherOpen) return;
      const hasProgramTab = Array.from(
        document.querySelectorAll('[role="tablist"][aria-label="Open editors"] [role="tab"]'),
      ).some((tab) => tab.querySelector('.rf-tab__label')?.textContent?.trim() === 'main.js');
      const hasWorkspaceRows =
        (document
          .querySelector('[role="tree"][aria-label="Workspace files"]')
          ?.querySelectorAll('[role="treeitem"]').length ?? 0) > 0;
      if (hasProgramTab || hasWorkspaceRows) state.__riftySawChooserProjectArtifacts = true;
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

async function recordStoragePresentationOnNextDocument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = globalThis as typeof globalThis & {
      __riftyStoragePresentations?: string[];
    };
    state.__riftyStoragePresentations = [];
    const scan = (): void => {
      const badge = document.querySelector('[data-storage-badge]');
      const mode = badge?.closest('[data-storage-mode]')?.getAttribute('data-storage-mode');
      if (!(badge instanceof HTMLElement) || mode === null || mode === undefined) return;
      const observation = `${mode}:${badge.textContent?.trim() ?? ''}`;
      const seen = state.__riftyStoragePresentations ?? [];
      if (seen[seen.length - 1] !== observation) seen.push(observation);
    };
    const start = (): void => {
      scan();
      new MutationObserver(scan).observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true,
      });
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });
}

test.describe('M0 — Foundation', () => {
  test('playground loads with the chooser and opens shell terminals after project admission', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('strong').filter({ hasText: 'rifty' })).toBeVisible();
    const launcher = page.locator('[data-testid="launcher"]');
    await expect(launcher).toBeVisible({ timeout: 30_000 });
    await expect(launcher.getByText('Node 24 runtime', { exact: true })).toBeVisible();
    await expect(page.locator('[data-testid="terminal"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="editor"]')).toHaveCount(0);
    await expect(editorTab(page, 'main.js')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New terminal' })).toBeVisible();

    await pickStarter(page, 'project-files');
    const shell = await openShellTerminal(page);
    await expect(
      page.locator(`.rf-terminal-slot[data-session-id="${shell.sessionId}"]`),
    ).toBeVisible();
  });

  test('first-run boot keeps the project unloaded until a starter is chosen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 30_000 });

    await expect(page.locator('[data-testid="editor"]')).toHaveCount(0);

    await pickStarter(page, 'project-files');
    const editorLines = page.locator('[data-testid="editor"] .view-lines').first();
    await expect(editorLines).toContainText("import project from './project.json'", {
      timeout: 60_000,
    });
  });

  test('reset first-run chooser does not reveal starter files or the default program tab', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await recordChooserProjectArtifactsOnNextDocument(page);
    await resetSandboxThroughUi(page);

    await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 30_000 });
    const projectChip = page.locator('[data-action="open-launcher"]');
    await expect(projectChip.locator('.rf-chip__name')).toHaveText('Choose project', {
      timeout: 30_000,
    });
    await expect(projectChip).toBeEnabled({ timeout: 30_000 });
    await page.waitForTimeout(2_000);

    await expect(
      editorTab(page, 'main.js'),
      'no fallback starter tab should be visible behind the chooser',
    ).toHaveCount(0);
    await expect(
      page.locator('[role="tree"][aria-label="Workspace files"] [role="treeitem"]'),
      'no starter workspace rows should be visible behind the chooser',
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __riftySawChooserProjectArtifacts?: boolean;
              }
            ).__riftySawChooserProjectArtifacts === true,
        ),
      )
      .toBe(false);
  });

  test('starter pick paints initial editor tabs while lazy editor source loads', async ({
    page,
  }) => {
    await page.goto('/');
    const launcher = page.locator('[data-testid="launcher"]');
    await expect(launcher).toBeVisible({ timeout: 30_000 });

    const editorLines = page.locator('[data-testid="editor"] .view-lines').first();
    await page.getByRole('button', { name: 'Starters', exact: true }).click();
    await page.click('[data-preset="project-files"]');

    await expect(launcher).toHaveCount(0, { timeout: 5_000 });
    // Lazy-Monaco split: the starter intent paints the chosen starter's initial
    // tabs/snapshot promptly; Monaco source follows when the editor chunk lands.
    await expect(editorTab(page, 'main.js')).toBeVisible({ timeout: 5_000 });
    await expect(editorLines).toContainText("import project from './project.json'", {
      timeout: 60_000,
    });
  });

  test('non-TypeScript starter does not report missing TypeScript in Problems', async ({
    page,
  }) => {
    await page.goto('/');
    await pickStarter(page, 'project-files');
    await expectViteDevServerReady(page, 5174, 90_000);

    await page.locator('[data-testid="problems-tab"]').click();
    await expect(page.locator('[data-testid="problems-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="problem-row"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="problems-panel"]')).not.toContainText(
      /TypeScript is not installed/i,
    );
  });

  test('first-run chooser exposes no hidden project session before a starter pick', async ({
    page,
  }) => {
    await page.goto('/');
    const launcher = page.locator('[data-testid="launcher"]');
    await expect(launcher).toBeVisible({ timeout: 30_000 });

    await expect(page.locator('[data-testid="editor"]')).toHaveCount(0);
    await expect(editorTab(page, 'main.js')).toHaveCount(0);
    await expect(page.locator('.rf-terminal-slot')).toHaveCount(0);
    await expect(
      page.locator('[role="tree"][aria-label="Workspace files"] [role="treeitem"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-action="open-launcher"] .rf-chip__name')).toHaveText(
      'Choose project',
    );

    await pickStarter(page, 'project-files');
    const marker = `hidden-empty-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const shell = await openShellTerminal(page);
    const modeHint = page.locator(
      `.rf-terminal-slot[data-session-id="${shell.sessionId}"] [data-testid="terminal-mode-hint"]`,
    );
    await expect(modeHint).toContainText('Commands run in /;', { timeout: 30_000 });
    await insertTerminalLineSettled(page, `echo ${marker}`, 30_000, shell);
    await expectSessionContains(page, shell, marker);
    await expect.poll(() => terminalBuffer(page, shell)).not.toContain('Choose a project before');
  });

  test('crossOriginIsolated is enabled', async ({ page }) => {
    await page.goto('/');
    const coi = await page.evaluate(
      () => (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated,
    );
    expect(coi).toBe(true);
  });

  test('runtime guard does not paint the COI fatal banner when isolation is on', async ({
    page,
  }) => {
    // Regression net: `assertCrossOriginIsolated()` in main.tsx must be a no-op
    // when COOP/COEP headers are configured correctly (ADR-0002 / D-001). If
    // the Vite headers regress, the bootstrap pipeline aborts and paints the
    // `[data-banner="coi-fatal"]` element instead of rendering the App. The
    // assertion below catches that — and the positive assertion catches the
    // opposite regression (guard accidentally removed and App renders without
    // SAB available, downstream code blows up silently).
    await page.goto('/');
    await expect(page.locator('[data-banner="coi-fatal"]')).toHaveCount(0);
    // The App must have rendered — the storage badge proves `bootstrapPlayground`
    // resolved (it only paints after `initBackend()` returns).
    await expect(page.locator('[data-storage-badge]')).toBeVisible();
  });

  test('owner-reported durable storage is never presented as ephemeral', async ({ page }) => {
    await recordStoragePresentationOnNextDocument(page);
    await page.goto('/');
    await expect(page.locator('[data-storage-badge]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-storage-mode="opfs"]')).toBeVisible();

    const presentations = await page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __riftyStoragePresentations?: string[];
          }
        ).__riftyStoragePresentations ?? [],
    );
    expect(presentations).toContainEqual(expect.stringMatching(/^opfs:/));
    expect(presentations).not.toContainEqual(expect.stringMatching(/^memory:/));
  });

  test('shell file commands round-trip through the workspace VFS', async ({ page }) => {
    await bootProjectFiles(page);
    const shell = await openShellTerminal(page);

    const marker = `persist-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const file = `roundtrip-${Date.now().toString(36)}.txt`;
    await insertTerminalLineSettled(
      page,
      `echo ${marker} > ./${file} && cat ./${file}`,
      30_000,
      shell,
    );
    await expectSessionContains(page, shell, marker);
    await expect(
      page.getByRole('treeitem', { name: new RegExp(file.replace('.', '\\.')) }),
    ).toBeVisible({
      timeout: 15_000,
    });
  });

  test('SharedArrayBuffer is available', async ({ page }) => {
    await page.goto('/');
    const ok = await page.evaluate(() => typeof SharedArrayBuffer === 'function');
    expect(ok).toBe(true);
  });

  test('Service Worker registers', async ({ page }) => {
    await page.goto('/');
    const ok = await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      return Boolean(reg?.active);
    });
    expect(ok).toBeTruthy();
  });
});
