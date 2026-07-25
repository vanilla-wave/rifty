import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RegistryClient } from '@riftydev/npm-client';
import { Shell } from '@riftydev/shell';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { installArtifactIdentity } from '../../packages/workbench/src/glue/install-artifact-identity.ts';
import { createInstallStampAuthority } from '../../packages/workbench/src/glue/install-stamp-authority.ts';
import { createTestNpmPackageAcquisitionAuthority } from '../../packages/workbench/src/glue/npm-shell-command.test-fixture.ts';
import { createNpmShellCommand } from '../../packages/workbench/src/glue/npm-shell-command.ts';
import { LOCAL_REGISTRY_BASE_URL, makeLocalFetcher } from './fixtures/local-registry.ts';

function runNativeLockOnlyInstall(cwd: string, packageSpec?: string): void {
  execFileSync(
    'npm',
    [
      'install',
      ...(packageSpec === undefined ? [] : [packageSpec]),
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

function nativePrefix(cwd: string): string {
  return realpathSync(
    execFileSync('npm', ['prefix'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
  );
}

function productionShell(vfs: MemoryVfs, cwd: string): Shell {
  const registry = new RegistryClient({
    baseUrl: LOCAL_REGISTRY_BASE_URL,
    fetch: makeLocalFetcher().fetch,
  });
  const deps = { vfs, registry };
  const shell = new Shell({ cwd });
  shell.registerCommand(
    'npm',
    createNpmShellCommand({
      ...deps,
      packageAcquisitionAuthority: createTestNpmPackageAcquisitionAuthority(deps),
    }),
  );
  return shell;
}

// Oracle recorded 2026-07-24 with Node v24.16.0 and npm 11.17.0.
describe('npm shell prefix parity', () => {
  it('selects the nearer node_modules marker before an outer package.json', async () => {
    const nativeRoot = mkdtempSync(join(tmpdir(), 'rifty-npm-prefix-'));
    const nativeMember = join(nativeRoot, 'packages/app');
    const nativeCwd = join(nativeMember, 'src');
    try {
      mkdirSync(nativeCwd, { recursive: true });
      mkdirSync(join(nativeMember, 'node_modules'));
      writeFileSync(join(nativeRoot, 'package.json'), '{"name":"outer","private":true}\n');

      expect(nativePrefix(nativeCwd)).toBe(realpathSync(nativeMember));
      runNativeLockOnlyInstall(nativeCwd);
      expect(existsSync(join(nativeMember, 'package-lock.json'))).toBe(true);
      expect(existsSync(join(nativeRoot, 'package-lock.json'))).toBe(false);

      const vfs = new MemoryVfs();
      const root = '/workspace';
      const member = `${root}/packages/app`;
      const outerPackageJson = '{"name":"outer","private":true}\n';
      await vfs.mkdir(`${member}/src`, { recursive: true });
      await vfs.mkdir(`${member}/node_modules`);
      await vfs.writeFile(`${root}/package.json`, outerPackageJson);
      const shell = productionShell(vfs, `${member}/src`);

      const result = await shell.run('npm install kleur@4.1.5', { onChunk: () => {} });

      expect(result.exitCode).toBe(0);
      expect(await vfs.readFileText(`${root}/package.json`)).toBe(outerPackageJson);
      expect(JSON.parse(await vfs.readFileText(`${member}/package.json`))).toMatchObject({
        name: 'rifty-project',
        dependencies: { kleur: '4.1.5' },
      });
      await expect(vfs.exists(`${member}/node_modules/kleur/package.json`)).resolves.toBe(true);
      await expect(vfs.exists(`${root}/node_modules/kleur/package.json`)).resolves.toBe(false);
    } finally {
      rmSync(nativeRoot, { recursive: true, force: true });
    }
  });

  it('keeps explicit --prefix at the selected member despite an outer workspace root', async () => {
    const nativeRoot = mkdtempSync(join(tmpdir(), 'rifty-npm-explicit-prefix-'));
    const nativeDependency = mkdtempSync(join(tmpdir(), 'rifty-npm-explicit-dependency-'));
    const nativeMember = join(nativeRoot, 'packages/app');
    const nativeCwd = join(nativeRoot, 'elsewhere');
    try {
      mkdirSync(nativeMember, { recursive: true });
      mkdirSync(nativeCwd);
      const nativeRootPackageJson = `${JSON.stringify({
        name: 'outer',
        private: true,
        workspaces: ['packages/app'],
      })}\n`;
      writeFileSync(join(nativeRoot, 'package.json'), nativeRootPackageJson);
      writeFileSync(join(nativeMember, 'package.json'), '{"name":"app","private":true}\n');
      writeFileSync(
        join(nativeDependency, 'package.json'),
        '{"name":"user-pkg","version":"1.0.0"}\n',
      );

      expect(
        realpathSync(
          execFileSync('npm', ['--prefix', nativeMember, 'prefix'], {
            cwd: nativeCwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim(),
        ),
      ).toBe(realpathSync(nativeMember));
      execFileSync(
        'npm',
        [
          '--prefix',
          nativeMember,
          'install',
          nativeDependency,
          '--package-lock-only',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
        ],
        {
          cwd: nativeCwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      expect(readFileSync(join(nativeRoot, 'package.json'), 'utf8')).toBe(nativeRootPackageJson);
      expect(existsSync(join(nativeRoot, 'package-lock.json'))).toBe(false);
      expect(existsSync(join(nativeMember, 'package-lock.json'))).toBe(true);
      expect(JSON.parse(readFileSync(join(nativeMember, 'package.json'), 'utf8'))).toMatchObject({
        name: 'app',
        dependencies: { 'user-pkg': expect.stringMatching(/^file:/) },
      });

      const vfs = new MemoryVfs();
      const root = '/workspace';
      const member = `${root}/packages/app`;
      const cwd = `${root}/elsewhere`;
      const rootPackageJson = `${JSON.stringify({
        name: 'outer',
        private: true,
        workspaces: ['packages/app'],
      })}\n`;
      await vfs.mkdir(member, { recursive: true });
      await vfs.mkdir(cwd);
      await vfs.writeFile(`${root}/package.json`, rootPackageJson);
      await vfs.writeFile(`${member}/package.json`, '{"name":"app","private":true}\n');
      const shell = productionShell(vfs, cwd);

      const result = await shell.run(`npm --prefix ${member} install kleur@4.1.5`);

      expect(result.exitCode).toBe(0);
      expect(await vfs.readFileText(`${root}/package.json`)).toBe(rootPackageJson);
      expect(JSON.parse(await vfs.readFileText(`${member}/package.json`))).toMatchObject({
        name: 'app',
        dependencies: { kleur: '4.1.5' },
      });
      await expect(vfs.exists(`${root}/node_modules/kleur/package.json`)).resolves.toBe(false);
      await expect(vfs.exists(`${member}/node_modules/kleur/package.json`)).resolves.toBe(true);
    } finally {
      rmSync(nativeRoot, { recursive: true, force: true });
      rmSync(nativeDependency, { recursive: true, force: true });
    }
  });

  // Claim transitions below run with INJECTED resolveTreeGuards mirroring the production
  // demote-ancestors/revoke-descendants policy; guard DISCOVERY itself is pinned in
  // package-mutation-executor.test.ts ('discoverPackageAcquisitionGuardTransitions' cases),
  // not composed through this differential.
  it('matches the native npm install-root delta and documents injected claim transitions for a root nested under node_modules', async () => {
    const nativeRoot = mkdtempSync(join(tmpdir(), 'rifty-npm-nested-root-'));
    const nativeDependency = mkdtempSync(join(tmpdir(), 'rifty-npm-nested-dependency-'));
    const nativeNested = join(nativeRoot, 'node_modules/tool/project');
    const outerPackageJson = '{"name":"outer","private":true}\n';
    const nestedPackageJson = '{"name":"nested","private":true}\n';
    const sentinel = 'outer-tree-byte\n';
    try {
      mkdirSync(nativeNested, { recursive: true });
      writeFileSync(join(nativeRoot, 'package.json'), outerPackageJson);
      writeFileSync(join(nativeRoot, 'node_modules/outer-owned.txt'), sentinel);
      writeFileSync(join(nativeNested, 'package.json'), nestedPackageJson);
      writeFileSync(
        join(nativeDependency, 'package.json'),
        '{"name":"user-pkg","version":"1.0.0"}\n',
      );

      execFileSync(
        'npm',
        ['install', nativeDependency, '--ignore-scripts', '--no-audit', '--no-fund'],
        {
          cwd: nativeNested,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      const nativeDelta = {
        outerManifestPreserved:
          readFileSync(join(nativeRoot, 'package.json'), 'utf8') === outerPackageJson,
        outerSentinelPreserved:
          readFileSync(join(nativeRoot, 'node_modules/outer-owned.txt'), 'utf8') === sentinel,
        outerLockCreated: existsSync(join(nativeRoot, 'package-lock.json')),
        outerDependencyPlaced: existsSync(join(nativeRoot, 'node_modules/user-pkg')),
        nestedDependencyPlaced: existsSync(
          join(nativeNested, 'node_modules/user-pkg/package.json'),
        ),
      };

      const vfs = new MemoryVfs();
      const root = '/workspace';
      const nested = `${root}/node_modules/tool/project`;
      await vfs.mkdir(nested, { recursive: true });
      await vfs.writeFile(`${root}/package.json`, outerPackageJson);
      await vfs.writeFile(`${root}/node_modules/outer-owned.txt`, sentinel);
      await vfs.writeFile(`${nested}/package.json`, nestedPackageJson);
      const stamps = createInstallStampAuthority({ vfs });
      const outerProject = {
        projectId: 'outer',
        root,
        slug: 'outer',
        identity: installArtifactIdentity,
      };
      const outerClaim = await stamps.demote(outerProject);
      await stamps.promote(
        { ...outerProject, packageJsonText: outerPackageJson },
        { epoch: outerClaim.epoch, packages: 0 },
      );
      await expect(stamps.check({ root, slug: outerProject.slug })).resolves.toMatchObject({
        status: 'trusted',
      });

      const local = makeLocalFetcher();
      let outerStatusAtRegistry: string | undefined;
      const registry = new RegistryClient({
        baseUrl: LOCAL_REGISTRY_BASE_URL,
        fetch: async (url) => {
          outerStatusAtRegistry ??= (await stamps.check({ root, slug: outerProject.slug })).status;
          return local.fetch(url);
        },
      });
      const deps = { vfs, registry };
      const packages = createTestNpmPackageAcquisitionAuthority(deps, {
        stamps,
        resolveTreeGuards: (installRoot) => {
          if (installRoot === nested) {
            return [{ mode: 'demote', project: outerProject }];
          }
          if (installRoot === root) {
            return [{ mode: 'revoke', root: nested }];
          }
          return [];
        },
      });
      const npm = createNpmShellCommand({
        ...deps,
        packageAcquisitionAuthority: packages,
        projectSlug: (installRoot) => (installRoot === root ? outerProject.slug : installRoot),
      });
      const shell = new Shell({ cwd: nested });
      shell.registerCommand('npm', npm);

      const result = await shell.run('npm install kleur@4.1.5', { onChunk: () => {} });
      await packages.quiesce();

      expect(result.exitCode).toBe(0);
      expect(outerStatusAtRegistry).toBe('pending');
      const riftyDelta = {
        outerManifestPreserved:
          (await vfs.readFileText(`${root}/package.json`)) === outerPackageJson,
        outerSentinelPreserved:
          (await vfs.readFileText(`${root}/node_modules/outer-owned.txt`)) === sentinel,
        outerLockCreated: await vfs.exists(`${root}/package-lock.json`),
        outerDependencyPlaced: await vfs.exists(`${root}/node_modules/kleur`),
        nestedDependencyPlaced: await vfs.exists(`${nested}/node_modules/kleur/package.json`),
      };
      // Native uses a local package to keep the oracle offline; Rifty uses the vendored registry.
      // Package identity/transport differ, but the observable install-root delta must not.
      expect(riftyDelta).toEqual(nativeDelta);
      await expect(stamps.check({ root, slug: outerProject.slug })).resolves.toMatchObject({
        status: 'pending',
      });
      await expect(stamps.check({ root: nested, slug: nested })).resolves.toMatchObject({
        status: 'trusted',
      });

      const outerShell = new Shell({ cwd: root });
      outerShell.registerCommand('npm', npm);
      const outerResult = await outerShell.run('npm install kleur@4.1.5', { onChunk: () => {} });
      await packages.quiesce();

      expect(outerResult.exitCode).toBe(0);
      await expect(stamps.check({ root, slug: outerProject.slug })).resolves.toMatchObject({
        status: 'trusted',
      });
      await expect(stamps.check({ root: nested, slug: nested })).resolves.toMatchObject({
        status: 'absent',
      });
      expect(JSON.parse(await vfs.readFileText(`${root}/package.json`))).toMatchObject({
        name: 'outer',
        dependencies: { kleur: '4.1.5' },
      });
      await expect(vfs.exists(`${root}/node_modules/kleur/package.json`)).resolves.toBe(true);
    } finally {
      rmSync(nativeRoot, { recursive: true, force: true });
      rmSync(nativeDependency, { recursive: true, force: true });
    }
  });

  it.each([
    ['array', ['./packages/app/']],
    ['object packages', { packages: ['/packages/app'] }],
  ])(
    'keeps %s npm workspaces loud because prefix and manifest targets split',
    async (_form, workspaces) => {
      const nativeRoot = mkdtempSync(join(tmpdir(), 'rifty-npm-workspace-prefix-'));
      const nativeDependency = mkdtempSync(join(tmpdir(), 'rifty-npm-workspace-dependency-'));
      const nativeMember = join(nativeRoot, 'packages/app');
      const nativeCwd = join(nativeMember, 'src');
      try {
        mkdirSync(nativeCwd, { recursive: true });
        const nativeRootPackageJson = `${JSON.stringify({
          name: 'outer',
          private: true,
          workspaces,
        })}\n`;
        writeFileSync(join(nativeRoot, 'package.json'), nativeRootPackageJson);
        writeFileSync(join(nativeMember, 'package.json'), '{"name":"app","private":true}\n');
        writeFileSync(
          join(nativeDependency, 'package.json'),
          '{"name":"user-pkg","version":"1.0.0"}\n',
        );

        expect(nativePrefix(nativeCwd)).toBe(realpathSync(nativeRoot));
        runNativeLockOnlyInstall(nativeCwd, nativeDependency);
        expect(existsSync(join(nativeRoot, 'package-lock.json'))).toBe(true);
        expect(existsSync(join(nativeMember, 'package-lock.json'))).toBe(false);
        expect(readFileSync(join(nativeRoot, 'package.json'), 'utf8')).toBe(nativeRootPackageJson);
        expect(JSON.parse(readFileSync(join(nativeMember, 'package.json'), 'utf8'))).toMatchObject({
          name: 'app',
          dependencies: { 'user-pkg': expect.stringMatching(/^file:/) },
        });

        const vfs = new MemoryVfs();
        const root = '/workspace';
        const member = `${root}/packages/app`;
        const outerPackageJson = `${JSON.stringify({
          name: 'outer',
          private: true,
          workspaces,
        })}\n`;
        const memberPackageJson = '{"name":"app","private":true}\n';
        await vfs.mkdir(`${member}/src`, { recursive: true });
        await vfs.writeFile(`${root}/package.json`, outerPackageJson);
        await vfs.writeFile(`${member}/package.json`, memberPackageJson);
        const shell = productionShell(vfs, `${member}/src`);

        const result = await shell.run('npm install kleur@4.1.5', { onChunk: () => {} });

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Not implemented: npm.workspaces');
        expect(await vfs.readFileText(`${root}/package.json`)).toBe(outerPackageJson);
        expect(await vfs.readFileText(`${member}/package.json`)).toBe(memberPackageJson);
        await expect(vfs.exists(`${root}/node_modules/kleur/package.json`)).resolves.toBe(false);
        await expect(vfs.exists(`${member}/node_modules/kleur/package.json`)).resolves.toBe(false);
      } finally {
        rmSync(nativeRoot, { recursive: true, force: true });
        rmSync(nativeDependency, { recursive: true, force: true });
      }
    },
  );

  it('matches npm rejection of malformed workspace configuration', async () => {
    const nativeRoot = mkdtempSync(join(tmpdir(), 'rifty-npm-workspace-prefix-'));
    const nativeMember = join(nativeRoot, 'packages/app');
    const nativeCwd = join(nativeMember, 'src');
    const workspaces = { packages: 'packages/app' };
    try {
      mkdirSync(nativeCwd, { recursive: true });
      writeFileSync(
        join(nativeRoot, 'package.json'),
        `${JSON.stringify({ name: 'outer', private: true, workspaces })}\n`,
      );
      writeFileSync(join(nativeMember, 'package.json'), '{"name":"app","private":true}\n');

      expect(() => nativePrefix(nativeCwd)).toThrow(/workspaces config expects an Array/);

      const vfs = new MemoryVfs();
      const root = '/workspace';
      const member = `${root}/packages/app`;
      await vfs.mkdir(`${member}/src`, { recursive: true });
      await vfs.writeFile(
        `${root}/package.json`,
        `${JSON.stringify({ name: 'outer', private: true, workspaces })}\n`,
      );
      await vfs.writeFile(`${member}/package.json`, '{"name":"app","private":true}\n');
      const shell = productionShell(vfs, `${member}/src`);

      const result = await shell.run('npm install kleur@4.1.5');

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('EWORKSPACESCONFIG: workspaces config expects an Array');
      await expect(vfs.exists(`${root}/node_modules/kleur/package.json`)).resolves.toBe(false);
      await expect(vfs.exists(`${member}/node_modules/kleur/package.json`)).resolves.toBe(false);
    } finally {
      rmSync(nativeRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['wildcard', ['packages/*']],
    ['brace', { packages: ['packages/{app,other}'] }],
    ['extglob', ['packages/@(app|other)']],
    ['negation', ['packages/*', '!packages/other']],
  ])('keeps unsupported npm workspace %s semantics loud', async (_syntax, workspaces) => {
    const nativeRoot = mkdtempSync(join(tmpdir(), 'rifty-npm-workspace-prefix-'));
    const nativeMember = join(nativeRoot, 'packages/app');
    const nativeCwd = join(nativeMember, 'src');
    try {
      mkdirSync(nativeCwd, { recursive: true });
      writeFileSync(
        join(nativeRoot, 'package.json'),
        `${JSON.stringify({ name: 'outer', private: true, workspaces })}\n`,
      );
      writeFileSync(join(nativeMember, 'package.json'), '{"name":"app","private":true}\n');

      expect(nativePrefix(nativeCwd)).toBe(realpathSync(nativeRoot));

      const vfs = new MemoryVfs();
      const root = '/workspace';
      const member = `${root}/packages/app`;
      const memberPackageJson = '{"name":"app","private":true}\n';
      await vfs.mkdir(`${member}/src`, { recursive: true });
      await vfs.writeFile(
        `${root}/package.json`,
        `${JSON.stringify({ name: 'outer', private: true, workspaces })}\n`,
      );
      await vfs.writeFile(`${member}/package.json`, memberPackageJson);
      const shell = productionShell(vfs, `${member}/src`);

      const result = await shell.run('npm install kleur@4.1.5');

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Not implemented: npm.workspaces');
      expect(await vfs.readFileText(`${member}/package.json`)).toBe(memberPackageJson);
      await expect(vfs.exists(`${root}/node_modules/kleur/package.json`)).resolves.toBe(false);
      await expect(vfs.exists(`${member}/node_modules/kleur/package.json`)).resolves.toBe(false);
    } finally {
      rmSync(nativeRoot, { recursive: true, force: true });
    }
  });
});
