import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import sha256FixedVectors from '../../../../tools/shadow-registry/src/internal/sha256-fixed-vectors.json';
import { installArtifactIdentity } from './install-artifact-identity.ts';
import { createInstallStampAuthority } from './install-stamp-authority.ts';
import {
  type InstallStampSyncFs,
  createInstallStamp,
  depsEqual,
  effectiveDepsFromPackageJsonText,
  installStampPath,
  installStampSatisfied,
  installStampSatisfiedForPackageJson,
  installStampSatisfiedForPackageJsonSync,
  isInstallStampPath,
  parseInstallStamp,
  readEffectiveDeps,
  readInstallStamp,
  readInstallStampSync,
} from './install-stamp.ts';

const ROOT = '/workspace';

async function seedProject(
  vfs: MemoryVfs,
  pkg: Record<string, unknown> = {
    name: 'app',
    dependencies: { vite: '^5.4.0' },
  },
): Promise<void> {
  await vfs.mkdir(ROOT, { recursive: true });
  await vfs.writeFile(`${ROOT}/package.json`, JSON.stringify(pkg));
}

async function seedNodeModules(vfs: MemoryVfs): Promise<void> {
  await vfs.mkdir(`${ROOT}/node_modules/vite`, { recursive: true });
}

async function seedTrustedStamp(vfs: MemoryVfs, packages: number, slug = ''): Promise<void> {
  const packageJsonText = await vfs.readFileText(`${ROOT}/package.json`);
  const authority = createInstallStampAuthority({ vfs });
  const claim = await authority.demote({ root: ROOT, slug });
  const result = await authority.promote(
    { root: ROOT, slug, packageJsonText },
    { epoch: claim.epoch, packages },
  );
  if (result.status !== 'trusted') throw new Error(`test setup failed: ${result.status}`);
}

async function seedPendingStamp(vfs: MemoryVfs, packages: number, slug: string): Promise<void> {
  const packageJsonText = await vfs.readFileText(`${ROOT}/package.json`);
  const stamp = createInstallStamp(ROOT, packageJsonText, {
    slug,
    packages,
    durability: 'pending',
    epoch: 'test:pending',
  });
  if (!stamp) throw new Error('test setup failed: invalid package.json');
  await vfs.writeFile(installStampPath(ROOT), `${JSON.stringify(stamp, null, 2)}\n`);
}

