import { expect, test } from '@playwright/test';
import { gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

async function bootWorkbenchAndExec(page: import('@playwright/test').Page) {
  return page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    const t0 = performance.now();
    let opened = false;
    try {
      await fixture.openSealedWorkbenchFixture({
        workspaceId: 'browser-unit-owner-boot',
        template: 'hidden-empty',
        persistence: 'ephemeral',
      });
      opened = true;
      const tReady = performance.now();
      const pwd = await fixture.executeProjectLine('pwd');
      const tExec1 = performance.now();
      const echo = await fixture.executeProjectLine('echo browser-unit-roundtrip');
      const tExec2 = performance.now();
      return {
        pwd,
        echo,
        terminal: fixture.currentTerminalSnapshot(),
        timings: {
          bootToReadyMs: Math.round(tReady - t0),
          firstExecMs: Math.round(tExec1 - tReady),
          secondExecMs: Math.round(tExec2 - tExec1),
          totalMs: Math.round(tExec2 - t0),
        },
      };
    } finally {
      if (opened) await fixture.closeSealedWorkbenchFixture();
    }
  }, sealedWorkbenchFixtureUrl);
}

test('criterion 1: harness page is cross-origin isolated and does NOT mount the App', async ({
  page,
}) => {
  const t0 = Date.now();
  await gotoHarness(page);
  const pageLoadMs = Date.now() - t0;

  expect(await page.evaluate(() => globalThis.crossOriginIsolated === true)).toBe(true);
  expect(await page.evaluate(() => typeof SharedArrayBuffer === 'function')).toBe(true);
  const appArtifacts = await page.evaluate(() => ({
    app: document.querySelector('#app') !== null,
    root: document.querySelector('#root') !== null,
    xterm: document.querySelector('.xterm') !== null,
    monaco: document.querySelector('.monaco-editor') !== null,
  }));
  expect(appArtifacts).toEqual({ app: false, root: false, xterm: false, monaco: false });
  console.log(`[browser-unit] harness page load→ready: ${pageLoadMs}ms`);
});

test('criterion 2+3: sealed Workbench boots a real owner; shell exec round-trips', async ({
  page,
}) => {
  await gotoHarness(page);
  const result = await bootWorkbenchAndExec(page);

  expect(result.pwd.exit).toBe(0);
  expect(result.pwd.out.trim().length).toBeGreaterThan(0);
  expect(result.echo.exit).toBe(0);
  expect(result.echo.out).toContain('browser-unit-roundtrip');
  expect(result.terminal.cwd).toBe('/');
  console.log(`[browser-unit] Workbench boot+exec timings: ${JSON.stringify(result.timings)}`);
});

test('overhead probe: second fresh page+Workbench boot (marginal per-test cost)', async ({
  page,
}) => {
  const t0 = Date.now();
  await gotoHarness(page);
  const pageLoadMs = Date.now() - t0;
  const result = await bootWorkbenchAndExec(page);

  expect(result.pwd.exit).toBe(0);
  expect(result.echo.out).toContain('browser-unit-roundtrip');
  console.log(
    `[browser-unit] repeat-boot: pageLoad=${pageLoadMs}ms timings=${JSON.stringify(result.timings)}`,
  );
});
