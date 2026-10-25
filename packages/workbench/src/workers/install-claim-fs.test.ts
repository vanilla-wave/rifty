import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { installStampPath } from '../glue/install-stamp.ts';
import { createInstallClaimFs } from './install-claim-fs.ts';

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('install claim guarded filesystem', () => {
  it('loads real fixture bytes and preflights reserved ingress before writing a batch', () => {
    const { fs } = createInstallClaimFs(new MemoryFsSync());
    fs.loadFixture({ '/project/source.js': 'saved' });
    expect(decode(fs.readFileBytesSync('/project/source.js'))).toBe('saved');
    expect(() =>
      fs.loadFixture({ '/project/source.js': 'replaced', [installStampPath('/project')]: '{}' }),
    ).toThrow(/reserved/);
    expect(decode(fs.readFileBytesSync('/project/source.js'))).toBe('saved');
  });

  it('keeps claims privileged and read aliases cannot change their bytes', () => {
    const { fs, claims } = createInstallClaimFs(new MemoryFsSync());
    claims.write('/project', encode('claim'), { mkdirTree: true });
    fs.readFileBytesSync(installStampPath('/project')).fill(0);
    expect(decode(claims.read('/project')!)).toBe('claim');
    expect(() => fs.writeFileSync(installStampPath('/project'), encode('forged'))).toThrow(
      /reserved/,
    );
    expect(() => fs.rmSync('/project', { recursive: true })).toThrow(/reserved/);
    expect(() => fs.renameSync('/project', '/moved')).toThrow(/reserved/);
  });

  it('ordinary recursive copy excludes claims while preserving dependency edits and extra files', () => {
    const { fs, claims } = createInstallClaimFs(new MemoryFsSync());
    claims.write('/project', encode('claim'), { mkdirTree: true });
    fs.loadFixture({
      '/project/node_modules/package/edited.js': 'edited',
      '/project/node_modules/package/extra.js': 'extra',
    });
    fs.cpSync('/project', '/copy', { recursive: true });
    expect(fs.existsSync(installStampPath('/copy'))).toBe(false);
    expect(decode(fs.readFileBytesSync('/copy/node_modules/package/edited.js'))).toBe('edited');
    expect(decode(fs.readFileBytesSync('/copy/node_modules/package/extra.js'))).toBe('extra');
  });
});
