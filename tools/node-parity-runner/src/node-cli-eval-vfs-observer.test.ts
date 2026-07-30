import { describe, expect, it } from 'vitest';
import { NodeCliEvalVfsObserver, nodeCliEvalVfsFileContent } from './node-cli-eval-vfs-observer.ts';

describe('NodeCliEvalVfsObserver', () => {
  it('subtracts exact guest effects without hiding a transient carrier', () => {
    const fs = new NodeCliEvalVfsObserver();
    fs.loadFixture({ '/marker.cjs': "module.exports='marker'\n" });
    fs.startObservation();

    fs.writeFileSync('/.rifty-eval-transient.cjs', new TextEncoder().encode('source'));
    fs.rmSync('/.rifty-eval-transient.cjs', { force: true });
    fs.writeFileSync('/guest-authored.txt', new TextEncoder().encode('guest'));

    expect(fs.existsSync('/.rifty-eval-transient.cjs')).toBe(false);
    expect(new TextDecoder().decode(fs.readFileBytesSync('/guest-authored.txt'))).toBe('guest');
    expect(
      fs.audit([
        {
          kind: 'write',
          path: '/guest-authored.txt',
          content: nodeCliEvalVfsFileContent('/guest-authored.txt', 'guest'),
        },
      ]),
    ).toEqual({
      missing: [],
      unexpected: [
        {
          kind: 'write',
          path: '/.rifty-eval-transient.cjs',
          content: nodeCliEvalVfsFileContent('/.rifty-eval-transient.cjs', 'source'),
        },
        {
          kind: 'rm',
          path: '/.rifty-eval-transient.cjs',
          recursive: false,
          force: true,
        },
      ],
    });
  });

  it('does not let same-path carrier bytes satisfy a missing guest write', () => {
    const fs = new NodeCliEvalVfsObserver();
    fs.startObservation();

    fs.writeFileSync('/shared.txt', new TextEncoder().encode('carrier'));

    expect(
      fs.audit([
        {
          kind: 'write',
          path: '/shared.txt',
          content: nodeCliEvalVfsFileContent('/shared.txt', 'guest'),
        },
      ]),
    ).toEqual({
      missing: [
        {
          kind: 'write',
          path: '/shared.txt',
          content: nodeCliEvalVfsFileContent('/shared.txt', 'guest'),
        },
      ],
      unexpected: [
        {
          kind: 'write',
          path: '/shared.txt',
          content: nodeCliEvalVfsFileContent('/shared.txt', 'carrier'),
        },
      ],
    });
  });

  it('keeps a missing declared guest effect loud', () => {
    const fs = new NodeCliEvalVfsObserver();
    fs.startObservation();

    const missingWrite = {
      kind: 'write' as const,
      path: '/missing.txt',
      content: nodeCliEvalVfsFileContent('/missing.txt', 'missing'),
    };
    expect(fs.audit([missingWrite])).toEqual({
      missing: [missingWrite],
      unexpected: [],
    });
  });

  it('pins arguments and resulting bytes for every mutator', () => {
    const fs = new NodeCliEvalVfsObserver();
    fs.loadFixture({
      '/copy-source.txt': 'copy-source',
      '/copy-tree/nested.txt': 'copy-tree',
      '/rename-source.txt': 'rename-source',
      '/remove.txt': 'remove',
      '/stamp.txt': 'stamp',
    });
    fs.startObservation();

    fs.writeFileSync('/write.txt', new TextEncoder().encode('write'));
    fs.mkdirSync('/made', { recursive: true });
    fs.utimes('/stamp.txt', 11, 22);
    fs.copyFileSync('/copy-source.txt', '/copied.txt');
    fs.cpSync('/copy-tree', '/copied-tree', { recursive: true });
    fs.renameSync('/rename-source.txt', '/renamed.txt');
    fs.rmSync('/remove.txt', { recursive: false, force: true });

    expect(fs.mutations()).toEqual([
      {
        kind: 'write',
        path: '/write.txt',
        content: nodeCliEvalVfsFileContent('/write.txt', 'write'),
      },
      { kind: 'mkdir', path: '/made', recursive: true },
      { kind: 'utimes', path: '/stamp.txt', atimeMs: 11, mtimeMs: 22 },
      {
        kind: 'copy',
        operation: 'copyFileSync',
        path: '/copy-source.txt',
        targetPath: '/copied.txt',
        recursive: false,
        content: nodeCliEvalVfsFileContent('/copied.txt', 'copy-source'),
      },
      {
        kind: 'copy',
        operation: 'cpSync',
        path: '/copy-tree',
        targetPath: '/copied-tree',
        recursive: true,
        content: [
          { kind: 'directory', path: '/copied-tree' },
          ...nodeCliEvalVfsFileContent('/copied-tree/nested.txt', 'copy-tree'),
        ],
      },
      {
        kind: 'rename',
        path: '/rename-source.txt',
        targetPath: '/renamed.txt',
        content: nodeCliEvalVfsFileContent('/renamed.txt', 'rename-source'),
      },
      { kind: 'rm', path: '/remove.txt', recursive: false, force: true },
    ]);
  });
});
