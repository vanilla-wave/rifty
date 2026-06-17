import { expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

/**
 * Child-realm async-lifecycle e2e (chromium only, COI/SAB-gated).
 *
 * Proves two acceptance criteria of the child-realm-async-lifecycle feature:
 *   - Work scheduled AFTER top-level resolve (setTimeout/microtask) runs before
 *     the child is reaped. Pre-fix the child reaped at top-level → the deferred
 *     callbacks never fire and their output never reaches the terminal.
 *   - An async unhandled rejection after top-level fails LOUDLY (its message
 *     surfaces in the terminal via kernel stderr + exit 1). Pre-fix it was a
 *     silent exit-0 no-op that violated the loud-fail Fidelity rule.
 *
 * Shell cannot run bare `node <script>` (commands resolve only via
 * node_modules/.bin). Approach: write the JS file + a hand-crafted .bin shim
 * (same launcher format the linker emits — `import("../../...")`) using echo
 * and file redirect, then invoke the shim name from the shell.
 *
 * Requires cross-origin isolation (the owner is SAB-IPC-gated; drain uses the
 * kernel onMessage path) — the e2e harness serves COOP/COEP. Chromium-only,
 * matching the other COI specs.
 */
test.describe('child-realm async lifecycle: drain + loud-reject (child-realm-async-lifecycle)', () => {
  test('work scheduled after top-level runs before the child is reaped', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'child drain is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    await page.goto('/');

    // Wait for Terminal 1 to confirm the boot + install finished (vite running).
    // At this point node_modules/.bin exists — safe to write shims there.
    await expect.poll(() => terminalBuffer(page), { timeout: 60_000 }).toMatch(/\$ vite/);

    await openShellTerminal(page);

    // Write the JS file: schedules a setTimeout + microtask AFTER top-level.
    // Pre-fix the child is reaped at top-level → neither callback ever fires.
    await runTerminalLine(
      page,
      'echo \'setTimeout(()=>console.log("late-timeout"),0);Promise.resolve().then(()=>console.log("late-microtask"));\' > /workspace/t-drain.js',
    );

    // Write the .bin launcher shim pointing to the JS file.
    // linker format: import() resolved from the shim dir (node_modules/.bin/),
    // so ../../t-drain.js → /workspace/t-drain.js.
    await runTerminalLine(
      page,
      'echo \'import("../../t-drain.js");\' > /workspace/node_modules/.bin/drain-test',
    );

    // Run the shim — both deferred callbacks must have fired before the child exits.
    await runTerminalLine(page, 'drain-test');

    // Load-bearing assertions: both deferred outputs reached the terminal.
    await expectTerminalContains(page, 'late-timeout', 20_000);
    expect(await terminalBuffer(page)).toContain('late-microtask');
  });

  test('an async rejection after top-level fails loudly', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'child drain is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    await page.goto('/');

    await expect.poll(() => terminalBuffer(page), { timeout: 60_000 }).toMatch(/\$ vite/);

    await openShellTerminal(page);

    // Write the JS file: an unhandled rejection after top-level.
    // Pre-fix this was a silent exit-0 no-op.
    await runTerminalLine(
      page,
      'echo \'Promise.reject(new Error("async-boom"));\' > /workspace/t-reject.js',
    );

    await runTerminalLine(
      page,
      'echo \'import("../../t-reject.js");\' > /workspace/node_modules/.bin/reject-test',
    );

    await runTerminalLine(page, 'reject-test');

    // Load-bearing: the rejection message surfaces in the terminal (stderr →
    // terminal). A stub/silent exit would leave the terminal without "async-boom".
    await expectTerminalContains(page, 'async-boom', 20_000);
  });
});
