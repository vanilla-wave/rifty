import { type Page, expect, test } from '@playwright/test';
import { clearWorkspaceOpfs, readWorkspaceText } from './helpers/opfs.ts';
import {
  bootProjectFiles,
  expectTerminalContains,
  openShellTerminal,
  pickStarter,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

async function reinitTsLanguageService(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const fn = (globalThis as { __riftyTsReinit?: () => Promise<boolean> }).__riftyTsReinit;
    return fn ? fn() : Promise.resolve(false);
  });
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
      const hasProgramTab = Array.from(document.querySelectorAll('[role="tab"]')).some((tab) =>
        tab.textContent?.includes('src/main.js'),
      );
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

test.describe('M0 — Foundation', () => {
  test('playground loads, terminal + chooser are visible, and shell terminals can be opened', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('strong').filter({ hasText: 'rifty' })).toBeVisible();
    await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="terminal"]')).toBeVisible();
    await expect(page.locator('[data-testid="editor"]')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /src\/main\.js/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New terminal' })).toBeVisible();
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
    await page.goto('/');
    await clearWorkspaceOpfs(page);
    await recordChooserProjectArtifactsOnNextDocument(page);
    await page.reload();

    await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.rf-app[data-workspace-owner="chooser"]')).toBeVisible();
    await expect(page.locator('.rf-app[data-project-index="ready"]')).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(2_000);

    await expect(
      page.getByRole('tab', { name: /src\/main\.js/ }),
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

  test('starter pick paints editor source before the workspace owner finishes booting', async ({
    page,
  }) => {
    await page.goto('/');
    const launcher = page.locator('[data-testid="launcher"]');
    await expect(launcher).toBeVisible({ timeout: 30_000 });

    const editorLines = page.locator('[data-testid="editor"] .view-lines').first();
    await page.getByRole('button', { name: 'Starters', exact: true }).click();
    await page.click('[data-preset="project-files"]');

    await expect(launcher).toHaveCount(0, { timeout: 5_000 });
    await expect(editorLines).toContainText("import project from './project.json'", {
      timeout: 1_000,
    });
  });

  test('non-TypeScript starter does not report missing TypeScript in Problems', async ({
    page,
  }) => {
    await page.goto('/');
    await pickStarter(page, 'project-files');

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              typeof (globalThis as { __riftyTsReinit?: unknown }).__riftyTsReinit === 'function',
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    expect(await reinitTsLanguageService(page)).toBe(false);

    await page.locator('[data-testid="problems-tab"]').click();
    await expect(page.locator('[data-testid="problems-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="problem-row"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="problems-panel"]')).not.toContainText(
      /TypeScript is not installed/i,
    );
  });

  test('first-run hidden empty project has a real shell but no files before a starter pick', async ({
    page,
  }) => {
    await page.goto('/');
    const launcher = page.locator('[data-testid="launcher"]');
    await expect(launcher).toBeVisible({ timeout: 30_000 });
    await page.locator('.rf-launcher__close').click();
    await expect(launcher).toHaveCount(0, { timeout: 5_000 });

    await expect
      .poll(async () => await readWorkspaceText(page, '/scratch/src/main.js'), { timeout: 30_000 })
      .toMatch(/^MISSING:/u);
    await expect(
      page.locator('[role="tree"][aria-label="Workspace files"] [role="treeitem"]'),
    ).toHaveCount(0);
    await expect(page.locator('.rf-app[data-workspace-owner="chooser"]')).toBeVisible();

    const marker = `hidden-empty-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await runTerminalLine(page, `pwd && echo ${marker}`);
    await expectTerminalContains(page, marker, 30_000);
    await expectTerminalContains(page, /\/scratch/u);
    await expect.poll(() => terminalBuffer(page)).not.toContain('Choose a project before');
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

  test('shell file commands round-trip through the workspace VFS', async ({ page }) => {
    await bootProjectFiles(page);
    await openShellTerminal(page);

    const marker = `persist-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await runTerminalLine(
      page,
      `mkdir -p /workspace && echo ${marker} > /workspace/persist.txt && cat /workspace/persist.txt`,
    );
    await expectTerminalContains(page, marker);
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
