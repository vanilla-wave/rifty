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
 * - the reopen test writes an OPFS sentinel into the persisted tree and
 *   requires it to survive: a reopen that reseeds a fresh Scratch fails.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, type Page, type Request, expect, test } from '@playwright/test';

const STAMP_PATH =
  '/.rifty/workbench/v1/projects/scratch/tree/node_modules/.rifty-install-stamp.json';
const SENTINEL_PATH = '/.rifty/workbench/v1/projects/scratch/tree/e2e-reopen-sentinel.txt';
const FAULT_COOKIE = 'rifty-e2e-snapshot-fault';
const DELAY_MS = 4_000;
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

async function armSlowSnapshots(context: BrowserContext, baseURL: string): Promise<void> {
  await context.addCookies([{ name: FAULT_COOKIE, value: `delay:${DELAY_MS}`, url: baseURL }]);
}

function watchSnapshotFetch(page: Page): { first: () => { start: number; end: number } | null } {
  let first: { start: number; end: number } | null = null;
  page.on('requestfinished', (req: Request) => {
    if (!/node-modules\.json\.gz/.test(req.url()) || first !== null) return;
    const t = req.timing();
    first = { start: Math.round(t.startTime), end: Math.round(t.startTime + t.responseEnd) };
  });
  return { first: () => first };
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

async function opfsFileExists(page: Page, path: string): Promise<boolean> {
  return page.evaluate(async (target: string) => {
    try {
      const segs = target.split('/').filter(Boolean);
      let dir = await navigator.storage.getDirectory();
      for (const seg of segs.slice(0, -1)) dir = await dir.getDirectoryHandle(seg);
      await dir.getFileHandle(segs[segs.length - 1] as string);
      return true;
    } catch {
      return false;
    }
  }, path);
}

async function waitForTrustedBoot(page: Page): Promise<void> {
  // Dev-server ready line = restore finished, project published, autorun ran.
  await expect
    .poll(() => page.evaluate(() => document.body.innerText.includes('Local:')), {
      timeout: BOOT_TIMEOUT,
    })
    .toBe(true);
  // Stamp presence = restore writes drained; safe to mutate OPFS afterwards.
  await expect.poll(() => opfsFileExists(page, STAMP_PATH), { timeout: BOOT_TIMEOUT }).toBe(true);
}

async function writeSentinel(page: Page): Promise<void> {
  await page.evaluate(async (target: string) => {
    const segs = target.split('/').filter(Boolean);
    let dir = await navigator.storage.getDirectory();
    for (const seg of segs.slice(0, -1)) dir = await dir.getDirectoryHandle(seg);
    const file = await dir.getFileHandle(segs[segs.length - 1] as string, { create: true });
    const writable = await file.createWritable();
    await writable.write('persisted-reopen-sentinel');
    await writable.close();
  }, SENTINEL_PATH);
}

async function evictNodeModules(page: Page): Promise<void> {
  await page.evaluate(async (stampPath: string) => {
    const segs = stampPath.split('/').filter(Boolean);
    let dir = await navigator.storage.getDirectory();
    for (const seg of segs.slice(0, -2)) dir = await dir.getDirectoryHandle(seg);
    await dir.removeEntry(segs[segs.length - 2] as string, { recursive: true });
  }, STAMP_PATH);
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

  // RED (backlog: playground/cold-restore-progress-visibility Acceptance 2):
  // the no-query persisted reopen goes through `openActive`
  // (playground-app.tsx) without `projectBusy`, so today the whole re-restore
  // window is silent — no pill, no launcher, no terminal yet.
  test('no-query reload after node_modules eviction keeps an indicator through the restore', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(BOOT_TIMEOUT * 2 + 60_000);
    await context.addInitScript(SAMPLER_INIT);
    await page.goto('/?preset=vite8&autorun=1', { waitUntil: 'domcontentloaded' });
    await waitForTrustedBoot(page);
    await writeSentinel(page);
    await evictNodeModules(page);
    await armSlowSnapshots(context, baseURL as string);
    const gz = watchSnapshotFetch(page);
    await page.goto('/', { waitUntil: 'commit' });
    await waitForPublication(page);
    const data = await collectSampler(page);
    assertVisibleWindow(data, gz.first());
    // The reopened project must BE the persisted one: reseeding a fresh
    // Scratch (which would also repaint progress) loses the user's tree.
    expect(
      await opfsFileExists(page, SENTINEL_PATH),
      'persisted tree must survive the reopen',
    ).toBe(true);
  });

  // RED (backlog: playground/cold-restore-progress-visibility Acceptance 3):
  // the obligation IS source removal — the honest carrier is source shape.
  // #167 left `beforeRun` as tests-only machinery in pty-server and
  // `onSettledAfterSlow` as a tests-only seam in slow-progress; a UI-only fix
  // that leaves them intact must fail here.
  test('dead #167 machinery is removed', () => {
    const source = (rel: string): string =>
      readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
    expect(
      source('packages/workbench/src/workers/pty-server.ts'),
      'pty-server must not carry the prod-unconsumed beforeRun dep/gate',
    ).not.toContain('beforeRun');
    const slowProgress = source('apps/playground/src/glue/slow-progress.ts');
    expect(
      slowProgress,
      'slow-progress must keep only prod-consumed options (delayMs, onSlow)',
    ).not.toContain('onSettledAfterSlow');
    expect(
      slowProgress,
      'the tests-only `now` clock seam must go with its only consumer',
    ).not.toMatch(/\bnow\??:/);
  });
});
