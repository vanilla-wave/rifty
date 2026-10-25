import { initialManifest, installRegistry } from './fixtures/npm-install-registry.ts';
import { updateCases } from './fixtures/npm-install-update-cases.ts';
import { expect, test } from './fixtures/test.ts';
const root = process.cwd();
let registry: Awaited<ReturnType<typeof installRegistry>>;
test.beforeAll(async () => {
  registry = await installRegistry();
});
test.afterAll(async () => {
  await registry.close();
});
for (const scenario of updateCases)
  test(scenario.name, async ({ page }) => {
    registry.hold(
      'tarballFailure' in scenario
        ? async (path) => {
            if (path.endsWith('.tgz')) throw new Error('controlled tarball delivery failure');
          }
        : undefined,
    );
    const expected = await registry.native(scenario.args, scenario.initial, scenario.before);
    await page.goto('/no-coi-harness.html');
    const observed = await page.evaluate(
      async ({ root, registryUrl, scenario, initialManifest }) => {
        const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const sandbox = await createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          storage: { persistence: 'ephemeral' },
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
            registryUrl,
          },
        });
        try {
          const project = sandbox.project({ root: '/project' });
          await project.fs.writeFile(
            'package.json',
            JSON.stringify({ ...initialManifest, ...scenario.initial }),
          );
          const outcomes = [];
          for (const args of [...scenario.before, scenario.args])
            outcomes.push(
              await project.run(
                `npm install ${args.map((arg) => `'${arg}'`).join(' ')} && echo continued`,
              ).completion,
            );
          const pkg = JSON.parse(await project.fs.readFile('package.json', 'utf8'));
          const lock = JSON.parse(await project.fs.readFile('package-lock.json', 'utf8'));
          const installed = JSON.parse(
            await project.fs.readFile('node_modules/ms/package.json', 'utf8').catch((error) => {
              if (error.code === 'ENOENT') return 'null';
              throw error;
            }),
          );
          return {
            outcomes,
            state: {
              pkg,
              lockDependencies: lock.packages[''].dependencies,
              lockDevDependencies: lock.packages[''].devDependencies,
              lockOptionalDependencies: lock.packages[''].optionalDependencies,
              installedVersion: installed?.version,
            },
          };
        } finally {
          sandbox.dispose();
        }
      },
      { root, registryUrl: registry.origin, scenario, initialManifest },
    );
    for (const outcome of observed.outcomes) {
      expect(outcome.exitCode, outcome.stderr).toBe(0);
      expect(outcome.stdout).toContain('continued');
    }
    expect(observed.state).toEqual(expected);
  });
