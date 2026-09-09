import { Buffer } from 'node:buffer';
import type { FsSync } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import * as archive from './playground-archive.ts';

const ROOT = '/.rifty/workbench/playground/retained-scratch/record-a/tree';
const encoder = new TextEncoder();

interface RecoveryFile {
  readonly path: string;
  readonly encoding: 'base64';
  readonly content: string;
}

interface RecoveryArchive {
  readonly format: 'rifty-scratch-recovery';
  readonly version: 1;
  readonly root: '/';
  readonly directories: readonly string[];
  readonly files: readonly RecoveryFile[];
}

type ExportRecovery = (
  fs: FsSync,
  root: string,
  limits?: archive.PlaygroundArchiveV1Limits,
) => string;

function exporter(): ExportRecovery {
  // Preparation bridge only: the real codec does not exist on the RED baseline.
  const value: unknown = Reflect.get(archive, 'exportPlaygroundScratchRecoveryV1');
  expect(value, 'real recovery archive codec').toBeTypeOf('function');
  if (typeof value !== 'function') throw new Error('Recovery archive codec is absent');
  return value as ExportRecovery;
}

function write(fs: FsSync, relative: string, value: string | Uint8Array): void {
  const path = `${ROOT}/${relative}`;
  fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(path, typeof value === 'string' ? encoder.encode(value) : value);
}

function tree(
  files: Readonly<Record<string, Uint8Array>> = {},
  directories: readonly string[] = [],
) {
  const { fsSync } = createMemoryFs();
  fsSync.mkdirSync(ROOT, { recursive: true });
  fsSync.writeFileSync('/outside.bin', new Uint8Array([71, 72]));
  for (const directory of directories)
    fsSync.mkdirSync(`${ROOT}/${directory}`, { recursive: true });
  for (const [path, bytes] of Object.entries(files)) write(fsSync, path, bytes);
  return fsSync;
}

/** Independent observation of the actual whole VFS, including private and outside paths. */
function snapshot(fs: FsSync) {
  const entries: {
    path: string;
    kind: 'file' | 'directory';
    mtime: number | undefined;
    bytes?: readonly number[];
  }[] = [];
  const visit = (path: string): void => {
    const stat = fs.statSync(path);
    entries.push({
      path,
      kind: stat.isDirectory ? 'directory' : 'file',
      mtime: stat.mtime,
      ...(stat.isFile ? { bytes: [...fs.readFileBytesSync(path)] } : {}),
    });
    if (stat.isDirectory) {
      for (const child of fs.readdirSync(path)) visit(`${path === '/' ? '' : path}/${child.name}`);
    }
  };
  visit('/');
  return entries;
}

function decoded(json: string): RecoveryArchive {
  return JSON.parse(json) as RecoveryArchive;
}

function encodedFiles(files: Readonly<Record<string, Uint8Array>>): RecoveryFile[] {
  return Object.keys(files)
    .sort()
    .map((path) => ({
      path,
      encoding: 'base64',
      content: Buffer.from(files[path]!).toString('base64'),
    }));
}

