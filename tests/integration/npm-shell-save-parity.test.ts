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

test('resolved save never overwrites a real package.json edit during registry acquisition', async () => {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  await vfs.writeFile('/project/package.json', JSON.stringify(initialManifest));
  let entered!: () => void;
  const entrance = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  registry.hold(async (path) => {
    if (path === '/ms') {
      entered();
      await held;
    }
  });
  const deps = { vfs, registry: new RegistryClient({ baseUrl: registry.origin }) };
  const shell = new Shell({ cwd: '/project' });
  shell.registerCommand(
    'npm',
    createNpmShellCommand({
      ...deps,
      packageAcquisitionAuthority: createTestNpmPackageAcquisitionAuthority(deps),
    }),
  );
  const output: string[] = [];
  const running = shell.run('npm install ms', { onChunk: (chunk) => output.push(chunk) });
  try {
    await Promise.race([
      entrance,
      running.then(() => {
        throw new Error('Install never reached registry');
      }),
    ]);
    const edit = JSON.stringify({
      ...initialManifest,
      description: 'edited during real fetch',
      dependencies: { ms: '2.0.0' },
    });
    await vfs.writeFile('/project/package.json', edit);
    release();
    expect((await running).exitCode).toBe(0);
    expect(await vfs.readFileText('/project/package.json')).toBe(edit);
    await expect.poll(() => output.join('')).toContain('package.json changed');
  } finally {
    release();
    registry.hold();
    await running;
    await shell.dispose();
  }
});
