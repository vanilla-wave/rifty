/**
 * ADR-0165 §4 — the active workspace ROOT follows the page store's `activeId`,
 * not an interim `activePreset` signal. On a cold boot a SCRATCH is active, so
 * every page surface keyed on `activeRoot()` resolves to `/scratch` — NOT
 * `/projects/<starter>` (which would mistake the boot STARTER id for a PROJECT id).
 *
 * Probe = the terminal mode-hint detail (`Commands run in <activeRoot()>; …`),
 * the page-side surface driven straight off `activeRoot()`. (`pwd` is unreliable
 * here: the shell cwd is seeded from the terminal-persistence path `/workspace`,
 * which masks the workspace root — so it tests the wrong thing.)
 *
 * This is the load-bearing guard for the store↔root single-source fix: revert
 * `activeRoot` to `rootForId(activePreset())` and this spec FAILS, reporting
 * `/projects/project-files`.
 */
import { expect, test } from '@playwright/test';

test.describe('ADR-0165 §4 — boot root follows the page store (active scratch)', () => {
  test('every root-keyed surface resolves to /scratch, not /projects/<starter>', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto('/');

    // The mode hint is the page's own rendering of `activeRoot()`.
    const hint = page.locator('[data-testid="terminal-mode-hint"]').first();
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toContainText('Commands run in /scratch;', { timeout: 15_000 });
    await expect(hint).not.toContainText('/projects/project-files');

    // The chip names the active scratch from its Starter label, never a project id
    // — corroborates the single source from the other surface.
    await expect(page.locator('[data-action="open-launcher"]')).toContainText(
      'Project files scratch',
    );
  });
});
