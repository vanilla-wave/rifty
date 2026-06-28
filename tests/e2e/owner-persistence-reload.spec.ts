import { expect, test } from '@playwright/test';
import { clearWorkspaceOpfs, readWorkspaceText } from './helpers/opfs.ts';
import {
  expectTerminalContains,
  openShellTerminal,
  pickStarter,
  runTerminalLine,
} from './helpers/playground.ts';

/**
 * Owner OPFS persistence (chromium only; ADR-0013/0072 + ADR-0143 single-store-owner).
 *
 * The workspace owner is the single source-of-truth for the project tree, but
 * was the only worker realm not wiring `initBackend()` → it ran
 * memory-only, so everything vanished on reload. OPFS is now wired in the owner; the
 * OPFS content-cache write-through (ADR-0072) then persists shell writes, so a
 * file written from the shell survives `page.reload()`.
 *
 * Load-bearing: write `MARKER > /scratch/persist.txt`, reload (browser
 * terminates the owner worker), re-open a shell, `cat` → MARKER returns from the
 * OPFS-preloaded tree. On the memory backend this fails (the reload loses it),
 * so the assertion is honest, not trivially green.
 *
 * Requires cross-origin isolation (the owner is SAB-IPC-gated; the harness serves
 * COOP/COEP). Unique per-run marker → no dependence on (or pollution of) prior
 * OPFS state across tests in a worker.
 *
 * Timing: the dev server auto-boots in Terminal 1 on mount and grabs terminal
 * focus while it streams; we wait for the LIVE pill before opening the second
 * shell so Terminal 2 stays the active session (else the active-terminal read
 * lands on the dev-server log, not our shell).
 */
test.describe('owner workspace persists across reload (OPFS)', () => {
  test('a shell-written file survives page.reload()', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    const marker = `persist-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    await page.goto('/');
    // Deterministic start: wipe this page's owner workspace namespace only.
    await clearWorkspaceOpfs(page);
    await page.reload();
    await pickStarter(page, 'project-files');
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 60_000 });
    await openShellTerminal(page);

    // Write via the shell → owner syncMirror. The dev server is already LIVE (boot
    // write-through drained by the install stamp flush), so this small write drains
    // to OPFS promptly — durable well before the reload below.
    await runTerminalLine(page, `echo ${marker} > /scratch/persist.txt`);
    await runTerminalLine(page, 'cat /scratch/persist.txt');
    await expectTerminalContains(page, marker, 15_000);
    await expect
      .poll(() => readWorkspaceText(page, '/scratch/persist.txt'), { timeout: 60_000 })
      .toContain(marker);

    // Reload: the browser terminates the owner worker; on re-boot the owner wires
    // OPFS (initBackend) and preloads the persisted tree before serving.
    await page.reload();
    await expect(page.locator('.rf-app[data-workspace-owner="workspace"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0);
    await expect
      .poll(() => readWorkspaceText(page, '/scratch/persist.txt'), { timeout: 60_000 })
      .toContain(marker);
    await openShellTerminal(page);
    await runTerminalLine(page, 'cat /scratch/persist.txt');
    await expectTerminalContains(page, marker, 20_000);
  });
});
