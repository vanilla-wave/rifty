/**
 * Header-provenance detection pins (GREEN): the consumed-response observation
 * the lane preconditions rely on (`header-provenance.mjs`) must catch three
 * adversarial servers an in-page re-fetch sweep is blind to:
 * - destination-conditional header INJECTION (`Sec-Fetch-Dest`-keyed — the
 *   real navigation/Worker/module response carries COOP/COEP, every ordinary
 *   fetch stays clean), swept per unique consumed path × each header;
 * - a class the realm NEVER consumed while an ordinary `fetch(path)` of every
 *   same path returns 200 (pathname-only matching passes this run whole);
 * - a destination-only non-200 (the REAL consumer is served 404, the ordinary
 *   same-path fetch 200), swept across document / worker / module destination
 *   kinds and the page / worker / kernelDriver caller class sets.
 * Absent and non-200 arms are pinned by EXACT mutually exclusive messages — a
 * combined diagnostic satisfying two lazy regexes fails the exact compare.
 */
import { expect, test } from '@playwright/test';
import {
  CONSUMED_CLASSES,
  type ConsumedClass,
  type ConsumedResponse,
  assertHeaderlessConsumption,
  captureConsumedResponses,
} from './header-provenance.mjs';
import { startNoCoiServer } from './server.mjs';

const port = Number(process.env.RIFTY_NO_COI_PORT ?? 5307) + 4;

function thrownMessage(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error('expected assertHeaderlessConsumption to throw');
}

test('CONSUMED_CLASSES: exact class→(path,dest) identity per caller set — an aliased or dropped class fails here, never as a silently shrunk green sweep', () => {
  // Exact identity AND count: aliasing two class names onto one (path, dest)
  // keeps every green sweep's case count intact — this pin fails instead.
  expect(CONSUMED_CLASSES).toEqual({
    page: {
      document: { path: '/index.html', dest: 'document' },
      probeModule: { path: '/probe-lib.mjs', dest: 'script' },
      builtShim: { path: '/dist/worker-realm-compat.mjs', dest: 'script' },
      builtUtilTypes: { path: '/dist/util-types.mjs', dest: 'script' },
    },
    worker: {
      document: { path: '/index.html', dest: 'document' },
      workerScript: { path: '/probe-worker.mjs', dest: 'worker' },
      probeModule: { path: '/probe-lib.mjs', dest: 'worker' },
      builtShim: { path: '/dist/worker-realm-compat.mjs', dest: 'script' },
      builtUtilTypes: { path: '/dist/util-types.mjs', dest: 'script' },
    },
    kernelDriver: {
      document: { path: '/index.html', dest: 'document' },
      kernelPublic: { path: '/dist/kernel-public.mjs', dest: 'script' },
      kernelStdioDrain: { path: '/dist/kernel-stdio-drain.mjs', dest: 'script' },
    },
  });
  for (const [caller, classes] of Object.entries(CONSUMED_CLASSES)) {
    const keys = Object.values(classes).map((c) => `${c.path}|${c.dest}`);
    expect(new Set(keys).size, `${caller} unique (path, dest)`).toBe(keys.length);
  }
});

/**
 * EVERY-class-position sweep (pure records): the browser controls below each
 * fail their caller's FIRST unsatisfied class, so an implementation validating
 * only the document plus the first non-document class passes them all while a
 * TAIL class (builtUtilTypes, kernelStdioDrain, …) goes absent or 404
 * unnoticed. Per caller set × per class position × {absent, non-200}, with the
 * shadowing ordinary-fetch row present, the exact per-class message must name
 * exactly that class — and the full-success record set must pass whole.
 */
const CLASS_POSITION_COUNTS = { page: 4, worker: 5, kernelDriver: 3 } as const;

for (const [caller, classes] of Object.entries(CONSUMED_CLASSES) as [
  keyof typeof CONSUMED_CLASSES,
  Record<string, ConsumedClass>,
][]) {
  test(`every class position (${caller} caller set): absent and non-200 arms throw the exact per-class message at EVERY position, full set passes`, () => {
    const names = Object.keys(classes);
    expect(names.length, `${caller} declared positions`).toBe(CLASS_POSITION_COUNTS[caller]);
    const record = (
      cls: ConsumedClass,
      over: Partial<ConsumedResponse> = {},
    ): ConsumedResponse => ({
      pathname: cls.path,
      status: 200,
      dest: cls.dest,
      coop: null,
      coep: null,
      ...over,
    });
    const clsOf = (n: string): ConsumedClass => classes[n] as ConsumedClass;
    const fullSet = names.map((n) => record(clsOf(n)));
    expect(() => assertHeaderlessConsumption(fullSet, classes)).not.toThrow();
    for (const target of names) {
      const cls = clsOf(target);
      const others = names.filter((n) => n !== target).map((n) => record(clsOf(n)));
      // Shadow row: ordinary fetch of the same path — 200, destination `empty`.
      const shadow = record(cls, { dest: 'empty' });
      expect(
        thrownMessage(() => assertHeaderlessConsumption([...others, shadow], classes)),
        `${caller} ${target} absent`,
      ).toBe(
        `no-COI substrate never consumed ${target} (${cls.path} as ${cls.dest}) — header provenance unproven`,
      );
      expect(
        thrownMessage(() =>
          assertHeaderlessConsumption([...others, record(cls, { status: 404 }), shadow], classes),
        ),
        `${caller} ${target} non-200`,
      ).toBe(
        `no-COI substrate consumed ${target} (${cls.path} as ${cls.dest}) only non-200 (status 404) — header provenance unproven`,
      );
    }
  });
}

