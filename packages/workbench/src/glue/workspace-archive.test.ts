import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import {
  type WorkspaceArchiveFs,
  type WorkspaceArchiveV1,
  applyWorkspaceArchive,
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

// ---------------------------------------------------------------------------
// Restore mkdir dedup (backlog playground/restore-mkdir-persist-dedup, issue
// #256 slice mkdir-dedup): apply() issues one mkdirSync per distinct file
// dirname — never one per file. On OpfsFsSync every mkdirSync call becomes an
// async persist op, so per-file mkdirs made a big-tree restore drain ~2 FIFO
// ops per file (epic I2 bounds it at N + D + O(1)).
// ---------------------------------------------------------------------------

function archiveFile(path: string, text: string): WorkspaceArchiveV1['files'][number] {
  return { path, encoding: 'base64', content: Buffer.from(text).toString('base64') };
}

/** Records every mkdir/write in ONE ordered log over a real MemoryFsSync. */
function loggingFs(): {
  fs: WorkspaceArchiveFs;
  inner: MemoryFsSync;
  calls: Array<readonly ['mkdir' | 'write', string]>;
} {
  const inner = new MemoryFsSync();
  const calls: Array<readonly ['mkdir' | 'write', string]> = [];
  const fs: WorkspaceArchiveFs = {
    existsSync: (path) => inner.existsSync(path),
    readdirSync: (path) => inner.readdirSync(path),
    readFileBytesSync: (path) => inner.readFileBytesSync(path),
    writeFileSync: (path, data) => {
      calls.push(['write', path]);
      inner.writeFileSync(path, data);
    },
    mkdirSync: (path, options) => {
      calls.push(['mkdir', path]);
      inner.mkdirSync(path, options);
    },
    rmSync: (path, options) => inner.rmSync(path, options),
  };
  return { fs, inner, calls };
}

describe('workspace archive apply — one mkdir per distinct dirname (#256 mkdir-dedup)', () => {
  // Dirnames interleave on purpose: a consecutive-only dedup fails this.
  const archive: WorkspaceArchiveV1 = {
    version: 1,
    root: '/ws',
    files: [
      archiveFile('a/f1.js', 'f1'),
      archiveFile('b/g1.js', 'g1'),
      archiveFile('a/f2.js', 'f2'),
      archiveFile('a/deep/h1.js', 'h1'),
      archiveFile('root.txt', 'r'),
      archiveFile('b/g2.js', 'g2'),
      archiveFile('x/y/f.js', 'xy'), // '/ws/x' is created by the chain, never a dirname itself
      archiveFile('a/deep/h2.js', 'h2'),
    ],
  };

  // The COMPLETE desired trace, in one assert: same-pass first-seen dedup —
  // every surviving mkdir keeps its exact per-file position (epic slice
  // clause "no ordering change"), only duplicate mkdirs vanish. Pre-dedup
  // RED: main interleaves one mkdir before EVERY write (9 mkdirs, not 6).
  const DEDUPED_TRACE: Array<readonly ['mkdir' | 'write', string]> = [
    ['mkdir', '/ws'],
    ['mkdir', '/ws/a'],
    ['write', '/ws/a/f1.js'],
    ['mkdir', '/ws/b'],
    ['write', '/ws/b/g1.js'],
    ['write', '/ws/a/f2.js'],
    ['mkdir', '/ws/a/deep'],
    ['write', '/ws/a/deep/h1.js'],
    ['mkdir', '/ws'], // root.txt's dirname — first-seen tracking, no root special-case
    ['write', '/ws/root.txt'],
    ['write', '/ws/b/g2.js'],
    ['mkdir', '/ws/x/y'],
    ['write', '/ws/x/y/f.js'],
    ['write', '/ws/a/deep/h2.js'],
  ];

  it('emits exactly the deduped per-file trace — one mkdir per distinct dirname, in place', () => {
    const { fs, inner, calls } = loggingFs();
    applyWorkspaceArchive(fs, archive);

    expect(calls).toEqual(DEDUPED_TRACE);
    expect(read(inner, '/ws/a/deep/h2.js')).toBe('h2');
    expect(read(inner, '/ws/x/y/f.js')).toBe('xy');
  });

  it('a mid-apply write failure rethrows the ORIGINAL error and leaves exactly the pre-failure trace', () => {
    const { fs, inner, calls } = loggingFs();
    const failAt = '/ws/root.txt'; // 5th file — after a/b dirs, before b/g2, x/y, a/deep/h2
    const failure = new Error('disk full');
    const realWrite = fs.writeFileSync.bind(fs);
    fs.writeFileSync = (path, data) => {
      if (path === failAt) throw failure;
      realWrite(path, data);
    };

    let caught: unknown;
    try {
      applyWorkspaceArchive(fs, archive);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(failure); // identity, not a wrapped copy
    // The durable prefix is exactly the desired trace truncated at the
    // failing write — no look-ahead effects, no post-failure effects.
    const failureIndex = DEDUPED_TRACE.findIndex(
      ([kind, path]) => kind === 'write' && path === failAt,
    );
    expect(calls).toEqual(DEDUPED_TRACE.slice(0, failureIndex));
    expect(read(inner, '/ws/a/deep/h1.js')).toBe('h1');
    expect(inner.existsSync('/ws/b/g2.js')).toBe(false);
    expect(inner.existsSync('/ws/x/y')).toBe(false);
    expect(inner.existsSync('/ws/a/deep/h2.js')).toBe(false);
  });
});
