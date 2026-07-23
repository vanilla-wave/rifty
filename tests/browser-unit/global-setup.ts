import { chromium } from '@playwright/test';

/**
 * Browser-unit lane globalSetup (ADR-0196):
 * 1. Measures dev-server cold start (config-eval → server-reachable; T0 is
 *    stamped in playwright.browser-unit.config.ts at module eval).
 * 2. One throwaway harness load + sealed Workbench boot, absorbing the cold
 *    dev server's dep-optimize RELOAD (dev-only artifact) so the first spec
 *    never loses its evaluate() execution context mid-import.
 * Logs raw timings to stdout (cold-start visibility in CI logs).
 */
export default async function globalSetup(): Promise<void> {
  const t0 = Number(process.env.RIFTY_BROWSER_UNIT_T0 ?? Date.now());
  const serverColdStartMs = Date.now() - t0;
  const port = Number(process.env.RIFTY_PLAYGROUND_PORT ?? 5299);
  const workspacePath = process.cwd().replaceAll('\\', '/');
  const fixtureUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/sealed-playground-workbench.ts`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const tLoad = Date.now();
    await page.goto(`http://localhost:${port}/unit-harness.html`, { timeout: 60_000 });
    await page.waitForSelector('#browser-unit-harness[data-status="ready"]', { timeout: 30_000 });
    const coldPageLoadMs = Date.now() - tLoad;

    // Cold transform of the sealed Workbench graph + ONE full owner boot. The
    // page-side import alone is not enough: the owner worker fetches its own
    // module graph through the dev server, and a dep discovered there triggers
    // a dep-optimize full-reload of the page (dev-only artifact) — absorb it
    // here (retry once after the reload settles) so specs never lose their
    // evaluate() execution context mid-boot.
    const warmOwnerBoot = () =>
      page.evaluate(async (sealedFixtureUrl) => {
        const fixture = await import(/* @vite-ignore */ sealedFixtureUrl);
        await fixture.openSealedWorkbenchFixture({
          workspaceId: 'browser-unit-warmup',
          template: 'hidden-empty',
          persistence: 'ephemeral',
        });
        await fixture.closeSealedWorkbenchFixture();
      }, fixtureUrl);
    const tImport = Date.now();
    let optimizeReloadObserved = false;
    try {
      await warmOwnerBoot();
    } catch (err) {
      optimizeReloadObserved = true;
      console.log(
        `[browser-unit setup] warm owner boot interrupted (dep-optimize reload): ${
          err instanceof Error ? err.message.split('\n')[0] : String(err)
        }`,
      );
      await page.waitForLoadState('load');
      await page.waitForSelector('#browser-unit-harness[data-status="ready"]', {
        timeout: 30_000,
      });
      await warmOwnerBoot();
    }
    const coldImportMs = Date.now() - tImport;
    // A beat for any trailing optimize reload to land before specs start.
    await page.waitForTimeout(1_500);

    const timings = JSON.stringify({
      serverColdStartMs,
      coldPageLoadMs,
      coldImportPlusWorkbenchBootMs: coldImportMs,
      optimizeReloadObserved,
    });
    console.log(`[browser-unit setup] timings: ${timings}`);
  } finally {
    await browser.close();
  }
}
