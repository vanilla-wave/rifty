import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import {
  type InstallStampSyncFs,
  depsEqual,
  installStampPath,
  installStampSatisfied,
  installStampSatisfiedForPackageJson,
  installStampSatisfiedForPackageJsonSync,
  readEffectiveDeps,
  readInstallStamp,
  restampSlug,
  writeInstallStamp,
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

    await writeInstallStamp(vfs, ROOT, 14, 'real-vite');
    const stamp = await readInstallStamp(vfs, ROOT);

    expect(stamp).toEqual({
      version: 1,
      slug: 'real-vite',
      deps: { vite: '^5.4.0', tool: '1.0.0', fsevents: '^2' },
      packages: 14,
    });
    expect(await vfs.exists(installStampPath(ROOT))).toBe(true);
  });

  it('is satisfied when the slug + deps match and node_modules exists', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await writeInstallStamp(vfs, ROOT, 14, 'real-vite');

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

  it('reads pending stamps but never satisfies reuse from them', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await writeInstallStamp(vfs, ROOT, 14, 'real-vite', 'pending');

    expect(await readInstallStamp(vfs, ROOT)).toEqual({
      version: 1,
      slug: 'real-vite',
      deps: { vite: '^5.4.0' },
      packages: 14,
      durability: 'pending',
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
    await writeInstallStamp(vfs, ROOT, 8, 'project-files');

    expect(await installStampSatisfied(vfs, ROOT, 'real-vite')).toBeNull();
    expect((await installStampSatisfied(vfs, ROOT, 'project-files'))?.packages).toBe(8);
  });

  it('is not satisfied when package.json deps drift after stamping', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await writeInstallStamp(vfs, ROOT, 14, 'real-vite');

    await seedProject(vfs, {
      name: 'app',
      dependencies: { vite: '^5.4.0', lodash: '^4' },
    });
    expect(await installStampSatisfied(vfs, ROOT, 'real-vite')).toBeNull();
  });

  it('is not satisfied for a different template package.json under the same slug', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs, {
      name: 'app',
      dependencies: { vite: '^7.0.0' },
    });
    await seedNodeModules(vfs);
    await writeInstallStamp(vfs, ROOT, 12, 'scratch');

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
    await writeInstallStamp(vfs, ROOT, 20, 'scratch');

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
    await writeInstallStamp(noNodeModules, ROOT, 1);
    await noNodeModules.rm(`${ROOT}/node_modules`, { recursive: true, force: true });
    expect(await installStampSatisfied(noNodeModules, ROOT)).toBeNull();

    const noStamp = new MemoryVfs();
    await seedProject(noStamp);
    await seedNodeModules(noStamp);
    expect(await installStampSatisfied(noStamp, ROOT)).toBeNull();

    const noPackageJson = new MemoryVfs();
    await seedProject(noPackageJson);
    await seedNodeModules(noPackageJson);
    await writeInstallStamp(noPackageJson, ROOT, 1);
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

  it('restampSlug rewrites the slug of a moved tree without re-reading deps', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await writeInstallStamp(vfs, ROOT, 14, 'scratch');

    await restampSlug(vfs, ROOT, 'proj-1');

    const stamp = await readInstallStamp(vfs, ROOT);
    expect(stamp?.slug).toBe('proj-1');
    expect(stamp?.deps).toEqual({ vite: '^5.4.0' }); // deps unchanged by the rename
    expect((await installStampSatisfied(vfs, ROOT, 'proj-1'))?.packages).toBe(14);
    expect(await installStampSatisfied(vfs, ROOT, 'scratch')).toBeNull();
  });

  it('restampSlug is a no-op when there is no stamp (best-effort)', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await restampSlug(vfs, ROOT, 'proj-1'); // does not throw
    expect(await readInstallStamp(vfs, ROOT)).toBeNull();
  });

  it('installStampSatisfiedForPackageJsonSync mirrors the async predicate (owner-boot prefetch gate)', async () => {
    // The sync twin exists so the eddy prefetch gate never awaits (an async
    // gate starves behind the busy boot loop, ADR-0195). Same verdicts as the
    // async predicate over the same tree.
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    await seedNodeModules(vfs);
    await writeInstallStamp(vfs, ROOT, 14, 'scratch');
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

    await writeInstallStamp(vfs, ROOT, 14, 'scratch', 'pending');
    files.set(installStampPath(ROOT), await vfs.readFileText(installStampPath(ROOT)));
    expect(installStampSatisfiedForPackageJsonSync(fs, ROOT, 'scratch', pkgText)).toBeNull();
  });
});
