import { expect, test } from '@playwright/test';
import {
  bootShell,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

/**
 * SESSION-CONCURRENCY + child-kill e2e for the supervised-child-CLI model
 * (ADR-0150), chromium/COI only.
 *
 * Each shell-resolved `.bin` CLI runs in a SUPERVISED CHILD worker that
 * reads the owner filesystem over `fs.*` sync-RPC; the owner stays a free async
 * SUPERVISOR. `owner-shell-cowsay.spec.ts` already proves a child runs + draws.
 * This proves the supervisor serves MANY children at once and can KILL one:
 *
 *   - Terminal 2 runs bare `cowsay` (no args → get-stdin BLOCKS) — a long-lived
 *     child that holds its session, never returning a prompt.
 *   - Terminal 3, a SECOND idle shell on the SAME owner, runs `cowsay hi` and
 *     DRAWS `< hi >` WHILE Terminal 2's child is still blocked. The owner served
 *     two concurrent children and stayed responsive (load-bearing assertion).
 *   - Ctrl-C on Terminal 2 kills the blocked child (shell resolves exit 130);
 *     the session recovers — a fresh `echo alive` then runs and prints `alive`.
 *
 * NOT covered here (HONEST): a CPU-bound RED→GREEN proving the owner thread is
 * not stalled by a CPU-heavy child. No CPU-hog bin ships in the default
 * template, and bare `node <script>` is not runnable from the shell (commands
 * resolve only via `node_modules/.bin`), so we do not fake one. The
 * architectural non-stall property (children are workers, owner never runs bin
 * code) is recorded in ADR-0150.
 *
 * Requires cross-origin isolation (owner is SAB-IPC-gated, no PAGE fallback);
 * the e2e harness serves COOP/COEP. Chromium-only, matching the other COI specs.
 */
test.describe('owner supervisor serves concurrent child CLIs + Ctrl-C kills a child (supervised child-CLI model, ADR-0150)', () => {
  test('Terminal 3 draws while Terminal 2 child blocks; Ctrl-C recovers Terminal 2', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);
    await bootShell(page);

    // Terminal 2 = a plain idle shell on the persistent owner (Terminal 1 auto-
    // boots the dev server). All sessions share the owner store.
    await openShellTerminal(page);

    // Install cowsay ONCE into the owner store; every terminal resolves it.
    await runTerminalLine(page, 'npm install cowsay');
    // Wait for COMPLETION, not the mid-stream `+ cowsay@`: keystrokes typed
    // mid-install land in the running install's stdin (the terminal routes to
    // the foreground process). The summary line is the idle signal.
    await expectTerminalContains(page, /npm: installed \d+ package\(s\)/, 150_000);

    // Terminal 2: bare `cowsay` reads STDIN (get-stdin) → BLOCKS, keeping its
    // child alive and occupying this session. No prompt returns; do NOT wait for
    // output. Confirm the line was accepted (echoed) before moving on so the
    // child is actually live when Terminal 3 runs.
    await runTerminalLine(page, 'cowsay');
    await expectTerminalContains(page, /> cowsay\b/, 10_000);
    // Terminal 2's blocked child has drawn nothing — no cow yet.
    expect(await terminalBuffer(page, 1)).not.toContain('< hi >');

    // Terminal 3: a SECOND idle shell on the same owner.
    await page.getByRole('button', { name: 'New terminal' }).click();
    await expect(page.getByRole('tab', { name: /Terminal 3/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // LOAD-BEARING: Terminal 3's child draws the cow WHILE Terminal 2's child is
    // still blocked on stdin → the owner served two concurrent children and
    // stayed responsive. Terminal 3 is the active terminal now.
    await runTerminalLine(page, 'cowsay hi');
    await expectTerminalContains(page, '< hi >', 20_000);
    expect(await terminalBuffer(page)).toContain('^__^');
    // Terminal 2 is STILL blocked (never drew anything) — concurrency, not a
    // serialized hand-off where T3 only ran after T2 finished.
    expect(await terminalBuffer(page, 1)).not.toContain('< hi >');

    // Switch back to Terminal 2 and Ctrl-C its blocked child. The shell resolves
    // the interrupted run as exit 130 and returns the prompt.
    await page.getByRole('tab', { name: /Terminal 2/ }).click();
    await expect(page.getByRole('tab', { name: /Terminal 2/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.locator('[data-testid="terminal"]').click();
    await page.keyboard.press('Control+c');

    // The session recovered: a fresh command runs and prints — proving the
    // blocked child was killed (else `echo alive` would land in cowsay's stdin).
    await runTerminalLine(page, 'echo alive');
    await expectTerminalContains(page, 'alive', 15_000);
  });
});