describe('retained Scratch recovery archive', () => {
  it('exports the exact distinct envelope, all ordinary file kinds and empty directories', () => {
    const ordinary = {
      '.git/HEAD': encoder.encode('ref: refs/heads/main\n'),
      '.rifty-install-stamp.json': encoder.encode('ordinary root filename'),
      '.vite/cache.bin': new Uint8Array([5, 6]),
      'binary.bin': new Uint8Array([0, 1, 2, 127, 128, 254, 255, 13, 10]),
      'dist/bundle.js': encoder.encode('globalThis.answer = 42;\n'),
      'empty.bin': new Uint8Array(),
      'nested/.rifty/user.bin': new Uint8Array([7, 8, 9]),
      'node_modules/.rifty-install-stamp.json.backup': encoder.encode('ordinary suffix'),
      'node_modules/pkg/.rifty-install-stamp.json': encoder.encode('ordinary package file'),
      'node_modules/pkg/index.js': encoder.encode('module.exports = 42;\n'),
      'source.ts': encoder.encode('export const answer = 42;\n'),
    };
    const fs = tree(ordinary, ['empty-directory']);
    write(fs, '.rifty/private.bin', 'root-private bytes');
    write(fs, 'node_modules/.rifty-install-stamp.json', 'privileged claim');
    write(fs, 'nested/node_modules/.rifty-install-stamp.json/hidden.bin', 'claim-shaped directory');
    write(fs, 'node_modules/pkg/node_modules/.rifty-install-stamp.json', 'nested privileged claim');
    const before = snapshot(fs);

    const json = exporter()(fs, ROOT);
    expect(decoded(json)).toEqual({
      format: 'rifty-scratch-recovery',
      version: 1,
      root: '/',
      directories: [
        '.git',
        '.vite',
        'dist',
        'empty-directory',
        'nested',
        'nested/.rifty',
        'nested/node_modules',
        'node_modules',
        'node_modules/pkg',
        'node_modules/pkg/node_modules',
      ],
      files: encodedFiles(ordinary),
    } satisfies RecoveryArchive);
    expect(json).not.toContain(ROOT);
    expect(decoded(json).files.find((file) => file.path === 'binary.bin')?.content).toBe(
      'AAECf4D+/w0K',
    );
    expect(snapshot(fs)).toEqual(before);
    expect(exporter()(fs, ROOT)).toBe(json);
  });

  it('omits a root-private .rifty file, while keeping similarly named ordinary files', () => {
    const fs = tree({
      '.rifty': encoder.encode('private file'),
      '.rifty.backup': encoder.encode('ordinary backup'),
      'nested/.rifty': encoder.encode('ordinary nested file'),
    });
    const before = snapshot(fs);
    expect(decoded(exporter()(fs, ROOT))).toEqual({
      format: 'rifty-scratch-recovery',
      version: 1,
      root: '/',
      directories: ['nested'],
      files: encodedFiles({
        '.rifty.backup': encoder.encode('ordinary backup'),
        'nested/.rifty': encoder.encode('ordinary nested file'),
      }),
    });
    expect(snapshot(fs)).toEqual(before);
  });

  it('preserves literal POSIX names and code-unit ordering, without URL decoding', () => {
    const names = [
      'é.txt',
      'Z.txt',
      'a.txt',
      'back\\slash.txt',
      '%2F.txt',
      '%2e%2e',
      'space name.txt',
      '💾.bin',
      'line\nbreak.txt',
      'trailing.',
      'colon:name',
    ];
    const directories = ['é-dir', 'Z-dir', 'a-dir', 'back\\slash-dir', '%2F-dir'];
    const files = Object.fromEntries(
      names.map((name, index) => [name, new Uint8Array([index, 255])]),
    );
    const fs = tree(files, directories);
    // Prove the actual Memory VFS admits these names before testing the codec.
    expect(fs.readdirSync(ROOT).map(({ name }) => name)).toEqual([...names, ...directories].sort());
    for (const name of names) expect(fs.readFileBytesSync(`${ROOT}/${name}`)).toEqual(files[name]);
    const before = snapshot(fs);
    const value = decoded(exporter()(fs, ROOT));
    expect(value.directories).toEqual([...directories].sort());
    expect(value.files).toEqual(encodedFiles(files));
    for (const file of value.files) {
      expect(file.path.startsWith('/')).toBe(false);
      expect(Buffer.from(file.content, 'base64').toString('base64')).toBe(file.content);
    }
    expect(snapshot(fs)).toEqual(before);
  });

  it('encodes all byte values and base64 padding exactly, including genuine empty files', () => {
    const files = {
      empty: new Uint8Array(),
      one: new Uint8Array([255]),
      two: new Uint8Array([0, 255]),
      three: new Uint8Array([0, 255, 128]),
      all: Uint8Array.from({ length: 256 }, (_, index) => index),
    };
    const fs = tree(files);
    const value = decoded(exporter()(fs, ROOT));
    expect(value.files).toEqual(encodedFiles(files));
    expect(
      Object.fromEntries(value.files.map(({ path, content }) => [path, content])),
    ).toMatchObject({
      empty: '',
      one: '/w==',
      two: 'AP8=',
      three: 'AP+A',
    });
    for (const file of value.files) {
      expect(new Uint8Array(Buffer.from(file.content, 'base64'))).toEqual(
        fs.readFileBytesSync(`${ROOT}/${file.path}`),
      );
    }
  });

  it('leaves the editable codec unchanged and its importer rejects the recovery envelope', () => {
    const fs = tree(
      {
        'source.txt': encoder.encode('source'),
        'node_modules/pkg/index.js': encoder.encode('dependency'),
        'dist/bundle.js': encoder.encode('build'),
      },
      ['empty-directory'],
    );
    const before = snapshot(fs);
    const editable = archive.exportPlaygroundArchiveV1(fs, ROOT);
    expect(JSON.parse(editable)).toEqual({
      version: 1,
      root: '/',
      files: encodedFiles({ 'source.txt': encoder.encode('source') }),
    });
    const recovery = exporter()(fs, ROOT);
    expect(() => archive.preparePlaygroundArchiveV1Import(fs, '/target', recovery)).toThrow(
      TypeError,
    );
    expect(archive.exportPlaygroundArchiveV1(fs, ROOT)).toBe(editable);
    expect(snapshot(fs)).toEqual(before);
  });

  it('exports an empty tree with zero entry/file/byte/segment budgets and no root directory entry', () => {
    const fs = tree();
    expect(
      decoded(
        exporter()(fs, ROOT, {
          ...archive.PLAYGROUND_ARCHIVE_V1_LIMITS,
          maxFiles: 0,
          maxTraversalEntries: 0,
          maxDecodedFileBytes: 0,
          maxTotalDecodedBytes: 0,
          maxPathSegments: 0,
        }),
      ),
    ).toEqual({
      format: 'rifty-scratch-recovery',
      version: 1,
      root: '/',
      directories: [],
      files: [],
    });
  });
});

