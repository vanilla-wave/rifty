import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import {
  buildWorkspaceArchive,
  exportWorkspaceArchive,
  importWorkspaceArchive,
} from './workspace-archive.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

function write(fs: MemoryFsSync, path: string, text: string): void {
  const slash = path.lastIndexOf('/');
  fs.mkdirSync(path.slice(0, slash), { recursive: true });
  fs.writeFileSync(path, enc.encode(text));
}

function read(fs: MemoryFsSync, path: string): string {
  return dec.decode(fs.readFileBytesSync(path));
}

describe('workspace archive', () => {
  it('exports source files and imports them into another VFS', () => {
    const fs = new MemoryFsSync();
    write(fs, '/workspace/src/main.ts', 'console.log("hi")');
    write(fs, '/workspace/package.json', '{"type":"module"}');
    write(fs, '/workspace/node_modules/pkg/index.js', 'ignored');
    write(fs, '/workspace/.git/config', 'ignored');
    write(fs, '/workspace/dist/bundle.js', 'ignored');
    write(fs, '/workspace/.vite/deps/x.js', 'ignored');

    const archive = exportWorkspaceArchive(fs, '/workspace');
    const target = new MemoryFsSync();
    importWorkspaceArchive(target, archive);

    expect(read(target, '/workspace/src/main.ts')).toBe('console.log("hi")');
    expect(read(target, '/workspace/package.json')).toBe('{"type":"module"}');
    expect(target.existsSync('/workspace/node_modules/pkg/index.js')).toBe(false);
    expect(target.existsSync('/workspace/.git/config')).toBe(false);
    expect(target.existsSync('/workspace/dist/bundle.js')).toBe(false);
    expect(target.existsSync('/workspace/.vite/deps/x.js')).toBe(false);
  });

  it('serializes as JSON archive v1 with base64 file contents', () => {
    const fs = new MemoryFsSync();
    write(fs, '/workspace/src/main.ts', 'ok');

    const archive = exportWorkspaceArchive(fs, '/workspace');
    const parsed = JSON.parse(archive) as {
      version: number;
      root: string;
      files: Array<{ path: string; encoding: string; content: string }>;
    };

    expect(parsed.version).toBe(1);
    expect(parsed.root).toBe('/workspace');
    expect(parsed.files).toEqual([
      { path: 'src/main.ts', encoding: 'base64', content: Buffer.from('ok').toString('base64') },
    ]);
  });

  it('omits a marker-shaped directory and every descendant from dependency archives', () => {
    const fs = new MemoryFsSync();
    write(fs, '/workspace/node_modules/pkg/index.js', 'ordinary');
    write(fs, '/workspace/node_modules/.rifty-install-stamp.json/payload', 'forged-directory');

    const archive = buildWorkspaceArchive(fs, '/workspace/node_modules', { exclude: [] });

    expect(archive.files.map((file) => file.path)).toEqual(['pkg/index.js']);
  });

  it.each(['/workspace', '/workspace/src'])(
    'propagates an exact readdir permission failure at %s instead of exporting a partial archive',
    (failedDirectory) => {
      const fs = new MemoryFsSync();
      write(fs, '/workspace/src/main.ts', 'must-not-disappear');
      const realReaddir = fs.readdirSync.bind(fs);
      const failure = new Error(`permission denied reading ${failedDirectory}`);
      failure.name = 'ArchivePermissionError';
      fs.readdirSync = ((path) => {
        if (path === failedDirectory) throw failure;
        return realReaddir(path);
      }) as typeof fs.readdirSync;

      let caught: unknown;
      try {
        exportWorkspaceArchive(fs, '/workspace');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBe(failure);
    },
  );

  it('validates the whole archive before replacing the workspace', () => {
    const fs = new MemoryFsSync();
    write(fs, '/workspace/src/main.ts', 'keep');
    const badArchive = JSON.stringify({
      version: 1,
      root: '/workspace',
      files: [{ path: '../escape.txt', encoding: 'base64', content: 'x' }],
    });

    expect(() => importWorkspaceArchive(fs, badArchive)).toThrow(/Unsafe archive path/);
    expect(read(fs, '/workspace/src/main.ts')).toBe('keep');
  });

  it.each([
    ['null entry', null, /file 0 must be an object/i],
    ['array entry', [], /file 0 must be an object/i],
    ['string entry', 'src/new.ts', /file 0 must be an object/i],
    ['missing fields', {}, /file 0 path must be a string/i],
    [
      'non-string path',
      { path: 7, encoding: 'base64', content: Buffer.from('new').toString('base64') },
      /file 0 path must be a string/i,
    ],
    [
      'wrong encoding',
      { path: 'src/new.ts', encoding: 'utf8', content: 'new' },
      /file 0 encoding must be base64/i,
    ],
    [
      'non-string content',
      { path: 'src/new.ts', encoding: 'base64', content: null },
      /file 0 content must be a string/i,
    ],
  ])(
    'rejects a malformed %s without resetting or changing destination bytes',
    (_case, file, error) => {
      const fs = new MemoryFsSync();
      write(fs, '/workspace/src/main.ts', 'keep');
      write(fs, '/workspace/data.bin', '\u0000\u007f');
      const before = exportWorkspaceArchive(fs, '/workspace');
      const rmSync = vi.spyOn(fs, 'rmSync');
      const badArchive = JSON.stringify({
        version: 1,
        root: '/workspace',
        files: [file],
      });

      expect(() => importWorkspaceArchive(fs, badArchive)).toThrow(error);
      expect(rmSync).not.toHaveBeenCalled();
      expect(exportWorkspaceArchive(fs, '/workspace')).toBe(before);
    },
  );

  it.each([
    ['ancestor before descendant', ['a', 'a/b']],
    ['descendant before ancestor', ['a/b', 'a']],
    ['duplicate normalized target', ['a/b', 'a//b']],
  ])('rejects %s before mutating the destination', (_case, paths) => {
    const fs = new MemoryFsSync();
    write(fs, '/workspace/src/main.ts', 'keep');
    const badArchive = JSON.stringify({
      version: 1,
      root: '/workspace',
      files: paths.map((path) => ({
        path,
        encoding: 'base64',
        content: Buffer.from(path).toString('base64'),
      })),
    });

    expect(() => importWorkspaceArchive(fs, badArchive)).toThrow(/archive target collision/i);
    expect(read(fs, '/workspace/src/main.ts')).toBe('keep');
  });

  it('rejects archives for another root before replacing the workspace', () => {
    const fs = new MemoryFsSync();
    write(fs, '/workspace/src/main.ts', 'keep');
    const badArchive = JSON.stringify({
      version: 1,
      root: '/other',
      files: [
        { path: 'src/main.ts', encoding: 'base64', content: Buffer.from('new').toString('base64') },
      ],
    });

    expect(() => importWorkspaceArchive(fs, badArchive, { root: '/workspace' })).toThrow(
      /Archive root mismatch/,
    );
    expect(read(fs, '/workspace/src/main.ts')).toBe('keep');
  });

  it('rejects user archives containing derived dependency state', () => {
    const path = 'node_modules/pkg/index.js';
    const fs = new MemoryFsSync();
    write(fs, '/workspace/src/main.ts', 'keep');
    const badArchive = JSON.stringify({
      version: 1,
      root: '/workspace',
      files: [{ path, encoding: 'base64', content: Buffer.from('forged').toString('base64') }],
    });

    expect(() => importWorkspaceArchive(fs, badArchive)).toThrow(/derived node_modules/);
    expect(read(fs, '/workspace/src/main.ts')).toBe('keep');
  });

  it.each([
    'node_modules/.rifty-install-stamp.json',
    'node_modules/pkg/node_modules/.rifty-install-stamp.json',
  ])('rejects reserved install claims before replacing user bytes: %s', (path) => {
    const fs = new MemoryFsSync();
    write(fs, '/workspace/src/main.ts', 'keep');
    const badArchive = JSON.stringify({
      version: 1,
      root: '/workspace',
      files: [{ path, encoding: 'base64', content: Buffer.from('forged').toString('base64') }],
    });

    expect(() => importWorkspaceArchive(fs, badArchive)).toThrow(/install-stamp claim/);
    expect(read(fs, '/workspace/src/main.ts')).toBe('keep');
  });
});
