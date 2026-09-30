import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { expect, test } from './fixtures/test.ts';
const root = process.cwd().replaceAll('\\', '/');
test('existing apply-only consumer loses agent-added dependency on a deploy', async ({
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
  const metadata = JSON.parse(
    readFileSync(`${root}/tests/integration/fixtures/registry/kleur.json`, 'utf8'),
  );
  let origin = '';
  const server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    if (request.url === '/kleur')
      response.end(
        JSON.stringify({
          name: 'kleur',
          'dist-tags': { latest: '4.1.5' },
          versions: {
            '4.1.5': { ...metadata, dist: { ...metadata.dist, tarball: `${origin}/kleur.tgz` } },
          },
        }),
      );
    else if (request.url === '/kleur.tgz')
      response.end(readFileSync(`${root}/tests/integration/fixtures/registry/kleur-4.1.5.tgz`));
    else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing registry');
  origin = `http://127.0.0.1:${address.port}`;
  await context.route('**/deploy-one', (route) =>
    route.fulfill({ body: Buffer.from(first.archive) }),
  );
  await context.route('**/deploy-two', (route) =>
    route.fulfill({ body: Buffer.from(next.archive) }),
  );
  try {
    await page.goto('/no-coi-harness.html');
    const result = await page.evaluate(
      async ({ root, origin, first, next }) => {
        const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const sandbox = await createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          storage: { persistence: 'required', namespace: 'reference-deploy-red' },
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
            registryUrl: origin,
          },
        });
        try {
          const project = sandbox.project({ root: '/project' });
          await sandbox.toolchain.applySnapshot({
            cwd: '/project',
            snapshot: {
              assetUrl: '/deploy-one',
              snapshotId: first.snapshotId,
              templateId: 'opfs-ms',
            },
          });
          const install = await project.run('npm install kleur@4.1.5').completion;
          if (install.exitCode !== 0) throw new Error(JSON.stringify(install));
          const desired = JSON.parse(await project.fs.readFile('package.json', 'utf8'));
          await project.fs.writeFile(
            'main.cjs',
            "console.log(require('./node_modules/kleur/package.json').version)",
          );
          const beforeUse = await project.run('node main.cjs').completion;
          // Existing consumer's deploy recipe: force apply then source writes; no reconciliation.
          await sandbox.toolchain.applySnapshot({
            cwd: '/project',
            snapshot: {
              assetUrl: '/deploy-two',
              snapshotId: next.snapshotId,
              templateId: 'opfs-ms',
            },
            force: true,
          });
          return {
            desired,
            beforeUse,
            lock: JSON.parse(await project.fs.readFile('package-lock.json', 'utf8')),
            manifest: JSON.parse(await project.fs.readFile('package.json', 'utf8')),
            use: await project.run('node main.cjs').completion,
          };
        } finally {
          sandbox.dispose();
        }
      },
      {
        root,
        origin,
        first: { snapshotId: first.snapshotId },
        next: { snapshotId: next.snapshotId },
      },
    );
    expect(result.desired.dependencies.kleur).toBe('^4.1.5');
    expect(result.beforeUse).toMatchObject({ exitCode: 0, stdout: '4.1.5\n' });
    expect.soft(result.manifest.dependencies.kleur).toBe(result.desired.dependencies.kleur);
    expect
      .soft(result.lock.packages[''].dependencies.kleur)
      .toBe(result.desired.dependencies.kleur);
    expect.soft(result.use).toMatchObject({ exitCode: 0, stdout: '4.1.5\n' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