interface NumericBoundary {
  readonly name: string;
  readonly key: keyof archive.PlaygroundArchiveV1Limits;
  readonly exact: number;
  readonly files: Readonly<Record<string, Uint8Array>>;
  readonly directories?: readonly string[];
  readonly error: RegExp;
}

const boundaries: readonly NumericBoundary[] = [
  {
    name: 'decoded file bytes',
    key: 'maxDecodedFileBytes',
    exact: 3,
    files: { 'a.bin': new Uint8Array([0, 255, 128]) },
    error: /file.*byte limit/i,
  },
  {
    name: 'total decoded bytes',
    key: 'maxTotalDecodedBytes',
    exact: 5,
    files: { a: new Uint8Array([0, 255]), b: new Uint8Array([1, 2, 3]) },
    error: /total byte limit/i,
  },
  {
    name: 'file count',
    key: 'maxFiles',
    exact: 2,
    files: { a: new Uint8Array(), b: new Uint8Array() },
    error: /file limit/i,
  },
  {
    name: 'traversed entries, including empty directories',
    key: 'maxTraversalEntries',
    exact: 4,
    files: { 'a/one.bin': new Uint8Array([1]), b: new Uint8Array([2]) },
    directories: ['empty'],
    error: /traversal entry limit/i,
  },
  {
    name: 'file path segments',
    key: 'maxPathSegments',
    exact: 3,
    files: { 'a/b/c.bin': new Uint8Array([255]) },
    error: /path segment limit/i,
  },
  {
    name: 'empty-directory path segments',
    key: 'maxPathSegments',
    exact: 4,
    files: {},
    directories: ['a/b/c/d'],
    error: /path segment limit/i,
  },
];

describe('recovery export allocation boundaries', () => {
  it.each(boundaries)(
    '[fault: unbounded-read] admits exact $name and rejects one below without consuming bytes',
    ({ key, exact, files, directories, error }) => {
      const fs = tree(files, directories);
      const before = snapshot(fs);
      const exportRecovery = exporter();
      const baseline = exportRecovery(fs, ROOT);
      expect(
        exportRecovery(fs, ROOT, { ...archive.PLAYGROUND_ARCHIVE_V1_LIMITS, [key]: exact }),
      ).toBe(baseline);
      expect(snapshot(fs)).toEqual(before);
      expect(() =>
        exportRecovery(fs, ROOT, {
          ...archive.PLAYGROUND_ARCHIVE_V1_LIMITS,
          [key]: exact - 1,
        }),
      ).toThrow(error);
      expect(snapshot(fs)).toEqual(before);
      expect(exportRecovery(fs, ROOT)).toBe(baseline);
    },
  );

  it('[fault: unbounded-read] counts JSON UTF-16 units at the exact complete-envelope boundary', () => {
    const fs = tree({ '💾.bin': new Uint8Array([0, 255, 128]) }, ['empty']);
    const before = snapshot(fs);
    const exportRecovery = exporter();
    const json = exportRecovery(fs, ROOT);
    expect(decoded(json).files).toEqual(encodedFiles({ '💾.bin': new Uint8Array([0, 255, 128]) }));
    expect(Buffer.byteLength(json, 'utf8')).toBeGreaterThan(json.length);
    expect(
      exportRecovery(fs, ROOT, {
        ...archive.PLAYGROUND_ARCHIVE_V1_LIMITS,
        maxJsonCodeUnits: json.length,
      }),
    ).toBe(json);
    expect(() =>
      exportRecovery(fs, ROOT, {
        ...archive.PLAYGROUND_ARCHIVE_V1_LIMITS,
        maxJsonCodeUnits: json.length - 1,
      }),
    ).toThrow(/JSON code-unit limit/i);
    expect(snapshot(fs)).toEqual(before);
    expect(exportRecovery(fs, ROOT)).toBe(json);
  });
});
