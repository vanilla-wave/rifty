import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { exportWorkspaceArchive, importWorkspaceArchive } from './workspace-archive.ts';

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
});
