/**
 * Cold snapshot restore visibility
 * (backlog: playground/cold-restore-progress-visibility).
 *
 * Contract: every path where a baked-snapshot restore runs >250ms shows a
 * user-visible indicator for the WHOLE window [snapshot request start,
 * publication). Slow delivery is injected server-side via the dev-only
 * `rifty-e2e-snapshot-fault` cookie seam (vite.config.ts) — the fetch is
 * SW-mediated, playwright route() cannot reach it.
 *
 * Carrier discrimination (Contract+RED attempt-2 re-cut):
 * - the sampler is an init script — armed at document-start, BEFORE the app
 *   can issue the snapshot request, so the request prefix is observed;
 * - `visible` accepts only RENDERED semantic carriers: the launcher progress
 *   status (`.rf-launcher__progress`, role=status) or the live pill in its
 *   switching state (`.rf-livepill[data-state="switching"]`) — never a bare
 *   launcher, free text, or an unpainted element;
 * - the window ends at PUBLICATION (terminal mounts or the pill leaves
 *   switching into starting/running), not at stamp-file existence;
 * - the slow-window floor asserts the RESPONSE duration (`gz.end - gz.start`)
 *   against the injected stall — an immediate response fails even if local
 *   restore work happens to be slow;
 * - the reopen test interrupts the FIRST materialization mid-restore (tab
 *   reload while the snapshot stalls — the reachable way a persisted catalog
 *   entry exists without an install claim) and reads durable state from the
 *   native replica, never live owner caches.
 */
import { type BrowserContext, type Page, type Request, expect, test } from '@playwright/test';
import type * as NativeObserver from '../browser-unit/fixtures/native-replica-observer.ts';

const CATALOG_PATH = '/.rifty/workbench/playground/catalog.json';
const STAMP_PATH =
  '/.rifty/workbench/v2/projects/scratch/tree/node_modules/.rifty-install-stamp.json';
const OBSERVER_URL = `/@fs${process.cwd()}/tests/browser-unit/fixtures/native-replica-observer.ts`;
const FAULT_COOKIE = 'rifty-e2e-snapshot-fault';
const DELAY_MS = 4_000;
/** First materialization stalls far past the interrupt point. */
const INTERRUPTED_DELAY_MS = 120_000;
const RESPONSE_FLOOR_MS = DELAY_MS - 500;
const BOOT_TIMEOUT = 120_000;

test.skip(({ browserName }) => browserName !== 'chromium', 'chromium-only (project scope)');

interface WindowSample {
  readonly w: number;
  readonly visible: boolean;
  readonly postPublish: boolean;
  readonly markers: string;
}

interface SamplerData {
  readonly samples: readonly WindowSample[];
}

declare global {
  // eslint-disable-next-line no-var
  var __restoreSampler:
    | {
        samples: WindowSample[];
        iv: ReturnType<typeof setInterval>;
      }
    | undefined;
}

/** Armed at document-start on every page of the context (init script). */
const SAMPLER_INIT = `(() => {
  const rendered = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const S = { samples: [], iv: 0 };
  globalThis.__restoreSampler = S;
  S.iv = setInterval(() => {
    const progress = document.querySelector('.rf-launcher__progress');
    const pill = document.querySelector('.rf-livepill');
    const pillState = pill ? pill.getAttribute('data-state') : null;
    const markers = [
      rendered(progress) ? 'launcher-progress' : '',
      rendered(pill) && pillState === 'switching' ? 'pill-switching' : '',
    ].filter(Boolean).join('+');
    const postPublish =
      document.querySelector('.xterm') !== null ||
      (rendered(pill) && (pillState === 'starting' || pillState === 'running'));
    S.samples.push({ w: Date.now(), visible: markers.length > 0, postPublish, markers });
  }, 100);
})();`;

async function armSlowSnapshots(
  context: BrowserContext,
  baseURL: string,
  delayMs = DELAY_MS,
): Promise<void> {
  await context.addCookies([{ name: FAULT_COOKIE, value: `delay:${delayMs}`, url: baseURL }]);
}

/** First snapshot response that STARTED at/after `since` (an aborted earlier fetch never counts). */
function watchSnapshotFetch(
  page: Page,
  since = 0,
): { first: () => { start: number; end: number } | null } {
  let first: { start: number; end: number } | null = null;
  page.on('requestfinished', (req: Request) => {
    if (!/node-modules\.json\.gz/.test(req.url()) || first !== null) return;
    const t = req.timing();
    if (t.startTime < since) return;
    first = { start: Math.round(t.startTime), end: Math.round(t.startTime + t.responseEnd) };
  });
  return { first: () => first };
}

interface PersistedScratch {
  readonly active: string | null;
  readonly starterId: string | null;
  readonly claimed: boolean;
}

