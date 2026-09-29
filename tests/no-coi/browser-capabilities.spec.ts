import { expect, test } from './fixtures/test.ts';

const root = process.cwd().replaceAll('\\', '/');

test('required persistence support probe uses the lane storage context', async ({
  page,
  browser,
}) => {
  await page.goto('/no-coi-harness.html');
  const report = await page.evaluate(async (root) => {
    const { checkSandboxSupport } = await import(`/@fs${root}/packages/workbench/src/index.ts`);
    return checkSandboxSupport({
      probeBaseUrl: `/@fs${root}/packages/workbench/dist/assets/`,
      persistence: 'required',
    });
  }, root);
  test.info().annotations.push({ type: 'browser-build', description: browser.version() });
  await test.info().attach('support-report', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  console.log(
    `[support-probe] ${browser.browserType().name()}/${browser.version()} ${JSON.stringify(report)}`,
  );
  expect(report.modes.nonCoi.conclusion).toBe('supported');
  expect(report.checks.find((check: { id: string }) => check.id === 'opfs')?.status).toBe('passed');
});
