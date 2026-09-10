import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type * as Companion from '../../apps/playground/src/browser-unit/workbench-playground-entry.ts';
import type * as HostAssets from '../../apps/playground/src/browser-unit/workbench-vite-host-assets.ts';
import { gotoHarness } from './fixtures.ts';
import type { bakeApplicationPackage } from './fixtures/snapshot-application-package.ts';

test('saved snapshot files and real Node terminal survive a malformed lock and missing dependency; explicit npm repairs them', async ({
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
  const upstream = JSON.parse(
    readFileSync(
      new URL('../integration/fixtures/registry/ms-2.0.0.json', import.meta.url),
      'utf8',
    ),
  ) as { dist: { upstreamTarball: string; upstreamIntegrity: string } };
  const tarball = readFileSync(
    new URL('../integration/fixtures/registry/ms-2.0.0.tgz', import.meta.url),
  );
  let requests = 0;
  await page.route('**/pr323-snapshot.tar.gz', (route) => {
    requests++;
    return route.fulfill({ body: Buffer.from(snapshot.archive), contentType: 'application/gzip' });
  });
  await page.route('**/npm-registry/ms', (route) => {
    requests++;
    return route.fulfill({
      json: {
        name: 'ms',
        'dist-tags': { latest: '2.0.0' },
        versions: {
          '2.0.0': {
            name: 'ms',
            version: '2.0.0',
            dist: {
              tarball: upstream.dist.upstreamTarball,
              integrity: upstream.dist.upstreamIntegrity,
            },
          },
        },
      },
    });
  });
  await page.route('**/ms-2.0.0.tgz', (route) => {
    requests++;
    return route.fulfill({ body: tarball });
  });
  await gotoHarness(page);
  const result = await page.evaluate(async (snapshot) => {
    const sdkUrl = '/src/browser-unit/workbench-playground-entry.ts';
    const assetsUrl = '/src/browser-unit/workbench-vite-host-assets.ts';
    const sdk = (await import(/* @vite-ignore */ sdkUrl)) as typeof Companion;
    const { workbenchViteHostAssets: assets } = (await import(
      /* @vite-ignore */ assetsUrl
    )) as typeof HostAssets;
    const options = {
      deployment: { ...assets, serviceWorker: { url: '/sw.js', scope: '/' } },
      packageAcquisition: { registryUrl: '/npm-registry' },
      storage: {
        persistence: 'required' as const,
        namespace: `pr323-saved-${crypto.randomUUID()}`,
      },
    };
    const plan = (id: string): Companion.PlaygroundProjectPlan => ({
      kind: 'node-cli',
      id,
      starterId: 'opfs-ms',
      templateId: 'opfs-ms',
      entryPath: '/main.cjs',
      files: {
        '/package.json': snapshot.manifestText,
        '/main.cjs': "console.log(require('ms')('2s'));",
        '/local.cjs': "console.log('local source ran');",
      },
      firstMaterialization: {
        kind: 'snapshot',
        snapshot: {
          snapshotId: snapshot.snapshotId,
          templateId: 'opfs-ms',
          assetUrl: '/pr323-snapshot.tar.gz',
        },
      },
    });
    const first = await sdk.openPlaygroundWorkbench(options);
    const definition = first.playground.define(plan('scratch'));
    await first.playground.catalog.createScratch({ definition });
    const scratch = await first.openProject(definition);
    await scratch.close();
    const savedDefinition = first.playground.define(plan('saved'));
    await first.playground.catalog.saveScratch({
      id: 'saved',
      name: 'Saved',
      definition: savedDefinition,
    });
    const saved = await first.openProject(savedDefinition);
    const lock = await saved.files.readFile('/package-lock.json');
    await saved.files.writeFile('/package-lock.json', new TextEncoder().encode('not JSON'), {
      expectedVersion: lock.version,
    });
    const packageEntry = (await saved.files.readdir('/node_modules')).find(
      (entry) => entry.path === '/node_modules/ms',
    );
    if (!packageEntry) throw new Error('snapshot package missing before mutation');
    await saved.files.remove('/node_modules/ms', {
      expectedVersion: packageEntry.version,
      recursive: true,
    });
    await saved.close();
    await first.close();
    const second = await sdk.openPlaygroundWorkbench(options);
    try {
      const project = await second.openProject(second.playground.define(plan('saved')));
      const preservedLock = new TextDecoder().decode(
        (await project.files.readFile('/package-lock.json')).bytes,
      );
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
      const missing = await run('node main.cjs');
      const install = await run('npm install');
      const repaired = await run('node main.cjs');
      await terminal.close();
      await project.close();
      return { preservedLock, local, missing, install, repaired };
    } finally {
      await second.close();
    }
  }, snapshot);
  console.log('[pr323-saved-access]', JSON.stringify(result));
  expect(result.preservedLock).toBe('not JSON');
  expect(result.local.exit).toBe(0);
  expect(result.local.out).toContain('local source ran');
  expect(result.missing.exit).not.toBe(0);
  expect(result.missing.out).toMatch(/MODULE_NOT_FOUND|Cannot find module/);
  expect(result.install.exit).toBe(0);
  expect(result.repaired.exit).toBe(0);
  expect(result.repaired.out).toContain('2000');
  expect(requests).toBeGreaterThan(1);
});
