import { expect, test } from '@playwright/test';

/**
 * HONEST execSync-over-SAB e2e (chromium only).
 *
 * Proves rifty's real `execSync` path end-to-end in a cross-origin-isolated
 * Worker — the path Node tests CANNOT exercise: real SharedArrayBuffer +
 * `Atomics.waitAsync` dispatcher wake + ADR-0084 v2 binary frame. The
 * conformance suites (tests/conformance/builtins/exec-sync-worker.test.ts) wire
 * the kernel in Node but `skipIf(!sabReady)` the blocking path because Node has
 * no kernel-worker URL — this harness is where that path runs for real.
 *
 * The load-bearing assertion is `hex === 'fffe00'`: the guest's child writes raw
 * non-UTF-8 bytes `[0xff,0xfe,0x00]` and the guest emits `out.toString('hex')`.
 *   - A correct v2 BINARY frame carries the bytes byte-exact → 'fffe00'.
 *   - A broken frame (JSON/TextDecoder round-trip) mangles them to U+FFFD →
 *     'efbfbd...' — this spec FAILS.
 *   - A broken dispatcher (no waitAsync wake) hangs the guest → the result node
 *     never appears → this spec TIMES OUT.
 * A stub cannot fake 'fffe00' without doing the real byte-exact round-trip.
 *
 * Chromium-only: webkit/firefox SAB+SW is the historical flake source.
 */
test.describe('execSync over SAB (real COI Worker + v2 binary frame)', () => {
  test('guest execSync returns byte-exact non-UTF-8 stdout + a blocking result', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      // Benign worker-stdout teardown race: after the guest exits, the kernel's
      // stdout Readable pushes EOF (`push(null)`), and a late stdout MessagePort
      // chunk can arrive and `push()` after EOF. It is unrelated to execSync
      // correctness (the result is already captured) — filter it so this guard
      // still catches every OTHER page error.
      if (err.message.includes('stream.push() after EOF')) return;
      errors.push(err.message);
    });

    await page.goto('/#test=execsync');

    const harness = page.locator('[data-testid="execsync-harness"]');
    // Generous timeout: spawn + recursive child + SAB round-trip. A hung
    // dispatcher would never paint the node and trip this.
    await expect(harness).toBeVisible({ timeout: 20_000 });

    const detail = (await page.locator('[data-testid="execsync-detail"]').textContent()) ?? '';
    const hex = (await page.locator('[data-testid="execsync-hex"]').textContent()) ?? '';
    const blocked = (await page.locator('[data-testid="execsync-blocked"]').textContent()) ?? '';

    // The real round-trip: byte-exact non-UTF-8 bytes survive the v2 binary frame.
    expect(hex, `harness detail: ${detail}`).toContain('fffe00');
    // The blocking round-trip returns the child's captured stdout.
    expect(blocked).toContain('blocked-result');
    // Overall harness verdict.
    await expect(harness).toHaveAttribute('data-status', 'pass');

    expect(errors, `page errors: ${errors.join('; ')}`).toHaveLength(0);
  });
});
