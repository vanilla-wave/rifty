import { expect, test } from '@playwright/test';
import { openShellTerminal, runTerminalLine, terminalBuffer } from './helpers/playground.ts';

/**
 * P3 (ADR-0146) + P4 (ADR-0148): the page file explorer ALWAYS reflects the OWNER
 * tree (the single source of truth), including files the owner-resident shell
 * writes. The owner republishes its snapshot on each command exit, so a bare shell
 * write (`echo > f`, a program's output) surfaces without any dev-server restart.
 *
 * Chromium-only: the owner is cross-origin-isolation-gated (no PAGE shell under D).
 */
test.describe('owner explorer coherence (ADR-0146 P3 / ADR-0148 P4)', () => {
  test('the file explorer reflects a file the shell writes', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');

    // The explorer renders the OWNER snapshot from boot (SSoT, ADR-0148) — wait
    // for the shell to be ready (the boot sequence echoed the dev line).
    await expect.poll(() => terminalBuffer(page), { timeout: 30_000 }).toContain('$ vite');

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
