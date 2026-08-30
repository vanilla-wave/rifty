/**
 * Header-provenance injection controls (GREEN pins): for EVERY response class
 * the substrate consumes × EACH isolation header independently, a server that
 * injects the header ONLY on actually-consumed destinations
 * (`Sec-Fetch-Dest`-keyed — invisible to ordinary fetch) must be caught by the
 * consumed-response observation the lane preconditions rely on. Kills the
 * provenance lie where an in-page re-fetch sweep certifies "no COOP/COEP"
 * without ever observing the real navigation/Worker/module responses.
 */
import { expect, test } from '@playwright/test';
import {
  CONSUMED_CLASSES,
  assertHeaderlessConsumption,
  captureConsumedResponses,
  summarizeConsumedResponses,
} from './header-provenance.mjs';
import { startNoCoiServer } from './server.mjs';

const port = Number(process.env.RIFTY_NO_COI_PORT ?? 5307) + 4;

for (const header of ['coop', 'coep'] as const) {
  for (const [cls, path] of Object.entries(CONSUMED_CLASSES.worker)) {
    test(`injected ${header} on ${cls} is CAUGHT on the consumed response, invisible to ordinary fetch`, async ({
      browser,
    }) => {
      const server = await startNoCoiServer(port, { inject: { header, path } });
      const page = await browser.newPage();
      try {
        const responses = captureConsumedResponses(page);
        await page.goto(`http://localhost:${port}/index.html`);
        // Consume every class: navigation above, module imports, Worker script.
        // An injected coep on the DOCUMENT legitimately BLOCKS the coep-less
        // worker script (require-corp propagates to dedicated workers) — a
        // blocked load is the other loud detection outcome, so wait for
        // response OR failure, never hang.
        const workerScriptSettled = Promise.race([
          page.waitForResponse((r) => new URL(r.url()).pathname === '/probe-worker.mjs'),
          page.waitForEvent(
            'requestfailed',
            (r) => new URL(r.url()).pathname === '/probe-worker.mjs',
          ),
        ]);
        await page.evaluate(() => {
          (globalThis as { __probeWorker?: Worker }).__probeWorker = new Worker(
            '/probe-worker.mjs?mode=direct',
            { type: 'module' },
          );
        });
        await workerScriptSettled;
        await page.evaluate(async () => {
          (globalThis as { __probeWorker?: Worker }).__probeWorker?.terminate();
          await Promise.all([
            import(/* @vite-ignore */ '/probe-lib.mjs'),
            import(/* @vite-ignore */ '/dist/worker-realm-compat.mjs'),
            import(/* @vite-ignore */ '/dist/util-types.mjs'),
          ]);
        });
        // Ordinary fetch of the SAME path sees a clean response — the old
        // in-page re-fetch sweep was blind to this server.
        const fetched = await page.evaluate(async (p) => {
          const resp = await fetch(p, { cache: 'no-store' });
          return {
            coop: resp.headers.get('cross-origin-opener-policy'),
            coep: resp.headers.get('cross-origin-embedder-policy'),
          };
        }, path);
        expect(fetched).toEqual({ coop: null, coep: null });
        // The ACTUALLY consumed response carries the injected header…
        const consumed = summarizeConsumedResponses(responses, { [cls]: path })[cls];
        expect(consumed, `${cls} consumed`).not.toBeNull();
        expect(consumed?.[header], `${cls} ${header} consumed`).not.toBeNull();
        // …and the lane's detection fails LOUD on it.
        expect(() => assertHeaderlessConsumption(responses, CONSUMED_CLASSES.worker)).toThrow(
          /CONSUMED an isolation header/,
        );
      } finally {
        await page.close();
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    });
  }
}
