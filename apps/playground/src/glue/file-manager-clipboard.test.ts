import { describe, expect, it } from 'vitest';
import { planClipboardPaste } from './file-manager-clipboard.ts';
import type { FsOpsTarget } from './fs-ops.ts';

class FakeFs implements Pick<FsOpsTarget, 'existsSync'> {
  readonly paths = new Set<string>();

  constructor(paths: readonly string[]) {
    for (const path of paths) this.paths.add(path);
  }

  existsSync(path: string): boolean {
    return this.paths.has(path);
  }
}

describe('file manager clipboard paste planning', () => {
  it('copies into the selected directory and VS Code-renames collisions', () => {
    const fs = new FakeFs([
      '/workspace/src/a.ts',
      '/workspace/lib/a.ts',
      '/workspace/lib/a copy.ts',
    ]);

    expect(
      planClipboardPaste(fs, { paths: ['/workspace/src/a.ts'], mode: 'copy' }, '/workspace/lib'),
    ).toEqual({
      actions: [{ kind: 'copy', from: '/workspace/src/a.ts', to: '/workspace/lib/a copy 2.ts' }],
      clearAfter: false,
    });
  });

  it('reserves names inside one paste batch', () => {
    const fs = new FakeFs(['/workspace/a.ts', '/workspace/other/a.ts']);

    expect(
      planClipboardPaste(
        fs,
        { paths: ['/workspace/a.ts', '/workspace/other/a.ts'], mode: 'copy' },
        '/workspace',
      ).actions,
    ).toEqual([
      { kind: 'copy', from: '/workspace/a.ts', to: '/workspace/a copy.ts' },
      { kind: 'copy', from: '/workspace/other/a.ts', to: '/workspace/a copy 2.ts' },
    ]);
  });

  it('moves cut entries with rename and clears the clipboard after success', () => {
    const fs = new FakeFs(['/workspace/src/a.ts', '/workspace/lib']);

    expect(
      planClipboardPaste(fs, { paths: ['/workspace/src/a.ts'], mode: 'cut' }, '/workspace/lib'),
    ).toEqual({
      actions: [{ kind: 'rename', from: '/workspace/src/a.ts', to: '/workspace/lib/a.ts' }],
      clearAfter: true,
    });
  });

  it('treats cut-paste into the same directory as no-op and clears the cut clipboard', () => {
    const fs = new FakeFs(['/workspace/src/a.ts']);

    expect(
      planClipboardPaste(fs, { paths: ['/workspace/src/a.ts'], mode: 'cut' }, '/workspace/src'),
    ).toEqual({ actions: [], clearAfter: true });
  });
});
