/**
 * CLI report template — run-to-completion worker path.
 *
 * Covers the non-server side of the real-project lifecycle: selecting the
 * template runs a Node entry once, streams stdout to the terminal, exits with
 * code 0, and leaves no preview iframe behind.
 */
import { expect, test } from '@playwright/test';
import { capturePageProblems, expectTerminalContains, selectPreset } from './helpers/playground.ts';

test.describe('CLI report template through the worker lifecycle', () => {
  test('preset runs once, prints stdout, exits cleanly, and has no preview', async ({ page }) => {
    test.setTimeout(180_000);
    const problems = capturePageProblems(page);
    await page.goto('/');

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });

    await selectPreset(page, 'cli-report');

    await expectTerminalContains(page, 'cli: running CLI report', 120_000);
    await expectTerminalContains(page, 'npm: + yaml@', 120_000);
    await expectTerminalContains(page, '[cli] package report', 30_000);
    await expectTerminalContains(page, '[cli] packages=3 -> api, docs, jobs', 30_000);
    await expectTerminalContains(page, '[cli] completed with exit code 0', 30_000);

    await expect(page.locator('iframe[title^="Preview port"]')).toHaveCount(0);
    problems.assertNoViteImportErrors();
  });
});
