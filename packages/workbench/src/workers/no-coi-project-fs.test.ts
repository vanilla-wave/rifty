import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createInstallClaimFs } from './install-claim-fs.ts';
import { createNoCoiProjectFs } from './no-coi-project-fs.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function setup() {
  const raw = new MemoryFsSync();
  raw.mkdirSync('/project/protected', { recursive: true });
  raw.mkdirSync('/outside', {});
  raw.writeFileSync('/project/protected/source', encoder.encode('protected'));
  return { raw, project: createNoCoiProjectFs(raw) };
}

describe('permanent no-COI project filesystem policy', () => {
  it('preserves VFS-rooted absolute paths and the permanent wrapper identity', () => {
    const { raw, project } = setup();
    const captured = project.fs;
    const restore = project.activate({ root: '/project', readonlyPaths: ['/project/protected'] });
    captured.writeFileSync('/outside/file', encoder.encode('absolute'));
    expect(decoder.decode(raw.readFileBytesSync('/outside/file'))).toBe('absolute');
    expect(project.effects()).toBe('yes');
    expect(() => captured.writeFileSync('relative', encoder.encode('invalid'))).toThrow();
    restore();
    expect(project.fs).toBe(captured);
    captured.writeFileSync('/project/protected/source', encoder.encode('restored'));
    expect(decoder.decode(raw.readFileBytesSync('/project/protected/source'))).toBe('restored');
  });

  it('rejects readonly mutations before effects, including destructive ancestors', () => {
    const { raw, project } = setup();
    project.activate({ root: '/project', readonlyPaths: ['/project/protected'] });
    const mutations = [
      () => project.fs.writeFileSync('/project/protected/source', encoder.encode('bad')),
      () => project.fs.mkdirSync('/project/protected/new', {}),
      () => project.fs.utimes('/project/protected/source', 1, 2),
      () => project.fs.rmSync('/project', { recursive: true }),
      () => project.fs.renameSync('/project', '/renamed'),
      () => project.fs.renameSync('/outside', '/project'),
      () => project.fs.copyFileSync('/project/protected/source', '/project/protected/copy'),
      () => project.fs.cpSync('/outside', '/project', { recursive: true }),
    ];
    for (const mutate of mutations) {
      expect(mutate).toThrowError(expect.objectContaining({ code: 'EROFS' }));
      expect(project.effects()).toBe('no');
    }
    expect(decoder.decode(raw.readFileBytesSync('/project/protected/source'))).toBe('protected');
    expect(raw.existsSync('/renamed')).toBe(false);
    expect(raw.existsSync('/project/protected/new')).toBe(false);
  });

  it('permits reads and copying a protected source into a writable destination', () => {
    const { raw, project } = setup();
    project.activate({ root: '/project', readonlyPaths: ['/project/protected'] });
    const read = project.fs.readFileBytesSync('/project/protected/source');
    read.fill(0);
    expect(decoder.decode(raw.readFileBytesSync('/project/protected/source'))).toBe('protected');
    project.fs.copyFileSync('/project/protected/source', '/outside/copy');
    expect(decoder.decode(raw.readFileBytesSync('/outside/copy'))).toBe('protected');
    expect(project.effects()).toBe('yes');
  });

  it('detaches write input bytes from the authoritative memory tree', () => {
    const { raw, project } = setup();
    project.activate({ root: '/project' });
    const bytes = encoder.encode('keep');
    project.fs.writeFileSync('/project/file', bytes);
    bytes.fill(0);
    expect(decoder.decode(raw.readFileBytesSync('/project/file'))).toBe('keep');
  });

  it('resets invocation effects and keeps an underlying apply failure uncertain', () => {
    const { project } = setup();
    const first = project.activate({ root: '/project' });
    project.fs.writeFileSync('/project/file', encoder.encode('first'));
    expect(project.effects()).toBe('yes');
    first();
    const second = project.activate({ root: '/project' });
    expect(project.effects()).toBe('no');
    expect(() => project.fs.renameSync('/missing', '/target')).toThrow();
    expect(project.effects()).toBe('unknown');
    second();
    expect(project.effects()).toBe('unknown');
  });

  it('copies policy inputs and rejects malformed roots or readonly paths', () => {
    const { project } = setup();
    const readonlyPaths = ['/project/protected'];
    const restore = project.activate({ root: '/project', readonlyPaths });
    readonlyPaths.length = 0;
    expect(() => project.fs.rmSync('/project/protected', { recursive: true })).toThrow();
    restore();
    for (const root of ['relative', '/project/..', '/bad\0name']) {
      expect(() => project.activate({ root })).toThrow(TypeError);
    }
    expect(() => project.activate({ root: '/project', readonlyPaths: ['relative'] })).toThrow(
      TypeError,
    );
    expect(() =>
      project.activate({ root: '/project', readonlyPaths: new Array<string>(1) }),
    ).toThrow(TypeError);
  });

  it('preflights fixture writes and preserves the inner install-claim authority', () => {
    const { raw } = setup();
    const claims = createInstallClaimFs(raw);
    const project = createNoCoiProjectFs(claims.fs);
    const restore = project.activate({ root: '/project', readonlyPaths: ['/project/protected'] });
    expect(() =>
      project.fs.loadFixture({ '/project/first': 'first', '/project/protected/second': 'bad' }),
    ).toThrow();
    expect(raw.existsSync('/project/first')).toBe(false);
    expect(project.effects()).toBe('no');
    restore();
    expect(() =>
      project.fs.writeFileSync(
        '/project/node_modules/.rifty-install-stamp.json',
        encoder.encode('bad'),
      ),
    ).toThrow();
  });

  it('delegates the same persistence report and fence to the existing owner', async () => {
    const { raw } = setup();
    const report = {
      total: 1,
      failures: [{ path: '/project/file', op: 'write' as const, message: 'quota' }],
    };
    let fenced = 0;
    const persisted = Object.assign(raw, {
      flush: async () => report,
      fence: async () => {
        fenced += 1;
      },
    });
    const project = createNoCoiProjectFs(persisted);
    await expect(project.fs.flush?.()).resolves.toBe(report);
    await project.fs.fence?.();
    expect(fenced).toBe(1);
  });
});
