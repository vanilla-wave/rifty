import { execFileSync } from 'node:child_process';
import { expect, test } from './fixtures/test.ts';

const root = process.cwd().replaceAll('\\', '/');

test('reference host explicitly prepares or opens saved files without snapshot identity policy', async ({
  page,
  context,
}) => {
  const bake = (version: string) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          `${root}/tests/browser-unit/fixtures/snapshot-application-package.ts`,
          version,
        ],
        { cwd: root, encoding: 'utf8' },
      ),
    );
  const first = bake('1.0.0');
  const next = bake('2.0.0');
  const fetches: string[] = [];
  for (const [name, snapshot] of [
    ['initial', first],
    ['changed', next],
  ] as const)
    await context.route(`**/reference-${name}`, (route) => {
      fetches.push(name);
      return route.fulfill({ body: Buffer.from(snapshot.archive) });
    });
  await page.goto('/no-coi-harness.html');
  const result = await page.evaluate(
    async ({ root, first, next }) => {
      const { openReferenceHost } = await import(
        `/@fs${root}/tests/integration/fixtures/workbench-vite-consumer/src/host.ts`
      );
      const { sandboxErrorKind } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const connections = {
        root: '/project',
        provider: 'fixture',
        model: 'unused',
        models: [
          {
            id: 'unused',
            name: 'unused',
            provider: 'fixture',
            api: 'openai-completions',
            baseUrl: location.origin,
            contextWindow: 32768,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
        probeBaseUrl: '/browser-support-probes/',
        storage: { persistence: 'required', namespace: 'reference-explicit-open' },
        workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
      };
      const storageBefore = { ...localStorage };
      let host = await openReferenceHost(connections);
      try {
        await host.prepare({
          snapshot: { assetUrl: '/reference-initial', snapshotId: first, templateId: 'opfs-ms' },
          files: { 'main.cjs': "console.log(require('ms')('2s'));" },
        });
        const manifest = JSON.stringify({
          ...JSON.parse(await host.project.fs.readFile('package.json', 'utf8')),
          description: 'actual saved user manifest',
        });
        await host.project.fs.writeFile('package.json', manifest);
        await host.project.fs.writeFile('main.cjs', "console.log('saved', require('ms')('3s'));");
        const lock = await host.project.fs.readFile('package-lock.json', 'utf8');
        await host.close();
        host = await openReferenceHost(connections);
        await host.call(() => host.sandbox.toolchain.open({ cwd: '/project' }));
        const reopened = await host.project.run('node main.cjs').completion;
        const conflict = await host
          .prepare({
            snapshot: { assetUrl: '/reference-changed', snapshotId: next, templateId: 'opfs-ms' },
            files: { 'main.cjs': 'must not overwrite saved source' },
          })
          .then(() => 'applied', sandboxErrorKind);
        return {
          reopened,
          conflict,
          manifest,
          lock,
          savedManifest: await host.project.fs.readFile('package.json', 'utf8'),
          savedLock: await host.project.fs.readFile('package-lock.json', 'utf8'),
          afterConflict: await host.project.run('node main.cjs').completion,
          storageBefore,
          storageAfter: { ...localStorage },
        };
      } finally {
        await host.close();
      }
    },
    { root, first: first.snapshotId, next: next.snapshotId },
  );
  expect(fetches).toEqual(['initial', 'changed']);
  expect(result.reopened).toMatchObject({ status: 'exited', exitCode: 0, stdout: 'saved 3000\n' });
  expect(result.conflict).toBe('snapshot-conflict');
  expect(result.savedManifest).toBe(result.manifest);
  expect(result.savedLock).toBe(result.lock);
  expect(result.afterConflict).toMatchObject({ exitCode: 0, stdout: 'saved 3000\n' });
  expect(result.storageAfter).toEqual(result.storageBefore);
});
