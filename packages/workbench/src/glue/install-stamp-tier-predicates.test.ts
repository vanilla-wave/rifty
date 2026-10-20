import { syncMirror } from '@riftydev/vfs';
import { MemoryFsSync, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it } from 'vitest';
import { createInstallStampAuthority } from './install-stamp-authority.ts';
import {
  installStampSatisfied,
  installStampSatisfiedForPackageJson,
  installStampSatisfiedForPackageJsonSync,
} from './install-stamp.ts';
import { SyncMirrorVfs } from './sync-mirror-vfs.ts';

const priorMirror = syncMirror();
afterEach(() => setSyncMirror(priorMirror));

it.each(['coi', 'no-coi'] as const)(
  'all reuse predicates honor the selected %s policy',
  async (runtimeTier) => {
    const fs = new MemoryFsSync();
    const root = '/project';
    const manifest = '{"dependencies":{"fixture":"1.0.0"}}';
    fs.loadFixture({
      '/project/package.json': manifest,
      '/project/package-lock.json': '{"lockfileVersion":3}',
      '/project/node_modules/fixture/index.js': 'module.exports = 42;',
    });
    setSyncMirror(fs);
    const vfs = new SyncMirrorVfs();
    const authority = createInstallStampAuthority({ vfs, fsSync: fs, runtimeTier });
    const token = await authority.demote({ root, slug: 'fixture' });
    const result = await authority.promote(
      { root, slug: 'fixture', packageJsonText: manifest },
      { epoch: token.epoch, packages: 1 },
    );
    expect(result.status).toBe('trusted');
    const read = async (tier: 'coi' | 'no-coi') => [
      await installStampSatisfied(vfs, root, 'fixture', tier),
      await installStampSatisfiedForPackageJson(vfs, root, 'fixture', manifest, tier),
      installStampSatisfiedForPackageJsonSync(fs, root, 'fixture', manifest, tier),
    ];
    expect((await read(runtimeTier)).map((value) => value?.slug)).toEqual([
      'fixture',
      'fixture',
      'fixture',
    ]);
    expect(await read(runtimeTier === 'coi' ? 'no-coi' : 'coi')).toEqual([null, null, null]);
    fs.writeFileSync(
      '/project/package-lock.json',
      new TextEncoder().encode('{"lockfileVersion":3,"changed":true}'),
    );
    expect(await read(runtimeTier)).toEqual([null, null, null]);
  },
);
