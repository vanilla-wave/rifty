import { expect, test } from '@playwright/test';
import { openShellTerminal, runTerminalLine, terminalBuffer } from './helpers/playground.ts';

/**
 * P3 (ADR-0146): the page file explorer reflects the OWNER tree, including files
 * the owner-resident shell writes. Pre-P3 the owner only republished its snapshot
 * on editor writes / npm — a bare shell write (`echo > f`, a program's output)
 * left the explorer stale. The owner now republishes on each command exit.
 *
 * Chromium-only: the owner is cross-origin-isolation-gated (no PAGE shell under D).
 */
test.describe('owner explorer coherence (ADR-0146 P3)', () => {
  test('the file explorer reflects a file the shell writes', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');

    // The explorer renders the OWNER snapshot only once the dev server is up
    // (before that it shows the page mirror, which the shell never writes). The
    // boot terminal logs this when devServerRunning flips true.
    await expect
      .poll(() => terminalBuffer(page), { timeout: 30_000 })
      .toContain('dev server ready');

    await openShellTerminal(page);
    const marker = `p3marker${Date.now().toString(36)}`;
    await runTerminalLine(page, `echo hello > ${marker}.txt`);

    // The owner republishes its snapshot on command exit (P3) → the page's file
    // tree shows the shell-created file without any dev-server restart.
    await expect(page.getByRole('treeitem', { name: new RegExp(`${marker}\\.txt`) })).toBeVisible({
      timeout: 15_000,
    });
  });
});
