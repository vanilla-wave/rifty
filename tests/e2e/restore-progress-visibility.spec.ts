/**
 * Cold snapshot restore visibility
 * (backlog: playground/cold-restore-progress-visibility).
 *
 * Contract: every path where a baked-snapshot restore runs >250ms shows a
 * user-visible indicator for the WHOLE window (snapshot request → trusted
 * stamp). Slow delivery is injected server-side via the dev-only
 * `rifty-e2e-snapshot-fault` cookie seam (vite.config.ts) — the fetch is
 * SW-mediated, playwright route() cannot reach it.
 *
 * Window sampling: an in-page 100ms sampler records rendered-text indicator
 * markers + OPFS stamp appearance (wall-clocked); the gz request wall times
 * come from playwright network events. A single flash cannot pass: every
 * sample inside the window must carry an indicator, and the window must
 * actually be slow (≥ SLOW_FLOOR_MS) or the seam itself regressed.
 */
import { type BrowserContext, type Page, type Request, expect, test } from '@playwright/test';

const STAMP_PATH =
  '/.rifty/workbench/v1/projects/scratch/tree/node_modules/.rifty-install-stamp.json';
const FAULT_COOKIE = 'rifty-e2e-snapshot-fault';
const DELAY_MS = 4_000;
const SLOW_FLOOR_MS = 3_000;
const BOOT_TIMEOUT = 120_000;

interface WindowSample {
  readonly w: number;
  readonly visible: boolean;
  /** Publish already happened: terminal mounted or run pill left SWITCHING. */
  readonly postPublish: boolean;
  readonly markers: string;
}

interface SamplerData {
  readonly samples: readonly WindowSample[];
  readonly stampAt: number | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __restoreSampler:
    | {
        samples: WindowSample[];
        stampAt: number | null;
        iv: ReturnType<typeof setInterval>;
        opfsIv: ReturnType<typeof setInterval>;
      }
    | undefined;
}

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

async function startSampler(page: Page): Promise<void> {
  await page.evaluate((stampPath: string) => {
    const S: NonNullable<typeof globalThis.__restoreSampler> = {
      samples: [],
      stampAt: null,
      iv: 0 as unknown as ReturnType<typeof setInterval>,
      opfsIv: 0 as unknown as ReturnType<typeof setInterval>,
    };
    globalThis.__restoreSampler = S;
    const probe = (): void => {
      const text = document.body ? document.body.innerText : '';
      const markers = [
        text.includes('Preparing instant project') ? 'preparing' : '',
        /SWITCHING|switching/.test(text) ? 'switching' : '',
        /restor/i.test(text) ? 'restoring' : '',
        document.querySelector('[data-testid="launcher"]') ? 'launcher' : '',
      ]
        .filter(Boolean)
        .join('+');
      const postPublish =
        document.querySelector('.xterm') !== null || /STARTING|RUNNING|LIVE :/.test(text);
      S.samples.push({ w: Date.now(), visible: markers.length > 0, postPublish, markers });
    };
    S.iv = setInterval(probe, 100);
    probe();
    const checkStamp = async (): Promise<void> => {
      if (S.stampAt !== null) return;
      try {
        const segs = stampPath.split('/').filter(Boolean);
        let dir = await navigator.storage.getDirectory();
        for (const seg of segs.slice(0, -1)) dir = await dir.getDirectoryHandle(seg);
        await dir.getFileHandle(segs[segs.length - 1] as string);
        S.stampAt = Date.now();
      } catch {
        // stamp not there yet
      }
    };
    S.opfsIv = setInterval(() => void checkStamp(), 100);
    void checkStamp();
  }, STAMP_PATH);
}

async function collectSampler(page: Page): Promise<SamplerData> {
  return page.evaluate(() => {
    const S = globalThis.__restoreSampler;
    if (!S) throw new Error('sampler was never started');
    clearInterval(S.iv);
    clearInterval(S.opfsIv);
    return { samples: S.samples, stampAt: S.stampAt };
  });
}

async function waitForTrustedBoot(page: Page): Promise<void> {
  // Dev-server ready line = restore finished, project published, autorun ran.
  await expect
    .poll(() => page.evaluate(() => document.body.innerText.includes('Local:')), {
      timeout: BOOT_TIMEOUT,
    })
    .toBe(true);
  await expect
    .poll(
      () =>
        page.evaluate(async (stampPath: string) => {
          try {
            const segs = stampPath.split('/').filter(Boolean);
            let dir = await navigator.storage.getDirectory();
            for (const seg of segs.slice(0, -1)) dir = await dir.getDirectoryHandle(seg);
            await dir.getFileHandle(segs[segs.length - 1] as string);
            return true;
          } catch {
            return false;
          }
        }, STAMP_PATH),
      { timeout: BOOT_TIMEOUT },
    )
    .toBe(true);
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
  expect(data.stampAt, 'restore must complete (stamp appears)').not.toBeNull();
  const start = (gz as { start: number }).start;
  const stampAt = data.stampAt as number;
  expect(stampAt - start, 'window must be slow — seam regressed otherwise').toBeGreaterThanOrEqual(
    SLOW_FLOOR_MS,
  );
  // The obligation ends at publish; sampling/stamp-poll granularity can lag it,
  // so trim the window at the first post-publish sample (publish-after-restore
  // guarantees it never precedes restore completion).
  const firstPostPublish = data.samples.find((s) => s.postPublish && s.w >= start)?.w;
  const end = firstPostPublish === undefined ? stampAt : Math.min(stampAt, firstPostPublish);
  const inWindow = data.samples.filter((s) => s.w >= start && s.w < end);
  expect(inWindow.length, 'sampler must cover the window').toBeGreaterThan(5);
  const silent = inWindow.filter((s) => !s.visible);
  expect(
    silent.map((s) => `+${s.w - start}ms`),
    'every sample inside the restore window must show an indicator',
  ).toEqual([]);
}

test.describe('cold snapshot restore visibility', () => {
  test('deep-link cold boot keeps an indicator through a slow restore window', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(BOOT_TIMEOUT + 60_000);
    await armSlowSnapshots(context, baseURL as string);
    const gz = watchSnapshotFetch(page);
    await page.goto('/?preset=vite8&autorun=1', { waitUntil: 'domcontentloaded' });
    await startSampler(page);
    await expect
      .poll(() => page.evaluate(() => globalThis.__restoreSampler?.stampAt !== null), {
        timeout: BOOT_TIMEOUT,
      })
      .toBe(true);
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
    await page.goto('/?preset=vite8&autorun=1', { waitUntil: 'domcontentloaded' });
    await waitForTrustedBoot(page);
    await evictNodeModules(page);
    await armSlowSnapshots(context, baseURL as string);
    const gz = watchSnapshotFetch(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await startSampler(page);
    await expect
      .poll(() => page.evaluate(() => globalThis.__restoreSampler?.stampAt !== null), {
        timeout: BOOT_TIMEOUT,
      })
      .toBe(true);
    const data = await collectSampler(page);
    assertVisibleWindow(data, gz.first());
  });
});
