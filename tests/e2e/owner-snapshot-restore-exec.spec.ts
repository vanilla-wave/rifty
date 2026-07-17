import { type Page, expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  pickStarter,
  resetSandboxThroughUi,
  runTerminalLine,
  runTerminalLineSettled,
  selectPreset,
  terminalBuffer,
} from './helpers/playground.ts';

async function saveScratchAs(page: Page, name: string): Promise<void> {
  await page.locator('[data-action="open-launcher"]').click();
  const launcher = page.locator('[data-testid="launcher"]');
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  await launcher.getByRole('button', { name: /^Projects/ }).click();
  await launcher.locator('[data-action="save-scratch"]').click();
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await expect(dialog).toContainText('Save as project');
  await dialog.locator('input.rf-dialog__input').fill(name);
  await dialog.getByRole('button', { name: 'Save project' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 120_000 });
  await expect(page.locator('[data-action="open-launcher"] .rf-chip__name')).toHaveText(name, {
    timeout: 120_000,
  });
  await page.locator('.rf-launcher__close').click();
  await expect(launcher).toHaveCount(0);
}

async function switchToSavedProject(page: Page, name: string): Promise<void> {
  await page.locator('[data-action="open-launcher"]').click();
  const launcher = page.locator('[data-testid="launcher"]');
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  await launcher.getByRole('button', { name: /^Projects/ }).click();
  const card = launcher.locator('.rf-pcard', { hasText: name }).first();
  await expect(card).toHaveAttribute('role', 'button', { timeout: 120_000 });
  await card.click();
  await expect(launcher).toHaveCount(0, { timeout: 120_000 });
  await expect(page.locator('[data-action="open-launcher"] .rf-chip__name')).toHaveText(name, {
    timeout: 120_000,
  });
}

/**
 * The full sandbox contract in ONE run: create → write → exec → teardown →
 * restore → exec still works (workspace-owner acceptance: snapshot → restore →
 * exec).
 *
 * Two sibling specs each cover only half and never compose:
 *   - the persistence spec does write → reload → `cat` (a READ after restore);
 *   - the cowsay spec does install → exec with NO reload.
 * Neither proves an installed CLI still RUNS after the owner is torn down and
 * its durable project tree restored. A post-reload regression that drops the
 * user's dependency intent or cannot re-establish `.bin` resolution would
 * therefore ship green. This is that composite.
 *
 * Flow:
 *   1. Reset sandbox through the Projects UI → a fresh empty browser sandbox.
 *   2. `npm install cowsay` (exec writes node_modules into the owner) and
 *      `echo MARKER > data.txt` (a user file) — create + write.
 *   3. `cowsay hi` draws `< hi >` / `^__^` — exec runs pre-teardown.
 *   4. `page.reload()` — the browser terminates the owner worker; the re-booted
 *      owner restores the durable active-project tree.
 *   5. The current package.json still names cowsay, `cowsay` draws AGAIN, and
 *      `cat data.txt` returns the marker. Trusted tree reuse and a safe reinstall
 *      after legitimate Vite cache mutation are both valid recovery paths.
 *
 * Requires cross-origin isolation (owner is SAB-IPC-gated); the harness serves
 * COOP/COEP. Chromium-only, matching the other owner specs.
 */
test.describe('owner snapshot survives teardown: install + exec still run after reload', () => {
  test('install cowsay + write → reload → cowsay still draws + file still reads', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(300_000);
    const marker = `restore-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const projectName = `Restore-${Date.now()}`;

    await resetSandboxThroughUi(page);
    await pickStarter(page, 'project-files');
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 60_000 });
    await saveScratchAs(page, projectName);
    await openShellTerminal(page);

    // Create a user file and install a real CLI at the logical project root.
    await runTerminalLineSettled(page, `echo ${marker} > data.txt`, 30_000);
    await expect(
      page.locator('.rf-row[role="treeitem"][data-kind="file"]', { hasText: 'data.txt' }),
    ).toBeVisible({ timeout: 15_000 });
    await runTerminalLineSettled(page, 'npm install cowsay', 200_000);
    await expectTerminalContains(page, /npm: installed \d+ package\(s\)/, 200_000);
    // EXEC pre-teardown: the installed CLI runs in-realm and draws the cow.
    await runTerminalLineSettled(page, 'cowsay before-switch', 30_000);
    await expectTerminalContains(page, '< before-switch >', 20_000);
    expect(await terminalBuffer(page)).toContain('^__^');

    // A public project switch closes the named project's live runtime and waits
    // for its durability phase. Returning to the same identity must recover the
    // user's current manifest and dependency capability, whether the trusted
    // tree is reusable or Vite legitimately revoked it with a cache mutation.
    await selectPreset(page, 'node-worker');
    await switchToSavedProject(page, projectName);
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 120_000 });
    await openShellTerminal(page);
    await runTerminalLineSettled(page, 'cat data.txt', 30_000);
    await expectTerminalContains(page, marker, 15_000);
    await runTerminalLineSettled(page, 'cat package.json', 30_000);
    await expectTerminalContains(page, /"cowsay"\s*:\s*"latest"/u, 15_000);
    await runTerminalLineSettled(page, 'cowsay after-switch', 30_000);
    await expectTerminalContains(page, '< after-switch >', 20_000);

    // TEARDOWN + RESTORE: reload terminates the owner worker; on re-boot the owner
    // restores the current project manifest + user file and reaches a
    // dependency-ready state before serving.
    await page.reload();
    await expect(page.locator('.rf-app[data-workspace-owner="workspace"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0);
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 120_000 });
    await openShellTerminal(page);

    // The restored dependency intent and executable capability must agree.
    await runTerminalLineSettled(page, 'cat package.json', 30_000);
    await expectTerminalContains(page, /"cowsay"\s*:\s*"latest"/u, 15_000);
    await runTerminalLineSettled(page, 'cowsay after-reload', 30_000);
    await expectTerminalContains(page, '< after-reload >', 30_000);
    expect(await terminalBuffer(page)).toContain('^__^');

    // …and the user file written before teardown is still readable.
    await runTerminalLine(page, 'cat data.txt');
    await expectTerminalContains(page, marker, 20_000);

    // FAST RELOAD: reload immediately after install exits, while durability may
    // still be publishing. Restore must either reuse a complete dependency tree
    // or rebuild it; either way the project boots and serves without exposing a
    // torn tree.
    await runTerminalLine(page, 'npm install ms');
    // The terminal buffer does NOT survive the reload above (verified live —
    // review r4's "stale cowsay summary matches first" concern is refuted):
    // this fresh buffer's first summary line IS the ms install's own exit.
    await expectTerminalContains(page, /npm: installed \d+ package\(s\)/, 200_000);
    await page.reload();
    await expect(page.locator('.rf-app[data-workspace-owner="workspace"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0);
    // LIVE proves the restored project can still complete its boot path; a torn
    // dependency tree could not serve the dev server. The newly installed `ms`
    // package may be rebuilt away because the reload intentionally lands inside
    // the durability window.
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 120_000 });
    await openShellTerminal(page);
    await runTerminalLine(page, `echo fast-reload-${marker}`);
    await expectTerminalContains(page, `fast-reload-${marker}`, 30_000);
  });
});