/**
 * Absent-class detection (per caller class set): the realm consumes ONLY the
 * navigation, then ordinary-fetches EVERY other class path (status 200,
 * destination `empty`). A pathname-only consumption match passes this run
 * WHOLE; the dest-aware absent arm must throw its EXACT message for the first
 * unconsumed class — and that message never matches the non-200 arm.
 */
const ABSENT_CONTROLS = [
  {
    caller: 'page',
    classes: CONSUMED_CLASSES.page,
    fetchPaths: ['/probe-lib.mjs', '/dist/worker-realm-compat.mjs', '/dist/util-types.mjs'],
    message:
      'no-COI substrate never consumed probeModule (/probe-lib.mjs as script) — ' +
      'header provenance unproven',
  },
  {
    caller: 'worker',
    classes: CONSUMED_CLASSES.worker,
    fetchPaths: [
      '/probe-worker.mjs',
      '/probe-lib.mjs',
      '/dist/worker-realm-compat.mjs',
      '/dist/util-types.mjs',
    ],
    message:
      'no-COI substrate never consumed workerScript (/probe-worker.mjs as worker) — ' +
      'header provenance unproven',
  },
  {
    caller: 'kernelDriver',
    classes: CONSUMED_CLASSES.kernelDriver,
    fetchPaths: ['/dist/kernel-public.mjs', '/dist/kernel-stdio-drain.mjs'],
    message:
      'no-COI substrate never consumed kernelPublic (/dist/kernel-public.mjs as script) — ' +
      'header provenance unproven',
  },
] as const;