describe('install stamp (ADR-0135)', () => {
  it('round-trips a stamp with the package.json effective dep set (deps + dev + optional)', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs, {
      name: 'app',
      dependencies: { vite: '^5.4.0' },
      devDependencies: { tool: '1.0.0' },
      optionalDependencies: { fsevents: '^2' },
    });
    await seedNodeModules(vfs);

    await seedTrustedStamp(vfs, 14, 'real-vite');
    const stamp = await readInstallStamp(vfs, ROOT);

    expect(stamp).toEqual({
      version: 4,
      root: ROOT,
      slug: 'real-vite',
      packageJsonText: JSON.stringify({
        name: 'app',
        dependencies: { vite: '^5.4.0' },
        devDependencies: { tool: '1.0.0' },
        optionalDependencies: { fsevents: '^2' },
      }),
      installArtifactIdentity,
      deps: { vite: '^5.4.0', tool: '1.0.0', fsevents: '^2' },
      packages: 14,
    });
    expect(await vfs.exists(installStampPath(ROOT))).toBe(true);
    expect((await readInstallStamp(vfs, `${ROOT}/.`))?.root).toBe(ROOT);
  });

  it('treats a relative reader root as a miss before touching either VFS surface', async () => {
    const vfs = new MemoryVfs();
    const fs: InstallStampSyncFs = {
      existsSync: () => {
        throw new Error('relative root reached sync VFS');
      },
      readFileBytesSync: () => {
        throw new Error('relative root reached sync VFS');
      },
    };

    await expect(readInstallStamp(vfs, 'workspace')).resolves.toBeNull();
    expect(readInstallStampSync(fs, 'workspace')).toBeNull();
  });

  it('recognizes exact and descendant paths in every reserved claim namespace', () => {
    expect(isInstallStampPath('/node_modules/.rifty-install-stamp.json')).toBe(true);
    expect(
      isInstallStampPath('/project/node_modules/pkg/node_modules/.rifty-install-stamp.json'),
    ).toBe(true);
    expect(isInstallStampPath('/project/node_modules/.rifty-install-stamp.json/payload')).toBe(
      true,
    );
    expect(
      isInstallStampPath(
        '/project/node_modules/pkg/node_modules/.rifty-install-stamp.json/payload',
      ),
    ).toBe(true);
    expect(isInstallStampPath('/project/.rifty-install-stamp.json')).toBe(false);
    expect(isInstallStampPath('/project/node_modules/.rifty-install-stamp.json.backup')).toBe(
      false,
    );
    expect(isInstallStampPath('project/node_modules/.rifty-install-stamp.json')).toBe(false);
  });

  it('is satisfied when the slug + deps match and node_modules exists', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await seedTrustedStamp(vfs, 14, 'real-vite');

    const hit = await installStampSatisfied(vfs, ROOT, 'real-vite');
    expect(hit?.packages).toBe(14);
  });

  it('does not reuse a trusted stamp missing the current install-artifact identity when package.json is unchanged', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await vfs.writeFile(
      installStampPath(ROOT),
      JSON.stringify({
        version: 1,
        slug: 'real-vite',
        deps: { vite: '^5.4.0' },
        packages: 14,
      }),
    );

    expect(await installStampSatisfied(vfs, ROOT, 'real-vite')).toBeNull();
  });

  it('treats a v3 claim as a miss (v4 schema, ADR-0307)', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await seedTrustedStamp(vfs, 14, 'real-vite');
    const text = await vfs.readFileText(installStampPath(ROOT));
    await vfs.writeFile(installStampPath(ROOT), text.replace('"version": 4', '"version": 3'));

    await expect(readInstallStamp(vfs, ROOT)).resolves.toBeNull();
    await expect(installStampSatisfied(vfs, ROOT, 'real-vite')).resolves.toBeNull();
  });

  // ADR-0307: request identity at open = package.json text + lockfile hash.
  it('records the lockfile hash at promotion and misses on lockfile drift', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await vfs.writeFile(`${ROOT}/package-lock.json`, '{"lockfileVersion":3}\n');
    await seedTrustedStamp(vfs, 14, 'real-vite');

    const stamp = await readInstallStamp(vfs, ROOT);
    expect(stamp?.lockfileSha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(installStampSatisfied(vfs, ROOT, 'real-vite')).resolves.toMatchObject({
      slug: 'real-vite',
    });

    await vfs.writeFile(`${ROOT}/package-lock.json`, '{"lockfileVersion":3,"edited":true}\n');
    await expect(installStampSatisfied(vfs, ROOT, 'real-vite')).resolves.toBeNull();

    await vfs.rm(`${ROOT}/package-lock.json`);
    await expect(installStampSatisfied(vfs, ROOT, 'real-vite')).resolves.toBeNull();
  });

  it('misses when a lockfile appears after a lockfile-free promotion', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await seedTrustedStamp(vfs, 14, 'real-vite');

    expect((await readInstallStamp(vfs, ROOT))?.lockfileSha256).toBeUndefined();
    await expect(installStampSatisfied(vfs, ROOT, 'real-vite')).resolves.toMatchObject({
      slug: 'real-vite',
    });

    await vfs.writeFile(`${ROOT}/package-lock.json`, '{"lockfileVersion":3}\n');
    await expect(installStampSatisfied(vfs, ROOT, 'real-vite')).resolves.toBeNull();
  });

  it('sha256Hex matches the fixed vector and crypto.subtle on random bytes', async () => {
    const { sha256Hex } = await import('./install-stamp.ts');
    for (const vector of sha256FixedVectors) {
      expect(
        sha256Hex(
          Uint8Array.from(vector.hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16)),
        ),
        vector.name,
      ).toBe(vector.sha256);
    }
    const bytes = new Uint8Array(257).map((_, i) => (i * 31) % 256);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const expected = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    expect(sha256Hex(bytes)).toBe(expected);
  });

  it('sync twin applies the same lockfile hash compare as the async predicate', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    const lockText = '{"lockfileVersion":3}\n';
    await vfs.writeFile(`${ROOT}/package-lock.json`, lockText);
    await seedTrustedStamp(vfs, 14, 'real-vite');
    const packageJsonText = await vfs.readFileText(`${ROOT}/package.json`);
    const stampText = await vfs.readFileText(installStampPath(ROOT));
    const enc = new TextEncoder();
    const files = new Map<string, string>([
      [`${ROOT}/package.json`, packageJsonText],
      [installStampPath(ROOT), stampText],
      [`${ROOT}/node_modules`, ''],
      [`${ROOT}/package-lock.json`, lockText],
    ]);
    const fs: InstallStampSyncFs = {
      existsSync: (path) => files.has(path),
      readFileBytesSync: (path) => {
        const text = files.get(path);
        if (text === undefined) throw new Error(`ENOENT: ${path}`);
        return enc.encode(text);
      },
    };

    expect(
      installStampSatisfiedForPackageJsonSync(fs, ROOT, 'real-vite', packageJsonText),
    ).toMatchObject({ slug: 'real-vite' });

    files.delete(`${ROOT}/package-lock.json`);
    expect(
      installStampSatisfiedForPackageJsonSync(fs, ROOT, 'real-vite', packageJsonText),
    ).toBeNull();
  });

  it('reads pending stamps but never satisfies reuse from them', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await seedPendingStamp(vfs, 14, 'real-vite');

    expect(await readInstallStamp(vfs, ROOT)).toEqual({
      version: 4,
      root: ROOT,
      slug: 'real-vite',
      packageJsonText: JSON.stringify({ name: 'app', dependencies: { vite: '^5.4.0' } }),
      installArtifactIdentity,
      deps: { vite: '^5.4.0' },
      packages: 14,
      durability: 'pending',
      epoch: 'test:pending',
    });
    expect(await installStampSatisfied(vfs, ROOT, 'real-vite')).toBeNull();
    expect(
      await installStampSatisfiedForPackageJson(
        vfs,
        ROOT,
        'real-vite',
        JSON.stringify({ dependencies: { vite: '^5.4.0' } }),
      ),
    ).toBeNull();
  });

  it('is not satisfied when the project slug differs (shared-deps presets)', async () => {
    // project-files (instant) and real-vite (from-scratch) share the vite deps;
    // a stamp one wrote must not let the other skip its install.
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await seedTrustedStamp(vfs, 8, 'project-files');

    expect(await installStampSatisfied(vfs, ROOT, 'real-vite')).toBeNull();
    expect((await installStampSatisfied(vfs, ROOT, 'project-files'))?.packages).toBe(8);
  });

  it('is not satisfied when package.json deps drift after stamping', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await seedTrustedStamp(vfs, 14, 'real-vite');

    await seedProject(vfs, {
      name: 'app',
      dependencies: { vite: '^5.4.0', lodash: '^4' },
    });
    expect(await installStampSatisfied(vfs, ROOT, 'real-vite')).toBeNull();
  });

  it('does not reuse the same flattened deps after overrides, section, or text drift', async () => {
    for (const drifted of [
      JSON.stringify({
        name: 'app',
        dependencies: { vite: '^5.4.0' },
        overrides: { picocolors: '1.1.1' },
      }),
      JSON.stringify({ name: 'app', devDependencies: { vite: '^5.4.0' } }),
      '{ "name": "app", "dependencies": { "vite": "^5.4.0" } }',
    ]) {
      const vfs = new MemoryVfs();
      await seedProject(vfs);
      await seedNodeModules(vfs);
      await seedTrustedStamp(vfs, 14, 'real-vite');

      await vfs.writeFile(`${ROOT}/package.json`, drifted);

      expect(await installStampSatisfied(vfs, ROOT, 'real-vite')).toBeNull();
    }
  });

  it('does not reuse exact package.json text under a different install-artifact identity', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await seedTrustedStamp(vfs, 14, 'real-vite');
    const stamp = JSON.parse(await vfs.readFileText(installStampPath(ROOT))) as Record<
      string,
      unknown
    >;
    stamp.installArtifactIdentity = `sha256:${'0'.repeat(64)}`;
    await vfs.writeFile(installStampPath(ROOT), JSON.stringify(stamp));

    expect(await installStampSatisfied(vfs, ROOT, 'real-vite')).toBeNull();
  });

  it('treats schema v2 as a migration miss even when every old identity field matches', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await seedTrustedStamp(vfs, 14, 'real-vite');
    const legacy = JSON.parse(await vfs.readFileText(installStampPath(ROOT))) as Record<
      string,
      unknown
    >;
    legacy.version = 2;
    legacy.root = undefined;
    await vfs.writeFile(installStampPath(ROOT), JSON.stringify(legacy));

    expect(await readInstallStamp(vfs, ROOT)).toBeNull();
    expect(await installStampSatisfied(vfs, ROOT, 'real-vite')).toBeNull();
  });

  it.each([undefined, '/copied-workspace', '/workspace/.', 'workspace'])(
    'rejects a stamp whose embedded root is not this exact canonical location: %s',
    async (embeddedRoot) => {
      const vfs = new MemoryVfs();
      await seedProject(vfs);
      await seedNodeModules(vfs);
      await seedTrustedStamp(vfs, 14, 'real-vite');
      const stamp = JSON.parse(await vfs.readFileText(installStampPath(ROOT))) as Record<
        string,
        unknown
      >;
      stamp.root = embeddedRoot;
      await vfs.writeFile(installStampPath(ROOT), JSON.stringify(stamp));

      expect(await readInstallStamp(vfs, ROOT)).toBeNull();
      expect(await installStampSatisfied(vfs, ROOT, 'real-vite')).toBeNull();
    },
  );

  it('rejects an epoch on a trusted claim; epochs exist only while pending', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await seedTrustedStamp(vfs, 14, 'real-vite');
    const stamp = JSON.parse(await vfs.readFileText(installStampPath(ROOT))) as Record<
      string,
      unknown
    >;
    stamp.epoch = 'forged:1';
    await vfs.writeFile(installStampPath(ROOT), JSON.stringify(stamp));

    expect(await readInstallStamp(vfs, ROOT)).toBeNull();
    expect(await installStampSatisfied(vfs, ROOT, 'real-vite')).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
  ] as const)('rejects a pending claim with a %s epoch at every reader', async (_case, epoch) => {
    const packageJsonText = JSON.stringify({
      name: 'app',
      dependencies: { vite: '^5.4.0' },
    });
    expect(
      createInstallStamp(ROOT, packageJsonText, {
        slug: 'real-vite',
        packages: 14,
        durability: 'pending',
        epoch,
      }),
    ).toBeNull();

    const forged = {
      version: 4,
      root: ROOT,
      slug: 'real-vite',
      packageJsonText,
      installArtifactIdentity,
      deps: { vite: '^5.4.0' },
      packages: 14,
      durability: 'pending',
      ...(epoch === undefined ? {} : { epoch }),
    };
    const stampText = JSON.stringify(forged);
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await vfs.writeFile(installStampPath(ROOT), stampText);
    const enc = new TextEncoder();
    const fs: InstallStampSyncFs = {
      existsSync: (path) => path === installStampPath(ROOT),
      readFileBytesSync: () => enc.encode(stampText),
    };

    expect(parseInstallStamp(forged, ROOT)).toBeNull();
    await expect(readInstallStamp(vfs, ROOT)).resolves.toBeNull();
    expect(readInstallStampSync(fs, ROOT)).toBeNull();
  });

  it('does not construct a trusted claim with a pending-only epoch', () => {
    expect(
      createInstallStamp(ROOT, JSON.stringify({ name: 'app', dependencies: { vite: '^5.4.0' } }), {
        slug: 'real-vite',
        packages: 14,
        epoch: 'forged:1',
      }),
    ).toBeNull();
  });

  it.each(
    (['dependencies', 'devDependencies', 'optionalDependencies'] as const).flatMap((section) => [
      [`${section} with a non-string member`, JSON.stringify({ [section]: { vite: 42 } })],
      [`${section} with a non-object value`, JSON.stringify({ [section]: 'vite' })],
    ]),
  )('treats %s as a corrupt package request at every stamp boundary', async (_case, text) => {
    expect(effectiveDepsFromPackageJsonText(text)).toBeNull();
    expect(createInstallStamp(ROOT, text, { slug: 'real-vite', packages: 14 })).toBeNull();

    const forged = {
      version: 4,
      root: ROOT,
      slug: 'real-vite',
      packageJsonText: text,
      installArtifactIdentity,
      deps: {},
      packages: 14,
    };
    const stampText = JSON.stringify(forged);
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await vfs.writeFile(`${ROOT}/package.json`, text);
    await vfs.writeFile(installStampPath(ROOT), stampText);
    const files = new Map<string, string>([
      [`${ROOT}/package.json`, text],
      [installStampPath(ROOT), stampText],
    ]);
    const enc = new TextEncoder();
    const fs: InstallStampSyncFs = {
      existsSync: (path) => files.has(path) || path === `${ROOT}/node_modules`,
      readFileBytesSync: (path) => enc.encode(files.get(path) ?? ''),
    };
    const validTemplate = JSON.stringify({ dependencies: { vite: '^5.4.0' } });

    await expect(readEffectiveDeps(vfs, ROOT)).resolves.toBeNull();
    expect(parseInstallStamp(forged, ROOT)).toBeNull();
    await expect(readInstallStamp(vfs, ROOT)).resolves.toBeNull();
    expect(readInstallStampSync(fs, ROOT)).toBeNull();
    await expect(installStampSatisfied(vfs, ROOT, 'real-vite')).resolves.toBeNull();
    await expect(
      installStampSatisfiedForPackageJson(vfs, ROOT, 'real-vite', validTemplate),
    ).resolves.toBeNull();
    expect(
      installStampSatisfiedForPackageJsonSync(fs, ROOT, 'real-vite', validTemplate),
    ).toBeNull();
  });

  it.each([
    ['negative package count', 'packages', -1],
    ['fractional package count', 'packages', 1.5],
    ['unsafe package count', 'packages', Number.MAX_SAFE_INTEGER + 1],
    ['non-string dependency-map member', 'deps', { vite: '^5.4.0', malformed: 42 }],
  ] as const)('treats a v3 claim with %s as a miss', async (_case, field, value) => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await seedTrustedStamp(vfs, 14, 'real-vite');
    const stamp = JSON.parse(await vfs.readFileText(installStampPath(ROOT))) as Record<
      string,
      unknown
    >;
    stamp[field] = value;
    const stampText = JSON.stringify(stamp);
    await vfs.writeFile(installStampPath(ROOT), stampText);
    const enc = new TextEncoder();
    const fs: InstallStampSyncFs = {
      existsSync: (path) => path === installStampPath(ROOT),
      readFileBytesSync: () => enc.encode(stampText),
    };

    expect(parseInstallStamp(stamp, ROOT)).toBeNull();
    await expect(readInstallStamp(vfs, ROOT)).resolves.toBeNull();
    expect(readInstallStampSync(fs, ROOT)).toBeNull();
    await expect(installStampSatisfied(vfs, ROOT, 'real-vite')).resolves.toBeNull();
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'does not construct a v3 claim with package count %s',
    (packages) => {
      expect(
        createInstallStamp(
          ROOT,
          JSON.stringify({ name: 'app', dependencies: { vite: '^5.4.0' } }),
          { slug: 'real-vite', packages },
        ),
      ).toBeNull();
    },
  );

  it('is not satisfied for a different template package.json under the same slug', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs, {
      name: 'app',
      dependencies: { vite: '^7.0.0' },
    });
    await seedNodeModules(vfs);
    await seedTrustedStamp(vfs, 12, 'scratch');

    const typescriptPackageJson = JSON.stringify({
      name: 'app',
      dependencies: { vite: '^7.0.0' },
      devDependencies: { typescript: '5.9.3' },
    });

    expect(
      await installStampSatisfiedForPackageJson(vfs, ROOT, 'scratch', typescriptPackageJson),
    ).toBeNull();
  });

  it('is satisfied when a stamped package.json keeps template deps plus user deps', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs, {
      name: 'app',
      dependencies: { vite: '^7.0.0', cowsay: '^1.6.0' },
    });
    await seedNodeModules(vfs);
    await seedTrustedStamp(vfs, 20, 'scratch');

    const templatePackageJson = JSON.stringify({
      name: 'app',
      dependencies: { vite: '^7.0.0' },
    });

    expect(
      (await installStampSatisfiedForPackageJson(vfs, ROOT, 'scratch', templatePackageJson))
        ?.packages,
    ).toBe(20);
  });

  it('is not satisfied without node_modules, without a stamp, or without package.json', async () => {
    const noNodeModules = new MemoryVfs();
    await seedProject(noNodeModules);
    await noNodeModules.mkdir(`${ROOT}/node_modules`, { recursive: true });
    await seedTrustedStamp(noNodeModules, 1);
    await noNodeModules.rm(`${ROOT}/node_modules`, { recursive: true, force: true });
    expect(await installStampSatisfied(noNodeModules, ROOT)).toBeNull();

    const noStamp = new MemoryVfs();
    await seedProject(noStamp);
    await seedNodeModules(noStamp);
    expect(await installStampSatisfied(noStamp, ROOT)).toBeNull();

    const noPackageJson = new MemoryVfs();
    await seedProject(noPackageJson);
    await seedNodeModules(noPackageJson);
    await seedTrustedStamp(noPackageJson, 1);
    await noPackageJson.rm(`${ROOT}/package.json`, { force: true });
    expect(await installStampSatisfied(noPackageJson, ROOT)).toBeNull();
  });

  it('treats a malformed stamp or malformed package.json as no stamp', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await vfs.writeFile(installStampPath(ROOT), 'not json');
    expect(await readInstallStamp(vfs, ROOT)).toBeNull();
    expect(await installStampSatisfied(vfs, ROOT)).toBeNull();

    await vfs.writeFile(`${ROOT}/package.json`, '[]');
    expect(await readEffectiveDeps(vfs, ROOT)).toBeNull();
  });

  it('compares dep maps by entries, ignoring key order', () => {
    expect(depsEqual({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
    expect(depsEqual({ a: '1' }, { a: '2' })).toBe(false);
    expect(depsEqual({ a: '1' }, { a: '1', b: '2' })).toBe(false);
  });

  it('installStampSatisfiedForPackageJsonSync mirrors the async predicate (owner-boot prefetch gate)', async () => {
    // The sync twin exists so the eddy prefetch gate never awaits (an async
    // gate starves behind the busy boot loop, ADR-0195). Same verdicts as the
    // async predicate over the same tree.
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await seedTrustedStamp(vfs, 14, 'scratch');
    // Structural sync fake over the SAME file contents:
    const files = new Map<string, string>();
    files.set(
      `${ROOT}/package.json`,
      JSON.stringify({ name: 'app', dependencies: { vite: '^5.4.0' } }),
    );
    files.set(installStampPath(ROOT), await vfs.readFileText(installStampPath(ROOT)));
    const enc = new TextEncoder();
    const fs: InstallStampSyncFs = {
      existsSync: (path) => files.has(path) || path === `${ROOT}/node_modules`,
      readFileBytesSync: (path) => enc.encode(files.get(path) ?? ''),
    };
    const pkgText = JSON.stringify({ name: 'app', dependencies: { vite: '^5.4.0' } });
    expect(installStampSatisfiedForPackageJsonSync(fs, ROOT, 'scratch', pkgText)?.packages).toBe(
      14,
    );
    expect(
      installStampSatisfiedForPackageJsonSync(fs, `${ROOT}/.`, 'scratch', pkgText)?.packages,
    ).toBe(14);
    // Wrong slug / drifted template deps → null, same as the async predicate.
    expect(installStampSatisfiedForPackageJsonSync(fs, ROOT, 'other', pkgText)).toBeNull();
    expect(
      installStampSatisfiedForPackageJsonSync(
        fs,
        ROOT,
        'scratch',
        JSON.stringify({ dependencies: { vite: '^6.0.0' } }),
      ),
    ).toBeNull();
    expect(await installStampSatisfiedForPackageJson(vfs, ROOT, 'scratch', pkgText)).not.toBeNull();

    const copiedClaim = JSON.parse(files.get(installStampPath(ROOT)) ?? '{}') as Record<
      string,
      unknown
    >;
    copiedClaim.root = '/copied-workspace';
    files.set(installStampPath(ROOT), JSON.stringify(copiedClaim));
    expect(installStampSatisfiedForPackageJsonSync(fs, ROOT, 'scratch', pkgText)).toBeNull();

    await seedPendingStamp(vfs, 14, 'scratch');
    files.set(installStampPath(ROOT), await vfs.readFileText(installStampPath(ROOT)));
    expect(installStampSatisfiedForPackageJsonSync(fs, ROOT, 'scratch', pkgText)).toBeNull();
  });
});
