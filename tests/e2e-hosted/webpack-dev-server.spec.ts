import { expect, test } from '@playwright/test';
import { runWebpackDevServerScenario } from '../e2e/helpers/webpack-dev-server-scenario.ts';

test.describe('Webpack dev server on a deployed hostname', () => {
  test('serves and hot-updates without navigation on the exact page hostname', async ({ page }) => {
    test.setTimeout(420_000);

    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 30_000,
    });
    await page
      .waitForSelector('[data-testid="launcher"], [data-testid="terminal"]', { timeout: 60_000 })
      .catch(() => {});
    await page.waitForTimeout(3_000);
    expect(
      await page.evaluate(() => ({
        protocol: globalThis.location.protocol,
        hostname: globalThis.location.hostname,
        isSecureContext: globalThis.isSecureContext,
        crossOriginIsolated: globalThis.crossOriginIsolated,
      })),
    ).toEqual({
      protocol: 'https:',
      hostname: 'hosted.rifty.test',
      isSecureContext: true,
      crossOriginIsolated: true,
    });

    await runWebpackDevServerScenario(page);
  });
});
