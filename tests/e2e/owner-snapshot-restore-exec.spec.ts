import { expect, test } from '@playwright/test';
import { clearWorkspaceOpfs } from './helpers/opfs.ts';
import {
  closeLauncherIfOpen,
  expectTerminalContains,
  openShellTerminal,
  pickStarter,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

/**
 * The full sandbox contract in ONE run: create → write → exec → teardown →
 * restore → exec still works (workspace-owner acceptance: snapshot → restore →
 * exec).
 *
 * Two sibling specs each cover only half and never compose:
 *   - the persistence spec does write → reload → `cat` (a READ after restore);
 *   - the cowsay spec does install → exec with NO reload.
 * Neither proves an installed CLI still RUNS after the owner is torn down and
 * its tree restored — so a post-reload regression in OPFS-persisted node_modules
 * or `.bin` resolution would ship green. This is that composite.
 *
 * Flow:
 *   1. clean OPFS + reload → a fresh owner on an empty tree (deterministic).
 *   2. `npm install cowsay` (exec writes node_modules into the owner) and
 *      `echo MARKER > data.txt` (a user file) — create + write.
 *   3. `cowsay hi` draws `< hi >` / `^__^` — exec runs pre-teardown.
 *   4. `page.reload()` — the browser TERMINATES the owner worker (teardown); the
 *      re-booted owner wires OPFS and preloads the persisted tree (restore).
 *   5. `cowsay hi` draws AGAIN — the installed CLI survived restore and still
 *      resolves + runs (load-bearing: node_modules persisted AND `.bin` resolves
 *      against the preloaded tree); `cat data.txt` returns MARKER (the user file
 *      survived too). On the memory backend both vanish, so the assertions are
 *      honest, not trivially green.
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

    await page.goto('/');
    // Deterministic start: wipe this page's owner workspace namespace only.
    await clearWorkspaceOpfs(page);
    await page.reload();
    await pickStarter(page, 'project-files');
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 60_000 });
    await openShellTerminal(page);

    // CREATE + WRITE. The dev server is already LIVE (its install-stamp flush
    // drained the boot write-through), so these writes drain to OPFS promptly.
    await runTerminalLine(page, `echo ${marker} > /scratch/data.txt`);
    await runTerminalLine(page, 'npm install cowsay');
    // Wait for COMPLETION (not the mid-stream `+ cowsay@`): keystrokes typed
    // mid-install land in the running install's stdin. The summary is the idle signal.
    await expectTerminalContains(page, /npm: installed \d+ package\(s\)/, 200_000);

    // EXEC pre-teardown: the installed CLI runs in-realm and draws the cow.
    await runTerminalLine(page, 'cowsay hi');
    await expectTerminalContains(page, '< hi >', 20_000);
    expect(await terminalBuffer(page)).toContain('^__^');

    // TEARDOWN + RESTORE: reload terminates the owner worker; on re-boot the owner
    // wires OPFS (initBackend) and preloads the persisted tree — node_modules + the
    // user file — before serving.
    await page.reload();
    await closeLauncherIfOpen(page);
    await openShellTerminal(page);

    // EXEC after restore: the installed CLI STILL resolves + runs from the
    // preloaded node_modules (no fresh install) — the load-bearing claim.
    await runTerminalLine(page, 'cowsay hi');
    await expectTerminalContains(page, '< hi >', 30_000);
    expect(await terminalBuffer(page)).toContain('^__^');

    // …and the user file written before teardown is still readable.
    await runTerminalLine(page, 'cat /scratch/data.txt');
    await expectTerminalContains(page, marker, 20_000);
  });
});
