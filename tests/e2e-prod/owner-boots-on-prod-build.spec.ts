import { expect, test } from '@playwright/test';

/**
 * Prod-artifact smoke: the workspace owner MUST boot on the PRODUCTION bundle
 * served with cross-origin-isolation headers (`pnpm preview` == the Netlify
 * artifact). Guards the green-checks-but-broken-deploy gap: the dev e2e runs
 * against `pnpm dev`, so a prod-ONLY regression slips it. The concrete catch
 * this is born from — a stray top-level `installProcessGlobals()` side-effect
 * pulled into the owner chunk in the prod bundle wiped `globalThis.process.env`,
 * so the owner threw `missing RIFTY_KERNEL_WORKER_URL / RIFTY_NODE_ENTRY_WORKER_URL`
 * and the dev server never came up (explorer stuck "Loading the workspace…").
 * Dev never loaded that module → green e2e, dead deploy. Now the owner reads its
 * env from the kernel process spec; this spec keeps it honest.
 *
 * Requires cross-origin isolation (owner is SAB-IPC-gated); preview serves
 * COOP/COEP. Chromium-only, matching the owner specs.
 */
test.describe('production build smoke', () => {
  test('owner boots + dev server reaches LIVE with no boot error', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);

    const bootErrors: string[] = [];
    page.on('console', (m) => {
      if (/missing RIFTY_(KERNEL|NODE_ENTRY)_WORKER_URL|cannot spawn child CLIs/.test(m.text())) {
        bootErrors.push(m.text());
      }
    });
    page.on('pageerror', (e) => bootErrors.push(`pageerror: ${e.message}`));

    await page.goto('/');

    // The owner is SAB-gated: COI must be live on the prod headers (not just dev).
    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);

    // The owner boots the co-resident dev server → LIVE pill. If the owner threw
    // on boot (e.g. wiped env), this never appears.
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 90_000 });

    expect(bootErrors, `owner boot errors:\n${bootErrors.join('\n')}`).toEqual([]);
  });
});
