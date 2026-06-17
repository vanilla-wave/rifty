import { expect, test } from '@playwright/test';

/**
 * No jank under load: the PAGE main thread stays responsive while the owner does
 * sustained read-heavy work (workspace-owner acceptance: no jank under read load).
 *
 * The rejected SAB-fs-proxy design had a worker read another realm's store
 * SYNCHRONOUSLY — heavy fs work would block whatever thread issued the read. Under
 * the single-store-owner model all of that runs in the owner Worker; the page main
 * thread only streams output over async IPC, so it must never freeze.
 *
 * The load here is the canonical read-heavy case: the co-resident dev server boot
 * (vite install + first transform burst) — fs-heavy owner work that runs
 * automatically on mount. The command bar renders immediately (before the owner is
 * even spawned), so the probe window — owner spawn → vite boot → first transform —
 * is reliably busy. Probing the page through it: clicking the command bar must open
 * the palette within a tight bound every time.
 *
 * Load-bearing: the palette renders within 2s per probe. If a sync main-thread fs
 * bridge were reintroduced, a heavy owner read would block the click handler and
 * the palette would not appear in time. The final LIVE assertion confirms the load
 * was a real heavy boot, not an instant no-op. (The page is a Worker client, so
 * this passes on the correct architecture and only goes red if that property is
 * lost — a regression guard for the rejected blocking design.)
 *
 * NOT covered here (honest): SHELL responsiveness during the burst — a concurrent
 * shell session not being starved while the dev server transforms co-resident in
 * the SAME owner thread. That owner-thread isolation is the separate
 * supervised-child-dev-server work; this spec asserts the page-main-thread half.
 *
 * Requires cross-origin isolation (owner is SAB-IPC-gated); the harness serves
 * COOP/COEP. Chromium-only, matching the other owner specs.
 */
test.describe('page stays responsive while the owner does heavy read work', () => {
  test('the command palette opens promptly during the co-resident dev-server boot', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    await page.goto('/');

    const openBtn = page.locator('[data-action="open-palette"]');
    const palette = page.getByTestId('command-palette');

    // The command bar renders before the owner spawns; from here the boot window
    // (owner spawn → vite install/transform burst) is reliably busy. Probe the page
    // main thread across it: each click must open the palette within a tight bound.
    // Unconditional probes (no LIVE gate) so a fast warm boot can't race us to zero
    // samples — the early probes always land while the owner is still booting.
    await expect(openBtn).toBeVisible({ timeout: 30_000 });
    for (let i = 0; i < 6; i += 1) {
      await openBtn.click();
      // Normal render is <100ms; a sync owner-read block would be multiple seconds
      // (the install/transform burst is fs-heavy) — so 2s bites without flaking.
      await expect(palette).toBeVisible({ timeout: 2_000 });
      await page.keyboard.press('Escape');
      await expect(palette).toHaveCount(0, { timeout: 2_000 });
      await page.waitForTimeout(600);
    }

    // The load was genuine: the heavy boot actually ran to a listening dev server.
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 90_000 });
  });
});
