import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { bakeApplicationPackage } from './fixtures/snapshot-application-package.ts';
import { expect, test } from '@playwright/test';
import type * as PublicWorkbench from '../../apps/playground/src/browser-unit/workbench-playground-entry.ts';
import type * as HostAssets from '../../apps/playground/src/browser-unit/workbench-vite-host-assets.ts';
import { gotoHarness } from './fixtures.ts';

test('public Workbench reports actual first-open persistence and clears it at settlement', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const snapshot = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./fixtures/snapshot-application-package.ts', import.meta.url)),
      ],
      { encoding: 'utf8' },
    ),
  ) as Awaited<ReturnType<typeof bakeApplicationPackage>>;
  await page.route('**/pr323-snapshot.tar.gz', (route) =>
    route.fulfill({ body: Buffer.from(snapshot.archive), contentType: 'application/gzip' }),
  );
  await gotoHarness(page);
  const result = await page.evaluate(async (snapshot) => {
    const sdkUrl = '/src/browser-unit/workbench-playground-entry.ts';
    const assetsUrl = '/src/browser-unit/workbench-vite-host-assets.ts';
    const sdk = (await import(/* @vite-ignore */ sdkUrl)) as typeof PublicWorkbench;
    const { workbenchViteHostAssets: assets } = (await import(
      /* @vite-ignore */ assetsUrl
    )) as typeof HostAssets;
    const workbench = await sdk.openPlaygroundWorkbench({
      deployment: { ...assets, serviceWorker: { url: '/sw.js', scope: '/' } },
      packageAcquisition: { registryUrl: '/npm-registry' },
      storage: { persistence: 'required', namespace: `pr323-progress-${crypto.randomUUID()}` },
    });
    const files: Record<string, string> = {
      '/package.json': snapshot.manifestText,
      '/main.cjs': "console.log('opened');",
    };
    for (let i = 0; i < 100; i++) files[`/src/${Math.floor(i / 10)}/${i}.txt`] = `file ${i}`;
    const events: Array<{ projectId: string; persisted: number; total: number }> = [];
    let resolved = false;
    let prematureCompletion = false;
    const unsubscribe = workbench.health.subscribe((health) => {
      const progress = (
        health as unknown as {
          projectOpen?: { projectId: string; persistence?: { persisted: number; total: number } };
        }
      ).projectOpen;
      if (progress?.persistence) {
        prematureCompletion ||= resolved;
        events.push({ projectId: progress.projectId, ...progress.persistence });
      }
    });
    try {
      const definition = workbench.playground.define({
        kind: 'node-cli',
        id: 'scratch',
        starterId: 'progress',
        templateId: 'opfs-ms',
        entryPath: '/main.cjs',
        files,
        firstMaterialization: {
          kind: 'snapshot',
          snapshot: {
            snapshotId: snapshot.snapshotId,
            templateId: 'opfs-ms',
            assetUrl: '/pr323-snapshot.tar.gz',
          },
        },
      });
      await workbench.playground.catalog.createScratch({ definition });
      const project = await workbench.openProject(definition);
      resolved = true;
      const settled = workbench.health.snapshot();
      const file = await project.files.readFile('/src/9/99.txt');
      await project.close();
      return { events, settled, prematureCompletion, file: new TextDecoder().decode(file.bytes) };
    } finally {
      unsubscribe();
      await workbench.close();
    }
  }, snapshot);
  expect(result.file).toBe('file 99');
  expect(result.events.length).toBeGreaterThan(0);
  expect(result.events.some(({ persisted, total }) => persisted < total)).toBe(true);
  expect(
    result.events.every(
      ({ projectId, persisted, total }) =>
        projectId === 'scratch' && persisted >= 0 && persisted <= total,
    ),
  ).toBe(true);
  expect(result.settled).not.toHaveProperty('projectOpen');
  expect(result.prematureCompletion).toBe(false);
});
