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

/**
 * Absent / non-200 detection pins (provenance-lie killer #2): the harness's
 * never-consumed and consumed-non-200 arms must each throw LOUD — deleting
 * either loop leaves every positive and header-injection pin below green while
 * a class the realm never (successfully) loaded silently passes. Swept through
 * every sibling caller class set (page spec / worker spec / evidence driver
 * kernel page — one authority: CONSUMED_CLASSES).
 */
const ABSENT_CONTROLS = [
  // Navigation alone consumes ONLY the document — the named class stays absent.
  { caller: 'page', classes: CONSUMED_CLASSES.page, missing: 'probeModule' },
  { caller: 'worker', classes: CONSUMED_CLASSES.worker, missing: 'workerScript' },
  { caller: 'kernelDriver', classes: CONSUMED_CLASSES.kernelDriver, missing: 'kernelPublic' },
] as const;

for (const { caller, classes, missing } of ABSENT_CONTROLS) {
  test(`absent class (${caller} caller set): a never-consumed expected class throws loud`, async ({
    browser,
  }) => {
    const server = await startNoCoiServer(port);
    const page = await browser.newPage();
    try {
      const responses = captureConsumedResponses(page);
      await page.goto(`http://localhost:${port}/index.html`);
      expect(() => assertHeaderlessConsumption(responses, classes)).toThrow(
        new RegExp(`never consumed ${missing} `),
      );
    } finally {
      await page.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
}

const NON_200_CONTROLS = [
  {
    caller: 'page',
    classes: CONSUMED_CLASSES.page,
    cls: 'probeModule',
    path: '/probe-lib.mjs',
    consume: async (page: import('@playwright/test').Page, path: string) => {
      await page.evaluate(
        (p) => import(/* @vite-ignore */ p).catch((err: unknown) => String(err)),
        path,
      );
    },
  },
  {
    caller: 'worker',
    classes: CONSUMED_CLASSES.worker,
    cls: 'workerScript',
    path: '/probe-worker.mjs',
    consume: async (page: import('@playwright/test').Page, path: string) => {
      const settled = page.waitForResponse((r) => new URL(r.url()).pathname === path);
      await page.evaluate((p) => {
        new Worker(p, { type: 'module' });
      }, path);
      await settled;
    },
  },
  {
    caller: 'kernelDriver',
    classes: CONSUMED_CLASSES.kernelDriver,
    cls: 'kernelPublic',
    path: '/dist/kernel-public.mjs',
    consume: async (page: import('@playwright/test').Page, path: string) => {
      await page.evaluate(
        (p) => import(/* @vite-ignore */ p).catch((err: unknown) => String(err)),
        path,
      );
    },
  },
] as const;

for (const { caller, classes, cls, path, consume } of NON_200_CONTROLS) {
  test(`non-200 class (${caller} caller set): a consumed non-200 expected class throws loud`, async ({
    browser,
  }) => {
    // The server serves the REAL class path with 404 — the response IS consumed
    // (recorded with its status), so only the non-200 arm can catch it.
    const server = await startNoCoiServer(port, { inject: { status: 404, path } });
    const page = await browser.newPage();
    try {
      const responses = captureConsumedResponses(page);
      await page.goto(`http://localhost:${port}/index.html`);
      await consume(page, path);
      expect(() => assertHeaderlessConsumption(responses, classes)).toThrow(
        new RegExp(`consumed ${cls} .* only non-200 \\(status 404\\)`),
      );
    } finally {
      await page.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
}

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
