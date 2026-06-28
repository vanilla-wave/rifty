import { expect, test } from '@playwright/test';
import { readWorkspaceText } from './helpers/opfs.ts';
import {
  bootProjectFiles,
  expectTerminalContains,
  openShellTerminal,
  pickStarter,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

test.describe('M0 — Foundation', () => {
  test('playground loads, terminal + editor are visible, and shell terminals can be opened', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('strong').filter({ hasText: 'rifty' })).toBeVisible();
    await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="terminal"]')).toBeVisible();
    await expect(page.locator('[data-testid="editor"]')).toBeVisible();
    await expect(page.getByRole('tab', { name: /src\/main\.js/ })).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 30_000 },
    );
    await expect(page.getByRole('button', { name: 'New terminal' })).toBeVisible();
  });

  test('first-run boot keeps the project unloaded until a starter is chosen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 30_000 });

    const editorLines = page.locator('[data-testid="editor"] .view-lines').first();
    await expect
      .poll(async () => (await editorLines.textContent()) ?? '', { timeout: 2_000 })
      .not.toContain("import project from './project.json'");

    await pickStarter(page, 'project-files');
    await expect(editorLines).toContainText("import project from './project.json'", {
      timeout: 60_000,
    });
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

  test('first-run hidden empty project has a real shell and entry file before a starter pick', async ({
    page,
  }) => {
    await page.goto('/');
    const launcher = page.locator('[data-testid="launcher"]');
    await expect(launcher).toBeVisible({ timeout: 30_000 });
    await page.locator('.rf-launcher__close').click();
    await expect(launcher).toHaveCount(0, { timeout: 5_000 });

    await expect
      .poll(async () => await readWorkspaceText(page, '/scratch/src/main.js'), { timeout: 30_000 })
      .not.toMatch(/^MISSING:/u);
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
