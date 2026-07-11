import { expect, test } from '@playwright/test';
import { clearWorkspaceOpfs, readWorkspaceText } from './helpers/opfs.ts';
import {
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

    // The durability sequence runs in BACKGROUND after install exit (backlog
    // install-stamp-background-flush) — this spec's claim is the RESTORED
    // tree, so wait for its proof IN OPFS, not the in-memory mirror: THIS
    // install's TRUSTED stamp (deps include cowsay — the boot install's
    // earlier stamp does not; no pending marker) is written only after the
    // tree drain reported clean (drain → gate → stamp order), and reading it
    // from OPFS directly proves its own persist finished too. A terminal
    // `cat` would race the reload against the stamp's in-flight persist and
    // silently downgrade this spec to the reinstall/self-heal path.
    await expect
      .poll(
        async () => {
          const text = await readWorkspaceText(
            page,
            '/scratch/node_modules/.rifty-install-stamp.json',
          );
          return text.includes('"cowsay"') && !text.includes('"durability"');
        },
        { timeout: 60_000 },
      )
      .toBe(true);

    // TEARDOWN + RESTORE: reload terminates the owner worker; on re-boot the owner
    // wires OPFS (initBackend) and preloads the persisted tree — node_modules + the
    // user file — before serving.
    await page.reload();
    await expect(page.locator('.rf-app[data-workspace-owner="workspace"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0);
    await openShellTerminal(page);

    // EXEC after restore: the installed CLI STILL resolves + runs from the
    // preloaded node_modules (no fresh install) — the load-bearing claim.
    await runTerminalLine(page, 'cowsay hi');
    await expectTerminalContains(page, '< hi >', 30_000);
    expect(await terminalBuffer(page)).toContain('^__^');

    // …and the user file written before teardown is still readable.
    await runTerminalLine(page, 'cat /scratch/data.txt');
    await expectTerminalContains(page, marker, 20_000);

    // FAST RELOAD (backlog install-stamp-background-flush fault row): reload
    // IMMEDIATELY after install exit, racing the background drain/stamp. The
    // contract is self-heal — restore either reuses the tree (stamp landed) or
    // re-installs (no stamp yet); either way the workspace boots and serves,
    // never a crash or a trusted torn tree. Deliberately NO stamp wait here.
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
    // The dev server reaching LIVE proves the boot install path completed —
    // either the stamp landed (tree reused) or the restore re-installed; a
    // torn trusted tree could not serve the dev server. That IS the fault-row
    // claim: self-heal, no crash (the ms package itself may legitimately be
    // re-installed away — the accepted cost of reloading inside the window).
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 120_000 });
    await openShellTerminal(page);
    await runTerminalLine(page, `echo fast-reload-${marker}`);
    await expectTerminalContains(page, `fast-reload-${marker}`, 30_000);
  });
});
