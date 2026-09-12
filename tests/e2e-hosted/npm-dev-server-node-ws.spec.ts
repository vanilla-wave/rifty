import { expect, test } from '@playwright/test';
import { runNpmDevServerNodeWsScenario } from '../e2e/helpers/npm-dev-server-node-ws-scenario.ts';

test.describe('npm-dev-server node-ws class-proof on a deployed hostname', () => {
  test('serves and live-updates a non-webpack npm-dev-server on the exact page origin', async ({
    page,
  }) => {
    test.setTimeout(180_000);

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

    await runNpmDevServerNodeWsScenario(page);
  });
});
