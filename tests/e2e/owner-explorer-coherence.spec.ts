import { expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectViteDevServerReady,
  openShellTerminal,
  runTerminalLine,
} from './helpers/playground.ts';

/**
 * ADR-0146 (explorer reflects the owner tree) + ADR-0148 (co-resident dev server
 * inside the owner): the page file explorer ALWAYS reflects the OWNER tree (the
 * single source of truth), including files the owner-resident shell writes. The
 * owner republishes its snapshot on each command exit, so a bare shell write
 * (`echo > f`, a program's output) surfaces without any dev-server restart.
 *
 * Chromium-only: the owner is cross-origin-isolation-gated. In the single-store-owner
 * model exactly one realm owns the authoritative VFS store, so the page runs no shell.
 */
test.describe('owner explorer coherence (ADR-0146 explorer-reflects-owner / ADR-0148 co-resident dev server)', () => {
  test('the file explorer reflects a file the shell writes', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(60_000);
    await bootProjectFiles(page);

    // The explorer renders the OWNER snapshot from boot (SSoT, ADR-0148) — wait
    // for the shell to be ready (the boot sequence echoed the dev line).
    await expectViteDevServerReady(page);

    await openShellTerminal(page);
    const marker = `p3marker${Date.now().toString(36)}`;
    await runTerminalLine(page, `echo hello > ${marker}.txt`);

    // The owner republishes its snapshot on command exit (explorer reflects the
    // owner tree) → the page's file tree shows the shell-created file without any
    // dev-server restart.
    await expect(page.getByRole('treeitem', { name: new RegExp(`${marker}\\.txt`) })).toBeVisible({
      timeout: 15_000,
    });
  });
});
