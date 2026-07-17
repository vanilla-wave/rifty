import { type Page, expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  pickStarter,
  resetSandboxThroughUi,
  runTerminalLineSettled,
} from './helpers/playground.ts';

async function expectMainJsInFilesAndEditor(page: Page, marker: string): Promise<void> {
  const src = page.locator('.rf-row[role="treeitem"][data-kind="dir"]', { hasText: 'src' }).first();
  await expect(src).toBeVisible({ timeout: 30_000 });
  if ((await src.getAttribute('aria-expanded')) !== 'true') await src.click();
  const main = page
    .locator('.rf-row[role="treeitem"][data-kind="file"]', { hasText: 'main.js' })
    .first();
  await expect(main).toBeVisible({ timeout: 15_000 });
  await main.click();
  await expect(page.locator('[data-testid="editor"] .view-lines').first()).toContainText(marker, {
    timeout: 15_000,
  });
}

/**
 * Regression (code-review 2026-07-01): the on-mount `seedWorkspaceOwner`
 * (App.tsx) pushes the boot preset's STARTER files into the owner
 * UNCONDITIONALLY — no dirty/index guard. A NEW file survives reload
 * (owner-persistence-reload.spec covers that), but a starter file the user
 * EDITED could be clobbered back to its seeded content when the mount re-seeds.
 *
 * Load-bearing: overwrite the default preset's `src/main.js` with a marker,
 * reload (owner worker restores the durable active-project tree), and assert the
 * marker is STILL there — i.e. boot did not overwrite the persisted
 * edit. On the clobber bug the reload shows the seeded source, not the marker.
 *
 * Under the project-first chooser the reload restore path re-launches the dev
 * server without replacing project files, so a reopened scratch draft is served
 * straight from its restored tree. This guards that user-visible reload leg.
 */
test.describe('a starter-file edit survives reload (mount seed must not clobber)', () => {
  test('edited src/main.js keeps the edit after page.reload()', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    const marker = `edit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    await resetSandboxThroughUi(page);
    // Project-first: pick the default real-vite starter (seeds src/main.js + boots
    // the dev server) instead of relying on a main-style auto-boot.
    await pickStarter(page, 'project-files');
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 60_000 });
    await openShellTerminal(page);

    // Overwrite a SEEDED starter file (default preset seeds src/main.js) with a
    // marker, and confirm the write landed.
    await runTerminalLineSettled(page, `echo ${marker} > src/main.js`, 30_000);
    await runTerminalLineSettled(page, 'cat src/main.js', 30_000);
    await expectTerminalContains(page, marker, 15_000);

    // Reload restores the active project and restarts its dev server. The edit
    // must remain visible in both Files/editor and the shell.
    await page.reload();
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 60_000 });
    await expectMainJsInFilesAndEditor(page, marker);
    await openShellTerminal(page);
    await runTerminalLineSettled(page, 'cat src/main.js', 30_000);
    await expectTerminalContains(page, marker, 20_000);
  });
});
