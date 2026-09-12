import { test } from '@playwright/test';
import { runWebpackDevServerScenario } from './helpers/webpack-dev-server-scenario.ts';

test.describe('Webpack dev server starter', () => {
  test('cold-installs, serves, hot-updates, and restarts over persisted source', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(420_000);
    await runWebpackDevServerScenario(page);
  });
});
