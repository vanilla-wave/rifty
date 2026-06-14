import { expect, test } from '@playwright/test';

/**
 * HONEST node_modules/.bin worker-transport e2e (chromium only) — ADR-0137 Opt-Y.
 *
 * DRAFT / CI-FIRST: proves a `.bin` launcher runs end-to-end in a real
 * cross-origin-isolated Worker — the path node tests can't reach (SAB-backed VFS
 * read in the worker + module-loader run of the launcher target). The MECHANISM
 * (`runNodeEntry` + loader shebang-strip + launcher-target resolve) is already
 * proven by `packages/runtime-js/src/builtins/node-entry.test.ts` and the
 * `modules/{cjs,esm}-shebang` parity cases; this is the transport on top.
 *
 * Authored against the `execsync-sab` pattern but NOT run locally (no COI
 * browser in the dev environment) — first execution is in CI. A first-run
 * failure here is a transport/wiring issue, not a mechanism regression.
 *
 * Load-bearing assertion: `GREETED:a|b`. The seeded shim
 * (`#!/usr/bin/env node` + `import('../greet-pkg/bin.js')`) only yields that if
 * the worker stripped the shebang and the loader resolved the relative launcher
 * target against the VFS, then ran it with argv reaching it. The old
 * `kind:'source'` path would `SyntaxError` on the shebang and never paint `pass`.
 */
test.describe('node_modules/.bin execution (real COI Worker + module loader)', () => {
  test('a launcher shim runs its target through the loader and streams stdout', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      // Benign worker-stdout teardown race (see execsync-sab.spec.ts).
      if (err.message.includes('stream.push() after EOF')) return;
      errors.push(err.message);
    });

    await page.goto('/#test=bin-exec');

    const harness = page.locator('[data-testid="bin-exec-harness"]');
    // Generous: full boot + worker spawn + SAB VFS read + loader run.
    await expect(harness).toBeVisible({ timeout: 25_000 });

    const output = (await page.locator('[data-testid="bin-exec-output"]').textContent()) ?? '';
    const detail = (await page.locator('[data-testid="bin-exec-detail"]').textContent()) ?? '';

    expect(output, `harness detail: ${detail}`).toContain('GREETED:a|b');
    await expect(harness).toHaveAttribute('data-status', 'pass');

    expect(errors, `page errors: ${errors.join('; ')}`).toHaveLength(0);
  });
});
