import { expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

/**
 * HONEST owner-resident-shell e2e (chromium only, ADR-0146 P2).
 *
 * The headline acceptance of ADR-0143 "D": an installed CLI run from the shell
 * ACTUALLY RUNS. Before P2 this ENOENT'd — the shell + `npm install` lived in
 * the PAGE realm while each `.bin` invocation spawned a worker with its OWN
 * empty store. P2 moves the `Shell` + npm + bin into one persistent workspace
 * owner whose `syncMirror` holds `node_modules`, so `npm install cowsay` then
 * `cowsay hi` resolve the same in-realm tree.
 *
 * Load-bearing assertions:
 *   - `npm: + cowsay@`     → the install ran in the owner and wrote its store.
 *   - `< hi >` + `^__^`    → the resolved `.bin/cowsay` shim ran in-realm and
 *                            streamed real output over the pty channel (a stub
 *                            cannot draw the cow without executing cowsay).
 *   - `ls node_modules` has `cowsay` → the owner tree the editor/explorer read
 *                            (over the snapshot port) holds the installed dep.
 *
 * Requires cross-origin isolation (the owner is SAB-IPC-gated; no PAGE shell
 * fallback under D) — the e2e harness serves COOP/COEP. Chromium-only, matching
 * the other COI specs (execsync-sab.spec.ts).
 */
test.describe('owner-resident shell runs an installed CLI end-to-end (ADR-0146 P2)', () => {
  test('npm install cowsay → cowsay hi draws the cow from the owner node_modules', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto('/');

    // A second terminal is a plain idle shell on the same persistent owner
    // (the first auto-boots the dev server). Both sessions share the owner store.
    await openShellTerminal(page);

    await runTerminalLine(page, 'npm install cowsay');
    // Wait for the install to COMPLETE, not for the mid-stream `+ cowsay@`:
    // cowsay resolves several packages deep, so a command typed at that point
    // lands in the still-running install's stdin (the terminal routes keystrokes
    // to the foreground process), never running as its own line. The summary
    // line is the idle signal.
    await expectTerminalContains(page, /npm: installed \d+ package\(s\)/, 150_000);
    expect(await terminalBuffer(page)).toContain('npm: + cowsay@');

    await runTerminalLine(page, 'cowsay hi');
    // cowsay wraps short text as `< hi >` above the ASCII cow (`^__^`).
    await expectTerminalContains(page, '< hi >', 20_000);
    expect(await terminalBuffer(page)).toContain('^__^');

    // The owner tree (what the explorer renders over the snapshot port) holds it.
    await runTerminalLine(page, 'ls node_modules');
    await expectTerminalContains(page, 'cowsay', 10_000);
  });
});
