import { expect, test } from '@playwright/test';
import { clearWorkspaceOpfs } from './helpers/opfs.ts';
import {
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
} from './helpers/playground.ts';

/**
 * Regression (code-review 2026-07-01): the on-mount `seedWorkspaceOwner`
 * (App.tsx) pushes the boot preset's STARTER files into the owner
 * UNCONDITIONALLY — no dirty/index guard. A NEW file survives reload
 * (owner-persistence-reload.spec covers that), but a starter file the user
 * EDITED could be clobbered back to its seeded content when the mount re-seeds.
 *
 * Load-bearing: overwrite the default preset's `src/main.js` with a marker,
 * reload (owner worker restores the edited file from OPFS), and assert the
 * marker is STILL there — i.e. the mount seed did not overwrite the persisted
 * edit. On the clobber bug the reload shows the seeded source, not the marker.
 *
 * RED-checked (verified failing 2026-07-01 before the fix): the on-mount
 * `runVitePreset` → `seedViteWorkspace` used overwrite semantics on every boot,
 * so a reload clobbered a persisted edit. Fixed by re-seeding `ifAbsent` on a
 * boot/reload (a preset SWITCH keeps overwrite), so this guards the reload leg.
 */
test.describe('a starter-file edit survives reload (mount seed must not clobber)', () => {
  test('edited src/main.js keeps the edit after page.reload()', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    const marker = `edit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    await page.goto('/');
    await clearWorkspaceOpfs(page);
    await page.reload();
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 60_000 });
    await openShellTerminal(page);

    // Overwrite a SEEDED starter file (default preset seeds src/main.js) with a
    // marker, and confirm the write landed.
    await runTerminalLine(page, `echo ${marker} > /scratch/src/main.js`);
    await runTerminalLine(page, 'cat /scratch/src/main.js');
    await expectTerminalContains(page, marker, 15_000);

    // Reload: owner restores the edited file from OPFS, then the page mounts and
    // (today) re-seeds the starter files. The edit must survive.
    await page.reload();
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 60_000 });
    await openShellTerminal(page);
    await runTerminalLine(page, 'cat /scratch/src/main.js');
    await expectTerminalContains(page, marker, 20_000);
  });
});
