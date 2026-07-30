import { describe, expect, it } from 'vitest';
import { NodeCliEvalVfsObserver, nodeCliEvalVfsFileContent } from './node-cli-eval-vfs-observer.ts';

describe('NodeCliEvalVfsObserver', () => {
  it('subtracts exact guest effects without hiding a transient carrier', () => {
    const fs = new NodeCliEvalVfsObserver();
    fs.loadFixture({ '/marker.cjs': "module.exports='marker'\n" });
    fs.startObservation();

    fs.beginCarrierObservation('sab-remote');
    fs.writeFileSync('/.rifty-eval-transient.cjs', new TextEncoder().encode('source'));
    fs.rmSync('/.rifty-eval-transient.cjs', { force: true });
    fs.endCarrierObservation();
    fs.writeFileSync('/guest-authored.txt', new TextEncoder().encode('guest'));

    expect(fs.existsSync('/.rifty-eval-transient.cjs')).toBe(false);
    expect(new TextDecoder().decode(fs.readFileBytesSync('/guest-authored.txt'))).toBe('guest');
    expect(
      fs.audit([
        {
          kind: 'write',
          provenance: 'guest',
          actor: 'workbench-owner',
          path: '/guest-authored.txt',
          content: nodeCliEvalVfsFileContent('/guest-authored.txt', 'guest'),
        },
      ]),
    ).toEqual({
      missing: [],
      unexpected: [
        {
          kind: 'write',
          provenance: 'carrier',
          actor: 'sab-remote',
          path: '/.rifty-eval-transient.cjs',
          content: nodeCliEvalVfsFileContent('/.rifty-eval-transient.cjs', 'source'),
        },
        {
          kind: 'rm',
          provenance: 'carrier',
          actor: 'sab-remote',
          path: '/.rifty-eval-transient.cjs',
          recursive: false,
          force: true,
        },
      ],
    });
  });

  it('does not let byte-identical same-path carrier work satisfy an omitted guest effect', () => {
    const fs = new NodeCliEvalVfsObserver();
    fs.startObservation();

    fs.beginCarrierObservation('sab-remote');
    fs.writeFileSync('/shared.txt', new TextEncoder().encode('same'));
    fs.rmSync('/shared.txt', { force: true });
    fs.endCarrierObservation();

    expect(
      fs.audit([
        {
          kind: 'write',
          provenance: 'guest',
          actor: 'workbench-owner',
          path: '/shared.txt',
          content: nodeCliEvalVfsFileContent('/shared.txt', 'same'),
        },
        {
          kind: 'rm',
          provenance: 'guest',
          actor: 'workbench-owner',
          path: '/shared.txt',
          recursive: false,
          force: true,
        },
      ]),
    ).toEqual({
      missing: [
        {
          kind: 'write',
          provenance: 'guest',
          actor: 'workbench-owner',
          path: '/shared.txt',
          content: nodeCliEvalVfsFileContent('/shared.txt', 'same'),
        },
        {
          kind: 'rm',
          provenance: 'guest',
          actor: 'workbench-owner',
          path: '/shared.txt',
          recursive: false,
          force: true,
        },
      ],
      unexpected: [
        {
          kind: 'write',
          provenance: 'carrier',
          actor: 'sab-remote',
          path: '/shared.txt',
          content: nodeCliEvalVfsFileContent('/shared.txt', 'same'),
        },
        {
          kind: 'rm',
          provenance: 'carrier',
          actor: 'sab-remote',
          path: '/shared.txt',
          recursive: false,
          force: true,
        },
      ],
    });
  });

  it('keeps a missing declared guest effect loud', () => {
    const fs = new NodeCliEvalVfsObserver();
    fs.startObservation();

    const missingWrite = {
      kind: 'write' as const,
      provenance: 'guest' as const,
      actor: 'workbench-owner' as const,
      path: '/missing.txt',
      content: nodeCliEvalVfsFileContent('/missing.txt', 'missing'),
    };
    expect(fs.audit([missingWrite])).toEqual({
      missing: [missingWrite],
      unexpected: [],
    });
  });

  it('rejects incomplete carrier boundaries and carrier-owned expectations', () => {
    const fs = new NodeCliEvalVfsObserver();
    fs.startObservation();
    fs.beginCarrierObservation('sab-remote');

    expect(() => fs.audit([])).toThrow(
      'node-cli-eval VFS carrier observation did not reach its physical boundary',
    );

    fs.endCarrierObservation();
    expect(() =>
      fs.audit([
        {
          kind: 'rm',
          provenance: 'carrier',
          actor: 'sab-remote',
          path: '/carrier.txt',
          recursive: false,
          force: true,
        },
      ]),
    ).toThrow('node-cli-eval expected mutations must be workbench-owner guest mutations');
  });

  it('keeps ordinary bootstrap work attributed to the observed child after a carrier phase', () => {
    const fs = new NodeCliEvalVfsObserver();
    fs.startObservation('child-local');
    fs.beginCarrierObservation('child-local');
    fs.writeFileSync('/carrier.cjs', new TextEncoder().encode('same-source'));
    fs.rmSync('/carrier.cjs', { force: true });
    fs.endCarrierObservation();
    fs.writeFileSync('/bootstrap-local.cjs', new TextEncoder().encode('same-source'));

    expect(fs.audit([])).toEqual({
      missing: [],
      unexpected: [
        {
          kind: 'write',
          provenance: 'carrier',
          actor: 'child-local',
          path: '/carrier.cjs',
          content: nodeCliEvalVfsFileContent('/carrier.cjs', 'same-source'),
        },
        {
          kind: 'rm',
          provenance: 'carrier',
          actor: 'child-local',
          path: '/carrier.cjs',
          recursive: false,
          force: true,
        },
        {
          kind: 'write',
          provenance: 'guest',
          actor: 'child-local',
          path: '/bootstrap-local.cjs',
          content: nodeCliEvalVfsFileContent('/bootstrap-local.cjs', 'same-source'),
        },
      ],
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
        provenance: 'guest',
        actor: 'workbench-owner',
        path: '/write.txt',
        content: nodeCliEvalVfsFileContent('/write.txt', 'write'),
      },
      {
        kind: 'mkdir',
        provenance: 'guest',
        actor: 'workbench-owner',
        path: '/made',
        recursive: true,
      },
      {
        kind: 'utimes',
        provenance: 'guest',
        actor: 'workbench-owner',
        path: '/stamp.txt',
        atimeMs: 11,
        mtimeMs: 22,
      },
      {
        kind: 'copy',
        provenance: 'guest',
        actor: 'workbench-owner',
        operation: 'copyFileSync',
        path: '/copy-source.txt',
        targetPath: '/copied.txt',
        recursive: false,
        content: nodeCliEvalVfsFileContent('/copied.txt', 'copy-source'),
      },
      {
        kind: 'copy',
        provenance: 'guest',
        actor: 'workbench-owner',
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
        provenance: 'guest',
        actor: 'workbench-owner',
        path: '/rename-source.txt',
        targetPath: '/renamed.txt',
        content: nodeCliEvalVfsFileContent('/renamed.txt', 'rename-source'),
      },
      {
        kind: 'rm',
        provenance: 'guest',
        actor: 'workbench-owner',
        path: '/remove.txt',
        recursive: false,
        force: true,
      },
    ]);
  });
});
