import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';
import { pinPublicEsbuild0280 } from './pinned-public-esbuild.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const acceptanceFixtureUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/workbench-cutover-browser-acceptance.ts`;
const capabilityCloseEntryUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/runtime-asset-vite-close-entry.ts`;
const vite8EmptyEntryUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/runtime-asset-vite8-empty-entry.ts`;

interface SerializedProgress {
  readonly phase: string;
  readonly assetCount?: number;
  readonly storageClass?: string;
}

interface SerializedCommandProof {
  readonly exit: { readonly code: number | null; readonly signal: string | null };
  readonly output: string;
}

interface SerializedModeProof {
  readonly progress: readonly SerializedProgress[];
  readonly devHtml: string;
  readonly devOutput: string;
  readonly build: SerializedCommandProof;
  readonly previewHtml: string;
  readonly previewOutput: string;
}

interface SerializedFaultProof {
  readonly failureName: string;
  readonly failureMessage: string;
  readonly output: string;
  readonly exit: { readonly code: number | null; readonly signal: string | null };
  readonly previewStatus: number;
  readonly previewBody: string;
}

test('durable Vite 7 survives cache eviction and registry-offline same-project reopen', async ({
  page,
  context,
}) => {
  test.setTimeout(600_000);
  await gotoHarness(page);
  const pinnedEsbuildRequests = await pinPublicEsbuild0280(page);

  const ownerWorkers: string[] = [];
  const closedOwnerWorkers: string[] = [];
  page.on('worker', (worker) => {
    ownerWorkers.push(worker.url());
    worker.on('close', () => closedOwnerWorkers.push(worker.url()));
  });

  const cold = (await page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    return fixture.runDurableVite7('cold');
  }, acceptanceFixtureUrl)) as SerializedModeProof;
  expect(cold.progress.map((entry) => entry.phase)).toEqual([
    'cache-check',
    'fetch',
    'verify',
    'persist',
    'ready',
  ]);
  expect(cold.progress.at(-1)).toMatchObject({
    phase: 'ready',
    assetCount: 1,
    storageClass: expect.stringMatching(/^opfs-/u),
  });

  await expect.poll(() => closedOwnerWorkers.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');

  const offlineSourceRequests: string[] = [];
  await page.route('**/npm-registry/**', async (route) => {
    offlineSourceRequests.push(route.request().url());
    await route.abort('internetdisconnected');
  });
  const reopened = (await page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    return fixture.runDurableVite7('reopen');
  }, acceptanceFixtureUrl)) as SerializedModeProof;

  expect(reopened.progress.map((entry) => entry.phase)).toEqual(['cache-check', 'verify', 'ready']);
  expect(reopened.progress.at(-1)).toMatchObject({
    phase: 'ready',
    assetCount: 1,
    storageClass: expect.stringMatching(/^opfs-/u),
  });
  expect(offlineSourceRequests).toEqual([]);
  expect(ownerWorkers.length).toBeGreaterThanOrEqual(2);
  expect(reopened.devHtml).toContain('/src/main.js');
  expect(reopened.build.exit).toEqual({ code: 0, signal: null });
  expect(reopened.previewHtml).toContain('/assets/');
  expect(pinnedEsbuildRequests).toHaveLength(1);
});

test('default Vite 8 real Workers run dev/build/preview with an empty asset plan', async ({
  page,
}) => {
  test.setTimeout(420_000);
  await gotoHarness(page);

  const esbuildRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('esbuild-wasm')) {
      esbuildRequests.push(request.url());
    }
  });
  const proof = (await page.evaluate(
    async ({ fixtureUrl, nodeEntryUrl }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      return fixture.runDefaultVite8Empty(nodeEntryUrl);
    },
    { fixtureUrl: acceptanceFixtureUrl, nodeEntryUrl: vite8EmptyEntryUrl },
  )) as SerializedModeProof;

  expect(proof.progress).toEqual([]);
  expect(proof.devHtml).toContain('/src/main.js');
  expect(proof.build.exit).toEqual({ code: 0, signal: null });
  expect(proof.previewHtml).toContain('/assets/');
  expect(
    [proof.devOutput, proof.build.output, proof.previewOutput]
      .join('\n')
      .match(/RIFTY_VITE8_CAPABILITY_KEYS:\[\]/gu),
  ).toHaveLength(3);
  expect(esbuildRequests).toEqual([]);
});

test('real Vite 7 Worker capability close fails preparation without false preview or fallback', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await gotoHarness(page);
  const pinnedEsbuildRequests = await pinPublicEsbuild0280(page);

  const proof = (await page.evaluate(
    async ({ fixtureUrl, nodeEntryUrl }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      return fixture.runVite7CapabilityClose(nodeEntryUrl);
    },
    { fixtureUrl: acceptanceFixtureUrl, nodeEntryUrl: capabilityCloseEntryUrl },
  )) as SerializedFaultProof;

  expect(proof.exit).toEqual({ code: 1, signal: null });
  expect(`${proof.failureName}\n${proof.failureMessage}\n${proof.output}`).toMatch(
    /ShadowAssetPortError|ESHADOWASSETPORT|Shadow asset port closed/u,
  );
  expect(proof.previewStatus).not.toBe(200);
  expect(proof.previewBody).not.toContain('must-not-publish');
  expect(pinnedEsbuildRequests).toHaveLength(1);
});
