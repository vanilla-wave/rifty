import { test } from '@playwright/test';
import { runWebpackDevServerScenario } from '../e2e/helpers/webpack-dev-server-scenario.ts';

test.describe('production build — Webpack dev server starter', () => {
  test('keeps the cold install, HMR, and reload contract in the emitted artifact', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(420_000);
    await runWebpackDevServerScenario(page);
  });
});
