import type { FsOpsTarget } from '@riftydev/workbench';
import { describe, expect, it } from 'vitest';
import { batchUploadWrites, planDragMove, planUploadFiles } from './file-manager-dnd.ts';

class FakeFs implements Pick<FsOpsTarget, 'existsSync'> {
  readonly paths = new Set<string>();

  constructor(paths: readonly string[]) {
    for (const path of paths) this.paths.add(path);
  }

  existsSync(path: string): boolean {
    return this.paths.has(path);
  }
}

describe('file manager drag/drop planning', () => {
  it('plans atomic rename moves into the drop target with collision copy names', () => {
    const fs = new FakeFs(['/workspace/src/a.ts', '/workspace/lib/a.ts']);

    expect(planDragMove(fs, ['/workspace/src/a.ts'], '/workspace/lib')).toEqual([
      { kind: 'rename', from: '/workspace/src/a.ts', to: '/workspace/lib/a copy.ts' },
    ]);
  });

  it('skips same-directory moves and rejects moving a directory into itself', () => {
    const fs = new FakeFs(['/workspace/src/a.ts', '/workspace/src']);

    expect(planDragMove(fs, ['/workspace/src/a.ts'], '/workspace/src')).toEqual([]);
    expect(() => planDragMove(fs, ['/workspace/src'], '/workspace/src/nested')).toThrow(
      /into itself/,
    );
  });

  it('plans OS file uploads without clobbering existing names or batch reservations', () => {
    const fs = new FakeFs(['/workspace/public/logo.png', '/workspace/public/logo copy.png']);

    expect(
      planUploadFiles(
        fs,
        [{ name: 'logo.png' }, { name: 'logo.png' }, { name: 'main.js' }],
        '/workspace/public',
      ),
    ).toEqual([
      { name: 'logo.png', to: '/workspace/public/logo copy 2.png' },
      { name: 'logo.png', to: '/workspace/public/logo copy 3.png' },
      { name: 'main.js', to: '/workspace/public/main.js' },
    ]);
  });

  it('rejects folder-like upload entries instead of faking a partial import', () => {
    const fs = new FakeFs([]);

    expect(() =>
      planUploadFiles(fs, [{ name: 'nested/file.txt', webkitRelativePath: '' }], '/workspace'),
    ).toThrow(/folder drops are unsupported/);
    expect(() =>
      planUploadFiles(
        fs,
        [{ name: 'file.txt', webkitRelativePath: 'folder/file.txt' }],
        '/workspace',
      ),
    ).toThrow(/folder drops are unsupported/);
  });

  it('batches large multi-select uploads into bounded coalesced write groups', () => {
    const entries = [
      { path: '/workspace/a.bin', data: new Uint8Array(4), recursive: true },
      { path: '/workspace/b.bin', data: new Uint8Array(4), recursive: true },
      { path: '/workspace/c.bin', data: new Uint8Array(4), recursive: true },
      { path: '/workspace/d.bin', data: new Uint8Array(9), recursive: true },
    ];

    expect(batchUploadWrites(entries, { maxFiles: 3, maxBytes: 10 })).toEqual([
      [entries[0], entries[1]],
      [entries[2]],
      [entries[3]],
    ]);
  });
});
