import { expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

/**
 * Child-realm async-lifecycle e2e — TRUE drain observables (chromium only, COI/SAB-gated).
 *
 * WHY console.log-only assertions are insufficient:
 *   The advisory `self.close()` at the end of a drain (or even at top-level) lets
 *   a late `console.log` race out BEFORE the close actually fires — so a test that
 *   only checks for a log line passes even when drain is disabled. The real signal
 *   that distinguishes "drained cleanly" from "drain disabled / hung on cap" is
 *   whether the SHELL PROMPT returns promptly so a second command can run. Pre-fix
 *   the child hangs ~30s on the keepalive drain cap (a bundler-injected HMR timer
 *   pins the event loop); post-fix the loop drains immediately and the shell is
 *   free in milliseconds.
 *
 * Test A: post-top-level setTimeout work completes AND the child drains promptly.
 *   The second `cat` command is the load-bearing signal: if the child is still hung
 *   the shell swallows keystrokes until the cap fires (~30s), so a prompt `cat`
 *   response proves clean drain. Also asserts no "exceeded keepalive drain cap" in
 *   the buffer.
 *
 * Test B: an async rejection via setTimeout fails loudly (not silent exit 0).
 *   A stray infra timer or silent-stub drain would never surface the rejection;
 *   only a correctly drained realm with unhandledrejection wired to stderr shows it.
 */
test.describe('child-realm async lifecycle: true drain observables (child-realm-async-lifecycle)', () => {
  test('post-top-level setTimeout work completes AND child drains promptly (no cap hang)', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'child drain is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    await page.goto('/');

    await expect.poll(() => terminalBuffer(page), { timeout: 60_000 }).toMatch(/\$ vite/);

    await openShellTerminal(page);

    // Write p1.js: schedules a setTimeout that writes a file AND logs after top-level.
    await runTerminalLine(
      page,
      'echo \'import fs from "node:fs"; setTimeout(function(){ fs.writeFileSync("/workspace/p1.txt","P1DISK"); console.log("P1CB_DONE"); }, 0);\' > /workspace/p1.js',
    );

    // Write the .bin shim (linker format: import() from the shim's dir).
    await runTerminalLine(
      page,
      'echo \'import("../../p1.js");\' > /workspace/node_modules/.bin/p1',
    );

    // Run p1 — the setTimeout callback must fire before the child is reaped.
    await runTerminalLine(page, 'p1');

    // Assert the deferred log reached the terminal.
    await expectTerminalContains(page, 'P1CB_DONE', 20_000);

    // THE DECISIVE SIGNAL: run a second command promptly. Pre-fix the shell is
    // busy for ~30s (drain cap hang); post-fix the shell is free immediately.
    // 8s timeout is generous — a drained child returns the prompt in <1s.
    await runTerminalLine(page, 'cat /workspace/p1.txt');
    await expectTerminalContains(page, 'P1DISK', 8_000);

    // No cap-exceeded message anywhere in the buffer.
    expect(await terminalBuffer(page)).not.toContain('exceeded keepalive drain cap');
  });

  test('an async rejection after top-level via setTimeout fails loudly (not silent exit 0)', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'child drain is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    await page.goto('/');

    await expect.poll(() => terminalBuffer(page), { timeout: 60_000 }).toMatch(/\$ vite/);

    await openShellTerminal(page);

    // Write p2.js: fires an unhandled rejection inside a setTimeout.
    await runTerminalLine(
      page,
      'echo \'setTimeout(function(){ Promise.reject(new Error("ASYNCBOOM")); }, 0);\' > /workspace/p2.js',
    );

    // Write the .bin shim.
    await runTerminalLine(
      page,
      'echo \'import("../../p2.js");\' > /workspace/node_modules/.bin/p2',
    );

    // Run p2 — the rejection must surface in the terminal (not silent exit 0).
    await runTerminalLine(page, 'p2');

    // Load-bearing: rejection message reaches the terminal via stderr.
    // A silent exit-0 or stub drain would NOT show "ASYNCBOOM".
    await expectTerminalContains(page, 'ASYNCBOOM', 20_000);
  });
});
