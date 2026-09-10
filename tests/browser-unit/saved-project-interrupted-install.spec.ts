import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type * as Companion from '../../apps/playground/src/browser-unit/workbench-playground-entry.ts';
import type * as Assets from '../../apps/playground/src/browser-unit/workbench-vite-host-assets.ts';
import type * as Fixture from './fixtures/sealed-playground-workbench.ts';
import { gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

const ownerModuleUrl = `/@fs${process.cwd()}/tests/browser-unit/fixtures/interrupted-install-owner.ts?worker&url`;

test('saved Vite opens after a page dies during real npm install lodash and explicit retry completes', async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  const metadata = JSON.parse(
    readFileSync(
      new URL('../integration/fixtures/registry/lodash-4.17.21.json', import.meta.url),
      'utf8',
    ),
  ) as { name: string; version: string; dist: { tarball: string; integrity: string } };
  const tarball = readFileSync(
    new URL('../integration/fixtures/registry/lodash-4.17.21.tgz', import.meta.url),
  );
  await context.route('**/npm-registry/lodash', (route) =>
    route.fulfill({
      json: {
        name: 'lodash',
        'dist-tags': { latest: metadata.version },
        versions: { [metadata.version]: metadata },
      },
    }),
  );
  await context.route('**/lodash-4.17.21.tgz', (route) => route.fulfill({ body: tarball }));
  const arrivals: string[] = [];
  context.on('request', (request) => {
    if (/npm-registry|\.tar\.gz/.test(request.url())) arrivals.push(request.url());
  });
  await gotoHarness(page);
  const prepare = async (input: { fixtureUrl: string; ownerModuleUrl?: string }) => {
    const sdkUrl = '/src/browser-unit/workbench-playground-entry.ts';
    const assetsUrl = '/src/browser-unit/workbench-vite-host-assets.ts';
    const sdk = (await import(/* @vite-ignore */ sdkUrl)) as typeof Companion;
    const { workbenchViteHostAssets: assets } = (await import(
      /* @vite-ignore */ assetsUrl
    )) as typeof Assets;
    const fixture = (await import(/* @vite-ignore */ input.fixtureUrl)) as typeof Fixture;
    const plan = await fixture.projectPlan({
      workspaceId: 'pr323-interrupted',
      template: 'vite',
      setup: 'instant',
    });
    let owner = assets.workers.owner;
    if (input.ownerModuleUrl)
      owner = ((await import(/* @vite-ignore */ input.ownerModuleUrl)) as { default: string })
        .default;
    const workbench = await sdk.openPlaygroundWorkbench({
      deployment: {
        ...assets,
        workers: { ...assets.workers, owner },
        serviceWorker: { url: '/sw.js', scope: '/' },
      },
      packageAcquisition: { registryUrl: '/npm-registry' },
      storage: { persistence: 'required', namespace: 'pr323-interrupted' },
    });
    const definition = workbench.playground.define({ ...plan, id: 'saved-interrupted' });
    if (input.ownerModuleUrl) {
      const scratchDefinition = workbench.playground.define(plan);
      await workbench.playground.catalog.createScratch({ definition: scratchDefinition });
      const scratch = await workbench.openProject(scratchDefinition);
      await scratch.files.writeFile(
        '/local.cjs',
        new TextEncoder().encode("console.log('retained local source');"),
        { expectedVersion: null },
      );
      await scratch.close();
      await workbench.playground.catalog.saveScratch({
        id: 'saved-interrupted',
        name: 'Interrupted Vite',
        definition,
      });
    }
    const project = await workbench.openProject(definition);
    const terminal = project.terminals.open();
    const run = async (line: string) => {
      let out = '';
      const detach = terminal.attach((chunk) => {
        out += chunk;
      });
      try {
        const command = terminal.run(line);
        const exit = await command.exitCode;
        await command.close();
        return { exit, out };
      } finally {
        detach();
      }
    };
    const local = await run('node local.cjs');
    if (input.ownerModuleUrl) {
      const channel = new BroadcastChannel('pr323-interrupted-install');
      const reached = new Promise<{ persistedBytes: number }>((resolve) => {
        channel.onmessage = (event) => resolve(event.data);
      });
      void run('npm install lodash').catch(() => {});
      return { local, paused: await reached };
    }
    try {
      const savedLicense = await project.files.readFile('/node_modules/lodash/LICENSE');
      const missing = await run('node -e "require(\'lodash\')"');
      const install = await run('npm install lodash');
      const repaired = await run('node -e "console.log(require(\'lodash\').chunk([1,2,3],2))"');
      return { local, savedBytes: savedLicense.bytes.byteLength, missing, install, repaired };
    } finally {
      await terminal.close();
      await project.close();
      await workbench.close();
    }
  };
  const victim = await page.evaluate(prepare, {
    fixtureUrl: sealedWorkbenchFixtureUrl,
    ownerModuleUrl,
  });
  console.log('[pr323-interrupted]', JSON.stringify(victim));
  expect(victim.local.exit).toBe(0);
  expect(victim.paused?.persistedBytes).toBeGreaterThan(100);
  await page.close();
  const fresh = await context.newPage();
  await gotoHarness(fresh);
  const recovered = await fresh.evaluate(prepare, { fixtureUrl: sealedWorkbenchFixtureUrl });
  expect(recovered.local.exit).toBe(0);
  expect(recovered.local.out).toContain('retained local source');
  expect(recovered.savedBytes).toBe(victim.paused?.persistedBytes);
  expect(recovered.missing?.exit).not.toBe(0);
  expect(recovered.install?.exit).toBe(0);
  expect(recovered.repaired?.exit).toBe(0);
  expect(recovered.repaired?.out).toContain('[ 1, 2 ]');
  expect(arrivals.some((url) => url.includes('lodash'))).toBe(true);
});
