import { chromium } from '@playwright/test';

/**
 * One throwaway page load before the suite. The FIRST hit on a cold `pnpm dev`
 * pays vite's dep-optimize, which can RELOAD the page mid-flight (dev-server
 * artifact; a prod build never does this) — landing exactly on a spec's starter
 * pick and silently losing it (the reloaded app re-opens the chooser, the spec
 * waits for a boot that never started). Absorb the optimize cycle here so spec
 * #1 is not the warmup; on a warm cache this costs one fast page load.
 */
export default async function globalSetup(): Promise<void> {
  const port = Number(process.env.RIFTY_PLAYGROUND_PORT ?? 5273);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}/`, { timeout: 120_000 });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 60_000,
    });
    // Interactive marker, then a beat for a dep-optimize reload to land+settle.
    await page
      .waitForSelector('[data-testid="launcher"], [data-testid="terminal"]', { timeout: 60_000 })
      .catch(() => {});
    await page.waitForTimeout(3_000);
  } finally {
    await browser.close();
  }
}
