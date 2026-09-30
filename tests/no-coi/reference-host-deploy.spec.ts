import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { expect, test } from './fixtures/test.ts';
const root = process.cwd().replaceAll('\\', '/');
for (const retry of [false, true])
  test(`reference host reconciles actual edits after deploy; retry=${retry}`, async ({
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
    const fetches: string[] = [];
    await context.route('**/deploy-one', (route) => {
      fetches.push('one');
      return route.fulfill({ body: Buffer.from(first.archive) });
    });
    await context.route('**/deploy-two', (route) => {
      fetches.push('two');
      return route.fulfill({ body: Buffer.from(next.archive) });
    });
    try {
      await page.goto('/no-coi-harness.html');
      const result = await page.evaluate(
        async ({ root, origin, first, next, retry }) => {
          const { openReferenceHost } = await import(
            `/@fs${root}/tests/integration/fixtures/workbench-vite-consumer/src/host.ts`
          );
          const connections = {
            root: '/project',
            provider: 'fixture',
            model: 'scripted',
            models: [
              {
                id: 'scripted',
                name: 'scripted',
                provider: 'fixture',
                api: 'openai-completions',
                baseUrl: origin,
                contextWindow: 32768,
                maxTokens: 4096,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
            probeBaseUrl: '/browser-support-probes/',
            snapshotState: { store: localStorage, key: 'reference-deploy-red:/project' },
            storage: { persistence: 'required', namespace: 'reference-deploy-red' },
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
            registryUrl: origin,
          };
          let host = await openReferenceHost(connections);
          try {
            let project = host.project;
            await host.prepare({
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
            const source = await project.fs.readFile('main.cjs', 'utf8');
            await host.close();
            host = await openReferenceHost(connections);
            project = host.project;
            await host.prepare({
              snapshot: {
                assetUrl: '/deploy-one',
                snapshotId: first.snapshotId,
                templateId: 'opfs-ms',
              },
            });
            const reopenedSource = await project.fs.readFile('main.cjs', 'utf8');
            const reopenedManifest = await project.fs.readFile('package.json', 'utf8');
            let refused: string | undefined;
            if (retry) {
              try {
                await host.prepare({
                  snapshot: {
                    assetUrl: '/deploy-two',
                    snapshotId: next.snapshotId,
                    templateId: 'opfs-ms',
                  },
                  files: { node_modules: 'must fail' },
                });
              } catch (error) {
                refused = String(error);
              }
            }
            const recordedBeforeRetry = localStorage.getItem(connections.snapshotState.key);

            await host.prepare({
              snapshot: {
                assetUrl: '/deploy-two',
                snapshotId: next.snapshotId,
                templateId: 'opfs-ms',
              },
              files: { 'package.json': JSON.stringify(desired) },
              install: { registryUrl: origin },
            });
            return {
              desired,
              beforeUse,
              source,
              reopenedSource,
              reopenedManifest,
              refused,
              recordedBeforeRetry,
              lock: JSON.parse(await project.fs.readFile('package-lock.json', 'utf8')),
              manifest: JSON.parse(await project.fs.readFile('package.json', 'utf8')),
              use: await project.run('node main.cjs').completion,
            };
          } finally {
            await host.close();
          }
        },
        {
          root,
          origin,
          retry,
          first: { snapshotId: first.snapshotId },
          next: { snapshotId: next.snapshotId },
        },
      );
      expect(fetches).toEqual(['one', 'two']);
      expect(result.reopenedSource).toBe(result.source);
      expect(JSON.parse(result.reopenedManifest)).toEqual(result.desired);
      if (retry) {
        expect(result.refused).toMatch(/EISDIR|directory/i);
        expect(result.recordedBeforeRetry).toBe(next.snapshotId);
      }
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
