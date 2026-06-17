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
 * ROOT CAUSE (drain hang):
 *   In DEV, Vite's worker-bundle pipeline injects `@vite/client` into the child
 *   realm when it sees a literal `import(<variable>)` in worker-entry.ts runEntry.
 *   @vite/client arms a 30 s keepalive-ping setInterval AFTER the WS "connected"
 *   event — async, after installTimerGlobals — so the ping fires via the
 *   refcount-counted global setInterval, pinning refCount at 1. The
 *   run-to-completion child never drains → 30 s cap hang. Reproduces ~14/14 on a
 *   fresh dev server (WS connect is near-instant locally).
 *
 *   Fix (590f20cb): runEntry uses `(0,eval)('u=>import(u)')` — the indirect eval
 *   hides the literal `import(` from Vite's static lexer → no @vite/client injected
 *   → child drains in ~250 ms, zero contamination.
 *
 *   CACHE CAVEAT: a stale Vite transform cache from a mid-session revert can mask
 *   a reverted fix (the old indirect-eval transform is still cached). A fresh dev
 *   server reproduces the hang 14/14. Test C (content assertion) is immune to this
 *   cache artifact — it checks the LIVE served transform.
 *
 * Test A (functional guard): post-top-level setTimeout work completes AND child
 *   drains promptly (no cap hang). The second `cat` command is the load-bearing
 *   signal: if the child is still hung the shell swallows keystrokes until the cap
 *   fires (~30 s), so a prompt `cat` response proves clean drain. Also asserts no
 *   "exceeded keepalive drain cap" in the buffer.
 *
 * Test B (loud-fail guard): async rejection via setTimeout surfaces on stderr (not
 *   silent exit 0). A stray infra timer or silent-stub drain would never surface the
 *   rejection; only a correctly drained realm with unhandledrejection wired to
 *   stderr shows it.
 *
 * Test C (deterministic contamination guard — cache-robust): fetches the LIVE
 *   Vite dev-server transform of the kernel worker-entry chunk and asserts it
 *   contains NO `/@vite/client` import and NO `__vite__injectQuery` helper.
 *   Deterministic: reverting the fix re-introduces both markers on a fresh server →
 *   this test goes RED regardless of transform cache state (it reads the live
 *   transform, not a cached one). Immune to the timing-window in Test A.
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

  test('kernel worker-entry chunk served by dev server contains no @vite/client injection (contamination guard)', async ({
    page,
    request,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'dev-server fetch — chromium only for COI parity');

    // Navigate first so the dev server is warm (webServer may lazily compile).
    await page.goto('/');
    await expect.poll(() => terminalBuffer(page), { timeout: 60_000 }).toMatch(/\$ vite/);

    // Fetch the Vite dev-server transform of the kernel worker-entry module.
    // `kernel-worker-entry.ts` is the playground's worker entry chunk — it lives
    // inside the Vite root (apps/playground) so it is served at the root-relative
    // path below. Vite transforms it on GET; the response is the processed source.
    //
    // If @vite/client is injected (pre-fix: literal `import(entry.url)` in
    // worker-entry.ts), the transform contains `import "/@vite/client"` and the
    // `__vite__injectQuery` helper. The indirect-eval fix makes the lexer blind to
    // that import() — no injection → neither marker appears.
    const res = await request.get('/src/workers/kernel-worker-entry.ts');
    expect(res.status()).toBe(200);
    const src = await res.text();

    // These two markers are the canonical signatures of Vite worker injection.
    // Either one being present means @vite/client is armed in the child realm.
    expect(src).not.toContain('/@vite/client');
    expect(src).not.toContain('__vite__injectQuery');
  });
});