/** Durable custody (native replica), not the live owner: active plan + install claim. */
async function persistedScratch(page: Page): Promise<PersistedScratch | null> {
  return page.evaluate(
    async ({ observerUrl, catalogPath, stampPath }) => {
      try {
        const observer = (await import(/* @vite-ignore */ observerUrl)) as typeof NativeObserver;
        const native = await observer.nativeReplicaEntries(await navigator.storage.getDirectory());
        const catalog = native.get(catalogPath);
        if (catalog?.bytes === undefined) return null;
        const parsed = JSON.parse(new TextDecoder().decode(catalog.bytes)) as {
          active?: { kind?: string };
          scratch?: { starterId?: string };
        };
        return {
          active: parsed.active?.kind ?? null,
          starterId: parsed.scratch?.starterId ?? null,
          claimed: native.get(stampPath)?.kind === 'file',
        };
      } catch {
        // A segment compacted under the read: the poll retries.
        return null;
      }
    },
    { observerUrl: OBSERVER_URL, catalogPath: CATALOG_PATH, stampPath: STAMP_PATH },
  );
}

async function waitForPublication(page: Page): Promise<void> {
  await expect
    .poll(
      () => page.evaluate(() => globalThis.__restoreSampler?.samples.some((s) => s.postPublish)),
      { timeout: BOOT_TIMEOUT },
    )
    .toBe(true);
}

async function collectSampler(page: Page): Promise<SamplerData> {
  return page.evaluate(() => {
    const S = globalThis.__restoreSampler;
    if (!S) throw new Error('sampler was never armed');
    clearInterval(S.iv);
    return { samples: S.samples };
  });
}

function assertVisibleWindow(data: SamplerData, gz: { start: number; end: number } | null): void {
  expect(gz, 'snapshot restore must actually re-run (gz fetch observed)').not.toBeNull();
  const { start, end: responseEnd } = gz as { start: number; end: number };
  expect(
    responseEnd - start,
    'response duration must carry the injected stall — seam regressed otherwise',
  ).toBeGreaterThanOrEqual(RESPONSE_FLOOR_MS);
  const firstSample = data.samples[0];
  expect(firstSample, 'sampler produced no samples').toBeDefined();
  expect(
    (firstSample as WindowSample).w,
    'sampler must be armed before the snapshot request starts',
  ).toBeLessThanOrEqual(start);
  const publishAt = data.samples.find((s) => s.postPublish)?.w;
  expect(publishAt, 'project must publish after restore').toBeDefined();
  expect(
    publishAt as number,
    'publication cannot precede the restore response (window covers the whole stall)',
  ).toBeGreaterThanOrEqual(responseEnd);
  const inWindow = data.samples.filter((s) => s.w >= start && s.w < (publishAt as number));
  expect(inWindow.length, 'sampler must cover the window').toBeGreaterThan(5);
  const silent = inWindow.filter((s) => !s.visible);
  expect(
    silent.map((s) => `+${s.w - start}ms`),
    'every sample inside [request start, publication) must show a semantic indicator',
  ).toEqual([]);
}

test.describe('cold snapshot restore visibility', () => {
  test('deep-link cold boot keeps an indicator through a slow restore window', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(BOOT_TIMEOUT + 60_000);
    await context.addInitScript(SAMPLER_INIT);
    await armSlowSnapshots(context, baseURL as string);
    const gz = watchSnapshotFetch(page);
    await page.goto('/?preset=vite8&autorun=1', { waitUntil: 'commit' });
    await waitForPublication(page);
    const data = await collectSampler(page);
    assertVisibleWindow(data, gz.first());
  });

  // Acceptance 2: the no-query reopen (`openActive` in adapters/playground-app.tsx
  // initialize) once ran outside the project-open progress bracket — the whole
  // re-restore window was silent (no pill, no launcher, no terminal).
  test('no-query reopen after an interrupted first restore keeps an indicator through the re-restore', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(BOOT_TIMEOUT * 2 + 60_000);
    await context.addInitScript(SAMPLER_INIT);
    await armSlowSnapshots(context, baseURL as string, INTERRUPTED_DELAY_MS);
    let firstRequested = false;
    page.on('request', (req) => {
      if (/node-modules\.json\.gz/.test(req.url())) firstRequested = true;
    });
    await page.goto('/?preset=vite8&autorun=1', { waitUntil: 'commit' });
    await expect.poll(() => firstRequested, { timeout: BOOT_TIMEOUT }).toBe(true);
    // Interrupt point: the active plan is durable, its install claim is not.
    await expect
      .poll(() => persistedScratch(page), { timeout: BOOT_TIMEOUT })
      .toEqual({ active: 'scratch', starterId: 'vite8', claimed: false });
    await armSlowSnapshots(context, baseURL as string);
    const reopenAt = Date.now();
    const gz = watchSnapshotFetch(page, reopenAt);
    await page.goto('/', { waitUntil: 'commit' });
    await waitForPublication(page);
    const data = await collectSampler(page);
    assertVisibleWindow(data, gz.first());
    // The reopen completes the SAME persisted plan (not a chooser, not another starter).
    await expect
      .poll(() => persistedScratch(page), { timeout: BOOT_TIMEOUT })
      .toEqual({ active: 'scratch', starterId: 'vite8', claimed: true });
  });
});
