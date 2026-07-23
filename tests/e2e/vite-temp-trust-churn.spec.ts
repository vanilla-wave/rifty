import { expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  runTerminalLineSettled,
} from './helpers/playground.ts';

/**
 * ADR-0307 churn scenario (backlog: playground/vite-temp-install-claim-churn):
 * a `vite` run writes temp config modules into `node_modules/.vite-temp`.
 * Extraneous writes inside the tree must neither mark the fresh Scratch dirty
 * nor demote/revoke the install claim — matching real npm, which never
 * re-validates tree bytes. Before ADR-0307 the write revoked the whole-tree
 * claim (stamp file deleted) and flagged the scratch UNSAVED.
 */
test.describe('ADR-0307 — vite temp churn leaves trust and Scratch intact', () => {
  test('vite boot reaches LIVE with a clean scratch and a live trusted claim', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);

    await bootProjectFiles(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    await expectViteDevServerReady(page, 5174, 120_000);

    // No edit was made: the scratch stays clean after the vite run.
    await expect(page.locator('[data-action="open-launcher"][data-dirty="true"]')).toHaveCount(0);

    await openShellTerminal(page);

    // Vacuity guard: the churn actually happened — vite's config loader used
    // node_modules/.vite-temp (the temp file itself is removed after import,
    // the directory stays). `cd` into it fails loudly if it never existed.
    await runTerminalLineSettled(page, 'cd /node_modules/.vite-temp', 60_000);
    await runTerminalLineSettled(page, 'pwd', 30_000);
    await expectTerminalContains(page, '/node_modules/.vite-temp');
    await runTerminalLineSettled(page, 'cd /', 30_000);

    // The install claim survived the churn: the revoke path would have deleted
    // the stamp file; a demote would have left it pending — cat proves it is
    // still present as a v4 claim.
    await runTerminalLineSettled(
      page,
      'cat /node_modules/.rifty-install-stamp.json | grep version',
      60_000,
    );
    await expectTerminalContains(page, '"version": 4');

    // Still clean after reading through the tree.
    await expect(page.locator('[data-action="open-launcher"][data-dirty="true"]')).toHaveCount(0);
  });
});
