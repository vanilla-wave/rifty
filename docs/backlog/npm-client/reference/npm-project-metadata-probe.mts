import { RegistryClient } from '../../../../packages/npm-client/src/index.ts';
import { Shell } from '../../../../packages/shell/src/index.ts';
import { MemoryVfs } from '../../../../packages/vfs/src/index.ts';
import { createTestNpmPackageAcquisitionAuthority } from '../../../../packages/workbench/src/glue/npm-shell-command.test-fixture.ts';
import { createNpmShellCommand } from '../../../../packages/workbench/src/glue/npm-shell-command.ts';
import { installRegistry } from '../../../../tests/no-coi/fixtures/npm-install-registry.ts';
const result = [];
const registry = await installRegistry();
try {
  for (const [index, command] of ['npm install ms', 'npm install', 'npm install ms'].entries()) {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    if (index === 0)
      await vfs.writeFile(
        '/project/package.json',
        JSON.stringify({ name: 'install-oracle', version: '1.0.0', private: true }),
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
    const chunks: string[] = [];
    const outcome = await shell.run(command, { onChunk: (chunk) => chunks.push(chunk) });
    const pkg = JSON.parse(await vfs.readFileText('/project/package.json').catch(() => 'null'));
    const lock = JSON.parse(
      await vfs.readFileText('/project/package-lock.json').catch(() => 'null'),
    );
    result.push({ command, initialized: index === 0, exitCode: outcome.exitCode, pkg, lock });
    await shell.dispose();
  }
  console.log(JSON.stringify({ node: process.version, cases: result }, null, 2));
} finally {
  await registry.close();
}
