import { RegistryClient } from '@riftydev/npm-client';
import { Shell } from '@riftydev/shell';
import { MemoryVfs } from '@riftydev/vfs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestNpmPackageAcquisitionAuthority } from '../../packages/workbench/src/glue/npm-shell-command.test-fixture.ts';
import { createNpmShellCommand } from '../../packages/workbench/src/glue/npm-shell-command.ts';
import {
  initialManifest,
  installRegistry,
  saveCases,
} from '../no-coi/fixtures/npm-install-registry.ts';

let registry: Awaited<ReturnType<typeof installRegistry>>;
beforeAll(async () => {
  registry = await installRegistry();
});
afterAll(async () => {
  await registry.close();
});
for (const [index, scenario] of saveCases.entries()) {
  test(`shared npm command retains native save semantics: case ${index}`, async () => {
    const expected = await registry.native(scenario.args, scenario.initial);
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
      const outcome = await shell.run(
        `npm install ${scenario.args.map((arg) => `'${arg}'`).join(' ')}`,
      );
      const pkg = JSON.parse(await vfs.readFileText('/project/package.json'));
      const lock = JSON.parse(await vfs.readFileText('/project/package-lock.json'));
      const installed = JSON.parse(await vfs.readFileText('/project/node_modules/ms/package.json'));
      expect(outcome.exitCode).toBe(0);
      expect({
        pkg,
        lockDependencies: lock.packages[''].dependencies,
        lockDevDependencies: lock.packages[''].devDependencies,
        installedVersion: installed.version,
      }).toEqual(expected);
    } finally {
      await shell.dispose();
    }
  });
}
