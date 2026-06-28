import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { FileExplorer } from './FileExplorer.tsx';

const enc = new TextEncoder();

const entries = new Map<string, { isDirectory: boolean; data?: Uint8Array }>([
  ['/workspace', { isDirectory: true }],
  ['/workspace/README.md', { isDirectory: false, data: enc.encode('# Rifty\n') }],
  ['/workspace/src', { isDirectory: true }],
  ['/workspace/src/main.ts', { isDirectory: false, data: enc.encode('console.log(1)\n') }],
]);

const vfs = {
  readOnly: true,
  existsSync(path: string): boolean {
    return entries.has(path);
  },
  readFileBytesSync(path: string): Uint8Array {
    const entry = entries.get(path);
    if (!entry || entry.isDirectory) throw new Error(`ENOENT ${path}`);
    return entry.data ?? new Uint8Array();
  },
  readdirSync(path: string) {
    const prefix = `${path}/`;
    return [...entries.keys()]
      .filter((candidate) => candidate.startsWith(prefix))
      .map((candidate) => candidate.slice(prefix.length))
      .filter((rest) => rest.length > 0 && !rest.includes('/'))
      .map((name) => {
        const entry = entries.get(`${prefix}${name}`);
        if (!entry) throw new Error(`missing ${prefix}${name}`);
        return { name, isDirectory: entry.isDirectory, isFile: !entry.isDirectory };
      });
  },
  statSync(path: string) {
    const entry = entries.get(path);
    if (!entry) throw new Error(`ENOENT ${path}`);
    return {
      isFile: !entry.isDirectory,
      isDirectory: entry.isDirectory,
      size: entry.data?.byteLength ?? 0,
    };
  },
  writeFileSync(): void {
    throw new Error('read-only');
  },
  mkdirSync(): void {
    throw new Error('read-only');
  },
  rmSync(): void {
    throw new Error('read-only');
  },
};

const mutations = {
  createFile: () => Promise.resolve(),
  createDir: () => Promise.resolve(),
  deletePath: () => Promise.resolve(),
  renamePath: () => Promise.resolve(),
  renameMany: () => Promise.resolve(),
  copyTree: () => Promise.resolve(),
  writeFile: () => Promise.resolve(),
  writeFiles: () => Promise.resolve(),
};

describe('FileExplorer owner-routed file manager affordances', () => {
  it('renders owner-mode create and row mutation controls without exposing snapshot writes', () => {
    const html = renderToString(() =>
      FileExplorer({
        vfs,
        mutations,
        root: '/workspace',
        visible: true,
        gitStatus: new Map([
          ['/workspace/README.md', ' M'],
          ['/workspace/src/main.ts', ' M'],
          ['/workspace/src/new.ts', '??'],
        ]),
        onOpenFile: () => {},
        onDownloadFile: () => {},
        onCompareFiles: () => {},
        onCompareWithHead: () => {},
      }),
    );

    expect(html).toContain('aria-label="New file"');
    expect(html).toContain('aria-label="New folder"');
    expect(html).toContain('aria-label="Rename src"');
    expect(html).toContain('aria-label="Delete src"');
    expect(html).toContain('aria-label="Download README.md"');
    expect(html).not.toContain('aria-label="Download src"');
    expect(html).toContain('data-mode="owner"');
    expect(html).not.toContain('read-only');
  });

  it('renders rifty-git file badges and ancestor folder tint', () => {
    const html = renderToString(() =>
      FileExplorer({
        vfs,
        root: '/workspace',
        visible: true,
        gitStatus: new Map([
          ['/workspace/README.md', ' M'],
          ['/workspace/src/main.ts', ' M'],
          ['/workspace/src/new.ts', '??'],
        ]),
        onOpenFile: () => {},
      }),
    );

    expect(html).toContain('data-git="modified"');
    expect(html).toContain('title="rifty-git status: descendant modified"');
    expect(html).toContain('aria-label="rifty-git status: M modified"');
  });
});
