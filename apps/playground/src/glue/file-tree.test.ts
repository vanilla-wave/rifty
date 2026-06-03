import type { VfsDirent } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { type DirentReader, fileCategory, readChildren, sortDirents } from './file-tree.ts';

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
