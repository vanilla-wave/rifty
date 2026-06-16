import type { VfsDirent } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import {
  type DirentReader,
  type NmNodeState,
  composeNodeModulesRows,
  fileCategory,
  readChildren,
  sortDirents,
} from './file-tree.ts';

const d = (name: string, isDir: boolean): VfsDirent => ({
  name,
  isFile: !isDir,
  isDirectory: isDir,
});

describe('sortDirents', () => {
  it('puts directories before files, each case-insensitive alpha', () => {
    const sorted = sortDirents([
      d('main.js', false),
      d('src', true),
      d('Assets', true),
      d('README.md', false),
    ]).map((e) => e.name);
    expect(sorted).toEqual(['Assets', 'src', 'main.js', 'README.md']);
  });
});

describe('readChildren', () => {
  it('reads one level, joins paths, maps kind, and sorts', () => {
    const reader: DirentReader = {
      readdirSync: (path) => {
        if (path === '/workspace')
          return [d('b.js', false), d('node_modules', true), d('a.js', false)];
        throw new Error(`unexpected readdir ${path}`);
      },
    };
    expect(readChildren(reader, '/workspace')).toEqual([
      { path: '/workspace/node_modules', name: 'node_modules', kind: 'dir' },
      { path: '/workspace/a.js', name: 'a.js', kind: 'file' },
      { path: '/workspace/b.js', name: 'b.js', kind: 'file' },
    ]);
  });

  it('does not recurse into subdirectories (lazy)', () => {
    let calls = 0;
    const reader: DirentReader = {
      readdirSync: (path) => {
        calls += 1;
        return path === '/' ? [d('sub', true)] : [];
      },
    };
    readChildren(reader, '/');
    expect(calls).toBe(1);
  });
});

describe('fileCategory', () => {
  it('classifies common extensions', () => {
    expect(fileCategory('main.js')).toBe('js');
    expect(fileCategory('mod.mjs')).toBe('js');
    expect(fileCategory('app.ts')).toBe('ts');
    expect(fileCategory('App.tsx')).toBe('jsx');
    expect(fileCategory('data.json')).toBe('json');
    expect(fileCategory('README.md')).toBe('md');
    expect(fileCategory('theme.css')).toBe('css');
    expect(fileCategory('index.html')).toBe('html');
    expect(fileCategory('notes.txt')).toBe('txt');
  });

  it('special-cases package.json and lockfiles', () => {
    expect(fileCategory('package.json')).toBe('json');
    expect(fileCategory('pnpm-lock.yaml')).toBe('lock');
  });

  it('falls back for unknown / dotfiles', () => {
    expect(fileCategory('LICENSE')).toBe('file');
    expect(fileCategory('.gitignore')).toBe('file');
  });
});

describe('composeNodeModulesRows', () => {
  const NM = '/ws/node_modules';

  it('collapsed: just the node_modules dir row', () => {
    const rows = composeNodeModulesRows(NM, 0, new Set(), new Map());
    expect(rows).toEqual([{ path: NM, name: 'node_modules', depth: 0, kind: 'dir' }]);
  });

  it('expanded but unloaded → a loading row at depth+1', () => {
    const rows = composeNodeModulesRows(NM, 0, new Set([NM]), new Map());
    expect(rows.map((r) => r.kind)).toEqual(['dir', 'loading']);
    expect(rows[1]?.depth).toBe(1);
  });

  it('error state → an error row carrying the worker message', () => {
    const nmState = new Map<string, NmNodeState>([[NM, { status: 'error', message: 'boom' }]]);
    const rows = composeNodeModulesRows(NM, 0, new Set([NM]), nmState);
    const err = rows.find((r) => r.kind === 'error');
    expect(err?.message).toBe('boom');
    expect(err?.depth).toBe(1);
  });

  it('loaded → children at depth+1, nested expanded dir → grandchildren at depth+2', () => {
    const nmState = new Map<string, NmNodeState>([
      [
        NM,
        {
          status: 'loaded',
          entries: [
            { name: 'vite', kind: 'dir', size: 0 },
            { name: 'README.md', kind: 'file', size: 12 },
          ],
        },
      ],
      [`${NM}/vite`, { status: 'loaded', entries: [{ name: 'index.js', kind: 'file', size: 4 }] }],
    ]);
    const expanded = new Set([NM, `${NM}/vite`]);
    const rows = composeNodeModulesRows(NM, 0, expanded, nmState);

    expect(rows).toEqual([
      { path: NM, name: 'node_modules', depth: 0, kind: 'dir' },
      { path: `${NM}/vite`, name: 'vite', depth: 1, kind: 'dir' },
      { path: `${NM}/vite/index.js`, name: 'index.js', depth: 2, kind: 'file' },
      { path: `${NM}/README.md`, name: 'README.md', depth: 1, kind: 'file' },
    ]);
  });
});