for (const { caller, classes, fetchPaths, message } of ABSENT_CONTROLS) {
  test(`absent class (${caller} caller set): never-consumed real destination + clean same-path fetches throws the exact absent message`, async ({
    browser,
  }) => {
    const server = await startNoCoiServer(port);
    const page = await browser.newPage();
    try {
      const capture = captureConsumedResponses(page);
      await page.goto(`http://localhost:${port}/index.html`);
      // Clean 200 fetch of EVERY non-document class path — satisfies a
      // pathname-only matcher, never a (path, dest) class. Each status is
      // asserted 200 PER PATH: without it a tail 404 (missing fixture) makes
      // the control's "clean same-path fetch" premise a silent lie.
      const fetchStatuses = await page.evaluate(
        async (paths) => {
          const out: Record<string, number> = {};
          for (const p of paths) out[p] = (await fetch(p, { cache: 'no-store' })).status;
          return out;
        },
        fetchPaths as unknown as string[],
      );
      for (const p of fetchPaths) expect(fetchStatuses[p], `${caller} clean fetch ${p}`).toBe(200);
      const responses = await capture.settle();
      const thrown = thrownMessage(() => assertHeaderlessConsumption(responses, classes));
      expect(thrown).toBe(message);
      // Mutually exclusive arms: the absent diagnostic never doubles as the
      // non-200 one (a combined message would satisfy two lazy regexes).
      expect(thrown).not.toMatch(/only non-200/);
    } finally {
      await page.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
}

/**
 * Destination-only non-200 detection, swept across destination KINDS
 * (document / worker / module) and caller class sets: the server 404s ONLY the
 * real destination (`Sec-Fetch-Dest`-keyed status inject); the response IS
 * consumed and recorded, then an ordinary fetch of the SAME path returns 200.
 * A pathname-or-status-only match sees the 200 fetch row and passes; the
 * dest-aware non-200 arm must throw its EXACT message.
 */
const NON_200_CONTROLS = [
  {
    caller: 'page',
    kind: 'document',
    classes: CONSUMED_CLASSES.page,
    inject: { status: 404, path: '/index.html', dest: 'document' },
    consume: async () => {}, // the navigation itself is the consumption
    message:
      'no-COI substrate consumed document (/index.html as document) only non-200 ' +
      '(status 404) — header provenance unproven',
  },
  {
    caller: 'page',
    kind: 'module',
    classes: CONSUMED_CLASSES.page,
    inject: { status: 404, path: '/probe-lib.mjs', dest: 'script' },
    consume: async (page: import('@playwright/test').Page) => {
      await page.evaluate(
        (p) => import(/* @vite-ignore */ p).catch((err: unknown) => String(err)),
        '/probe-lib.mjs',
      );
    },
    message:
      'no-COI substrate consumed probeModule (/probe-lib.mjs as script) only non-200 ' +
      '(status 404) — header provenance unproven',
  },
  {
    caller: 'worker',
    kind: 'worker',
    classes: CONSUMED_CLASSES.worker,
    inject: { status: 404, path: '/probe-worker.mjs', dest: 'worker' },
    consume: async (page: import('@playwright/test').Page) => {
      const settled = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/probe-worker.mjs',
      );
      await page.evaluate(() => {
        new Worker('/probe-worker.mjs', { type: 'module' });
      });
      await settled;
    },
    message:
      'no-COI substrate consumed workerScript (/probe-worker.mjs as worker) only non-200 ' +
      '(status 404) — header provenance unproven',
  },
  {
    caller: 'kernelDriver',
    kind: 'module',
    classes: CONSUMED_CLASSES.kernelDriver,
    inject: { status: 404, path: '/dist/kernel-public.mjs', dest: 'script' },
    consume: async (page: import('@playwright/test').Page) => {
      await page.evaluate(
        (p) => import(/* @vite-ignore */ p).catch((err: unknown) => String(err)),
        '/dist/kernel-public.mjs',
      );
    },
    message:
      'no-COI substrate consumed kernelPublic (/dist/kernel-public.mjs as script) only non-200 ' +
      '(status 404) — header provenance unproven',
  },
] as const;

for (const { caller, kind, classes, inject, consume, message } of NON_200_CONTROLS) {
  test(`non-200 class (${caller} caller set, ${kind} destination): destination-only 404 + clean same-path fetch throws the exact non-200 message`, async ({
    browser,
  }) => {
    const server = await startNoCoiServer(port, { inject });
    const page = await browser.newPage();
    try {
      const capture = captureConsumedResponses(page);
      await page.goto(`http://localhost:${port}/index.html`);
      await consume(page);
      // Ordinary fetch of the SAME path: destination `empty` is not injected —
      // 200, headerless — and must NOT satisfy the class it shadows.
      const fetchedStatus = await page.evaluate(
        async (p) => (await fetch(p, { cache: 'no-store' })).status,
        inject.path,
      );
      expect(fetchedStatus).toBe(200);
      const responses = await capture.settle();
      const thrown = thrownMessage(() => assertHeaderlessConsumption(responses, classes));
      expect(thrown).toBe(message);
      expect(thrown).not.toMatch(/never consumed/);
    } finally {
      await page.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
}

/**
 * Header-injection controls: for EVERY unique consumed path across ALL caller
 * class sets × EACH isolation header independently, a server injecting the
 * header ONLY on actually-consumed destinations must be caught on the consumed
 * response while an ordinary fetch of the same path sees none.
 */
const INJECTION_PATHS = [
  '/index.html',
  '/probe-worker.mjs',
  '/probe-lib.mjs',
  '/dist/worker-realm-compat.mjs',
  '/dist/util-types.mjs',
  '/dist/kernel-public.mjs',
  '/dist/kernel-stdio-drain.mjs',
] as const;

const INJECTED_VALUE = { coop: 'same-origin', coep: 'require-corp' } as const;

for (const header of ['coop', 'coep'] as const) {
  for (const path of INJECTION_PATHS) {
    test(`injected ${header} on ${path} is CAUGHT on the consumed response, invisible to ordinary fetch`, async ({
      browser,
    }) => {
      const server = await startNoCoiServer(port, { inject: { header, path } });
      const page = await browser.newPage();
      try {
        const capture = captureConsumedResponses(page);
        await page.goto(`http://localhost:${port}/index.html`);
        // Consume every class across all caller sets: navigation above, the
        // dedicated Worker (its static probe-lib import rides along), page
        // dynamic imports of the built + kernel bundles.
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
        await page.evaluate(
          async (modulePaths) => {
            (globalThis as { __probeWorker?: Worker }).__probeWorker?.terminate();
            await Promise.all(modulePaths.map((p) => import(/* @vite-ignore */ p)));
          },
          [
            '/probe-lib.mjs',
            '/dist/worker-realm-compat.mjs',
            '/dist/util-types.mjs',
            '/dist/kernel-public.mjs',
            '/dist/kernel-stdio-drain.mjs',
          ],
        );
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
        const responses = await capture.settle();
        // The ACTUALLY consumed response carries the injected header…
        const consumed = responses.find(
          (r) => r.pathname === path && r.dest !== null && r.dest !== 'empty',
        );
        expect(consumed, `${path} consumed`).toBeDefined();
        expect(consumed?.[header], `${path} ${header} consumed`).toBe(INJECTED_VALUE[header]);
        // …and the lane's detection fails LOUD with the exact header message
        // (the injected response is the only header carrier).
        const expectedMessage =
          `no-COI substrate CONSUMED an isolation header: ${path} ` +
          `coop=${header === 'coop' ? INJECTED_VALUE.coop : 'null'} ` +
          `coep=${header === 'coep' ? INJECTED_VALUE.coep : 'null'}`;
        expect(
          thrownMessage(() => assertHeaderlessConsumption(responses, CONSUMED_CLASSES.worker)),
        ).toBe(expectedMessage);
      } finally {
        await page.close();
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    });
  }
}
