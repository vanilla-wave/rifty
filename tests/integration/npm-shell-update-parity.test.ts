import { RegistryClient } from '@riftydev/npm-client';
import { Shell } from '@riftydev/shell';
import { MemoryVfs } from '@riftydev/vfs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestNpmPackageAcquisitionAuthority } from '../../packages/workbench/src/glue/npm-shell-command.test-fixture.ts';
import { createNpmShellCommand } from '../../packages/workbench/src/glue/npm-shell-command.ts';
import { initialManifest, installRegistry } from '../no-coi/fixtures/npm-install-registry.ts';
import { updateCases } from '../no-coi/fixtures/npm-install-update-cases.ts';
let registry: Awaited<ReturnType<typeof installRegistry>>;
beforeAll(async () => {
  registry = await installRegistry();
});
afterAll(async () => {
  await registry.close();
});
for (const scenario of updateCases)
  test(scenario.name, async () => {
    registry.hold(
      'tarballFailure' in scenario
        ? async (path) => {
            if (path.endsWith('.tgz')) throw new Error('controlled tarball delivery failure');
          }
        : undefined,
    );
    const expected = await registry.native(scenario.args, scenario.initial, scenario.before);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    await vfs.writeFile(
      '/project/package.json',
      JSON.stringify({ ...initialManifest, ...scenario.initial }),
    );
    const deps = { vfs, registry: new RegistryClient({ baseUrl: registry.origin }) };
    const shell = new Shell({ cwd: '/project' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        ...deps,
        packageAcquisitionAuthority: createTestNpmPackageAcquisitionAuthority(deps),
      }),
    );
    try {
      for (const args of [...scenario.before, scenario.args]) {
        const result = await shell.run(
          `npm install ${args.map((arg) => `'${arg}'`).join(' ')} && echo continued`,
        );
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toContain('continued');
      }
      const pkg = JSON.parse(await vfs.readFileText('/project/package.json'));
      const lock = JSON.parse(await vfs.readFileText('/project/package-lock.json'));
      const installed = JSON.parse(
        await vfs.readFileText('/project/node_modules/ms/package.json').catch((error) => {
          if (error.code === 'ENOENT') return 'null';
          throw error;
        }),
      );
      expect({
        pkg,
        lockDependencies: lock.packages[''].dependencies,
        lockDevDependencies: lock.packages[''].devDependencies,
        lockOptionalDependencies: lock.packages[''].optionalDependencies,
        installedVersion: installed?.version,
      }).toEqual(expected);
    } finally {
      await shell.dispose();
    }
  });
