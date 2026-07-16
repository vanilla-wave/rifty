import type { FsSync } from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import {
  PLAYGROUND_ARCHIVE_V1_LIMITS,
  type PlaygroundArchiveV1Limits,
  exportPlaygroundArchiveV1,
  preparePlaygroundArchiveV1Import,
} from './playground-archive.ts';

const PROJECT_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const MEBIBYTE = 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface ArchiveFile {
  readonly path: string;
  readonly encoding: 'base64';
  readonly content: string;
}

interface ArchiveV1 {
  readonly version: 1;
  readonly root: '/';
  readonly files: readonly ArchiveFile[];
}

interface ImportCodec {
  parseJson(json: string): unknown;
  decodeCanonicalBase64(content: string): Uint8Array;
}

interface InstrumentedImportCodec {
  readonly codec: ImportCodec;
  readonly parseJson: ReturnType<typeof vi.fn<(json: string) => unknown>>;
  readonly decodeCanonicalBase64: ReturnType<typeof vi.fn<(content: string) => Uint8Array>>;
}

interface InvalidLastCase {
  readonly name: string;
  readonly json: string;
  readonly limits?: PlaygroundArchiveV1Limits;
}

interface ExactFsTree {
  readonly directories: readonly string[];
  readonly files: Readonly<Record<string, readonly number[]>>;
}

function write(fs: FsSync, path: string, contents: string | Uint8Array): void {
  const separator = path.lastIndexOf('/');
  fs.mkdirSync(path.slice(0, separator) || '/', { recursive: true });
  fs.writeFileSync(path, typeof contents === 'string' ? encoder.encode(contents) : contents);
}

function archive(files: readonly ArchiveFile[]): string {
  return JSON.stringify({ version: 1, root: '/', files } satisfies ArchiveV1);
}

function file(path: string, contents = path): ArchiveFile {
  return { path, encoding: 'base64', content: bytesToBase64(encoder.encode(contents)) };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeCanonicalBase64(content: string): Uint8Array {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function instrumentedImportCodec(): InstrumentedImportCodec {
  const parseJson = vi.fn<(json: string) => unknown>((json) => JSON.parse(json));
  const decode = vi.fn<(content: string) => Uint8Array>(decodeCanonicalBase64);
  return {
    codec: { parseJson, decodeCanonicalBase64: decode },
    parseJson,
    decodeCanonicalBase64: decode,
  };
}

function snapshotTree(
  fs: FsSync,
  root = PROJECT_ROOT,
): Readonly<Record<string, readonly number[]>> {
  const files: Record<string, readonly number[]> = {};
  if (!fs.existsSync(root)) return files;
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory)) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) walk(path);
      else files[path.slice(root.length)] = [...fs.readFileBytesSync(path)];
    }
  };
  walk(root);
  return Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function childPath(directory: string, name: string): string {
  return directory === '/' ? `/${name}` : `${directory}/${name}`;
}

function snapshotWholeFs(fs: FsSync): ExactFsTree {
  const directories: string[] = [];
  const files: Record<string, readonly number[]> = {};
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory)) {
      const path = childPath(directory, entry.name);
      if (entry.isDirectory) {
        directories.push(path);
        walk(path);
      } else {
        files[path] = [...fs.readFileBytesSync(path)];
      }
    }
  };
  walk('/');
  return {
    directories: directories.sort(),
    files: Object.fromEntries(
      Object.entries(files).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    ),
  };
}

function isWithin(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function relativeSubtree(tree: ExactFsTree, root: string): ExactFsTree {
  return {
    directories: tree.directories
      .filter((path) => path.startsWith(`${root}/`))
      .map((path) => path.slice(root.length))
      .sort(),
    files: Object.fromEntries(
      Object.entries(tree.files)
        .filter(([path]) => path.startsWith(`${root}/`))
        .map(([path, bytes]) => [path.slice(root.length), bytes] as const)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    ),
  };
}

function exactFsTreeEqual(left: ExactFsTree, right: ExactFsTree): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function preservesExistingForeignTree(before: ExactFsTree, after: ExactFsTree): boolean {
  const afterDirectories = new Set(after.directories);
  for (const path of before.directories) {
    if (!isWithin(PROJECT_ROOT, path) && !afterDirectories.has(path)) return false;
  }
  for (const [path, bytes] of Object.entries(before.files)) {
    if (isWithin(PROJECT_ROOT, path)) continue;
    const afterBytes = after.files[path];
    if (
      afterBytes === undefined ||
      afterBytes.length !== bytes.length ||
      afterBytes.some((byte, index) => byte !== bytes[index])
    ) {
      return false;
    }
  }
  return true;
}

function expectRollbackOrPrivateRecovery(
  before: ExactFsTree,
  completed: ExactFsTree,
  after: ExactFsTree,
): void {
  if (exactFsTreeEqual(after, before)) return;

  const originalProject = relativeSubtree(before, PROJECT_ROOT);
  const completedProject = relativeSubtree(completed, PROJECT_ROOT);
  const liveExists = after.directories.includes(PROJECT_ROOT);
  const liveProject = liveExists ? relativeSubtree(after, PROJECT_ROOT) : null;
  const liveIsOriginal = liveProject !== null && exactFsTreeEqual(liveProject, originalProject);
  const liveIsCompleted = liveProject !== null && exactFsTreeEqual(liveProject, completedProject);
  const privateRoots = after.directories.filter(
    (path) =>
      path.startsWith('/.rifty/') && !isWithin(PROJECT_ROOT, path) && !isWithin(path, PROJECT_ROOT),
  );
  const privateTrees = privateRoots.map((root) => relativeSubtree(after, root));
  const privateHasOriginal = privateTrees.some((tree) => exactFsTreeEqual(tree, originalProject));
  const privateHasCompleted = privateTrees.some((tree) => exactFsTreeEqual(tree, completedProject));

  expect(preservesExistingForeignTree(before, after)).toBe(true);
  expect(liveProject === null || liveIsOriginal || liveIsCompleted).toBe(true);
  expect(liveIsOriginal || privateHasOriginal).toBe(true);
  expect(liveIsCompleted || privateHasCompleted).toBe(true);
}

function importInto(fs: FsSync, json: string): void {
  preparePlaygroundArchiveV1Import(fs, PROJECT_ROOT, json).apply();
}

function exactFixtureLimits(jsonCodeUnits: number): PlaygroundArchiveV1Limits {
  return {
    maxJsonCodeUnits: jsonCodeUnits,
    maxFiles: 2,
    maxDecodedFileBytes: 3,
    maxTotalDecodedBytes: 5,
  };
}

function expectImportBudgetRejectionBeforeEffects(
  json: string,
  limits: PlaygroundArchiveV1Limits,
  expectedParseCalls: 0 | 1,
): void {
  const fs = new MemoryFsSync();
  write(fs, `${PROJECT_ROOT}/keep.txt`, 'keep');
  const before = snapshotTree(fs);
  const instrumented = instrumentedImportCodec();
  const mkdir = vi.spyOn(fs, 'mkdirSync');
  const remove = vi.spyOn(fs, 'rmSync');
  const writeFile = vi.spyOn(fs, 'writeFileSync');
  const rename = vi.spyOn(fs, 'renameSync');

  expect(() =>
    preparePlaygroundArchiveV1Import(fs, PROJECT_ROOT, json, limits, instrumented.codec),
  ).toThrow();
  expect(instrumented.parseJson).toHaveBeenCalledTimes(expectedParseCalls);
  expect(instrumented.decodeCanonicalBase64).not.toHaveBeenCalled();
  expect(mkdir).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
  expect(rename).not.toHaveBeenCalled();
  expect(snapshotTree(fs)).toEqual(before);
}

function expectImportRejectionBeforeAnyFilesystemEffect(
  json: string,
  limits: PlaygroundArchiveV1Limits = PLAYGROUND_ARCHIVE_V1_LIMITS,
): void {
  const fs = new MemoryFsSync();
  write(fs, `${PROJECT_ROOT}/keep.txt`, 'keep');
  write(fs, '/outside/keep.bin', new Uint8Array([0, 255, 1]));
  fs.mkdirSync('/outside/empty', { recursive: true });
  const before = snapshotWholeFs(fs);
  const mkdir = vi.spyOn(fs, 'mkdirSync');
  const remove = vi.spyOn(fs, 'rmSync');
  const writeFile = vi.spyOn(fs, 'writeFileSync');
  const rename = vi.spyOn(fs, 'renameSync');

  expect(() => preparePlaygroundArchiveV1Import(fs, PROJECT_ROOT, json, limits).apply()).toThrow();
  expect(mkdir).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
  expect(rename).not.toHaveBeenCalled();
  expect(snapshotWholeFs(fs)).toEqual(before);
}

describe('Playground archive v1 finite budgets', () => {
  it('publishes the exact immutable source-only browser defaults', () => {
    const expected = {
      maxJsonCodeUnits: 48 * MEBIBYTE,
      maxFiles: 10_000,
      maxDecodedFileBytes: 16 * MEBIBYTE,
      maxTotalDecodedBytes: 32 * MEBIBYTE,
    } satisfies PlaygroundArchiveV1Limits;

    expect(Reflect.ownKeys(PLAYGROUND_ARCHIVE_V1_LIMITS)).toEqual([
      'maxJsonCodeUnits',
      'maxFiles',
      'maxDecodedFileBytes',
      'maxTotalDecodedBytes',
    ]);
    expect(PLAYGROUND_ARCHIVE_V1_LIMITS).toEqual(expected);
    expect(Object.isFrozen(PLAYGROUND_ARCHIVE_V1_LIMITS)).toBe(true);
  });

  it('accepts export exactly at every budget and counts JSON in UTF-16 code units', () => {
    const fs = new MemoryFsSync();
    write(fs, `${PROJECT_ROOT}/\ud83d\ude00.txt`, '12');
    write(fs, `${PROJECT_ROOT}/b.txt`, '345');
    const expected = exportPlaygroundArchiveV1(fs, PROJECT_ROOT);

    expect(encoder.encode(expected).byteLength).toBeGreaterThan(expected.length);
    expect(exportPlaygroundArchiveV1(fs, PROJECT_ROOT, exactFixtureLimits(expected.length))).toBe(
      expected,
    );
  });

  it.each([
    [
      'archive JSON code units',
      (exact: PlaygroundArchiveV1Limits) => ({
        ...exact,
        maxJsonCodeUnits: exact.maxJsonCodeUnits - 1,
      }),
    ],
    ['file count', (exact: PlaygroundArchiveV1Limits) => ({ ...exact, maxFiles: 1 })],
    [
      'decoded bytes of one file',
      (exact: PlaygroundArchiveV1Limits) => ({
        ...exact,
        maxDecodedFileBytes: 2,
      }),
    ],
    [
      'total decoded bytes',
      (exact: PlaygroundArchiveV1Limits) => ({
        ...exact,
        maxTotalDecodedBytes: 4,
      }),
    ],
  ] satisfies readonly [string, (exact: PlaygroundArchiveV1Limits) => PlaygroundArchiveV1Limits][])(
    'rejects export over the %s budget without mutating the project',
    (_case, reduceLimit) => {
      const fs = new MemoryFsSync();
      write(fs, `${PROJECT_ROOT}/a.txt`, '12');
      write(fs, `${PROJECT_ROOT}/b.txt`, '345');
      const before = snapshotTree(fs);
      const expected = exportPlaygroundArchiveV1(fs, PROJECT_ROOT);
      const mkdir = vi.spyOn(fs, 'mkdirSync');
      const remove = vi.spyOn(fs, 'rmSync');
      const writeFile = vi.spyOn(fs, 'writeFileSync');
      const rename = vi.spyOn(fs, 'renameSync');

      expect(() =>
        exportPlaygroundArchiveV1(
          fs,
          PROJECT_ROOT,
          reduceLimit(exactFixtureLimits(expected.length)),
        ),
      ).toThrow();
      expect(mkdir).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(rename).not.toHaveBeenCalled();
      expect(snapshotTree(fs)).toEqual(before);
    },
  );

  it('accepts import exactly at every budget and counts JSON in UTF-16 code units', () => {
    const fs = new MemoryFsSync();
    const json = archive([file('\ud83d\ude00.txt', '12'), file('b.txt', '345')]);
    const instrumented = instrumentedImportCodec();

    expect(encoder.encode(json).byteLength).toBeGreaterThan(json.length);
    preparePlaygroundArchiveV1Import(
      fs,
      PROJECT_ROOT,
      json,
      exactFixtureLimits(json.length),
      instrumented.codec,
    ).apply();

    expect(instrumented.parseJson).toHaveBeenCalledTimes(1);
    expect(instrumented.decodeCanonicalBase64).toHaveBeenCalledTimes(2);
    expect(snapshotTree(fs)).toEqual({
      '/b.txt': [...encoder.encode('345')],
      '/\ud83d\ude00.txt': [...encoder.encode('12')],
    });
  });

  it.each([
    [
      'archive JSON code units',
      (exact: PlaygroundArchiveV1Limits) => ({
        ...exact,
        maxJsonCodeUnits: exact.maxJsonCodeUnits - 1,
      }),
      0,
    ],
    ['file count', (exact: PlaygroundArchiveV1Limits) => ({ ...exact, maxFiles: 1 }), 1],
    [
      'decoded bytes of one file',
      (exact: PlaygroundArchiveV1Limits) => ({
        ...exact,
        maxDecodedFileBytes: 2,
      }),
      1,
    ],
    [
      'total decoded bytes',
      (exact: PlaygroundArchiveV1Limits) => ({
        ...exact,
        maxTotalDecodedBytes: 4,
      }),
      1,
    ],
  ] satisfies readonly [
    string,
    (exact: PlaygroundArchiveV1Limits) => PlaygroundArchiveV1Limits,
    0 | 1,
  ][])(
    'rejects import over the %s budget before parse/decode allocation or filesystem effects',
    (_case, reduceLimit, expectedParseCalls) => {
      const json = archive([file('a.txt', '12'), file('b.txt', '345')]);

      expectImportBudgetRejectionBeforeEffects(
        json,
        reduceLimit(exactFixtureLimits(json.length)),
        expectedParseCalls,
      );
    },
  );
});

describe('Playground archive v1 export contract', () => {
  it('sorts paths by raw JavaScript code units, not locale collation', () => {
    const fs = new MemoryFsSync();
    write(fs, `${PROJECT_ROOT}/a.ts`, 'lower');
    write(fs, `${PROJECT_ROOT}/Z.ts`, 'upper');
    const rawCodeUnitOrder = ['Z.ts', 'a.ts'];

    expect('Z.ts' < 'a.ts').toBe(true);
    expect([...rawCodeUnitOrder].sort((left, right) => left.localeCompare(right))).not.toEqual(
      rawCodeUnitOrder,
    );
    expect(
      (JSON.parse(exportPlaygroundArchiveV1(fs, PROJECT_ROOT)) as ArchiveV1).files.map(
        ({ path }) => path,
      ),
    ).toEqual(rawCodeUnitOrder);
  });

  it('uses public root, canonical base64 and deterministic relative-path ordering', () => {
    const fs = new MemoryFsSync();
    write(fs, `${PROJECT_ROOT}/src/z.ts`, 'z');
    write(fs, `${PROJECT_ROOT}/a.txt`, 'a');
    write(fs, `${PROJECT_ROOT}/src/a.ts`, new Uint8Array([0, 255, 1]));
    write(fs, `${PROJECT_ROOT}/.env`, 'env');

    const first = exportPlaygroundArchiveV1(fs, PROJECT_ROOT);
    const second = exportPlaygroundArchiveV1(fs, PROJECT_ROOT);
    const parsed = JSON.parse(first) as ArchiveV1;

    expect(first).toBe(second);
    expect(first).toBe(JSON.stringify(parsed));
    expect(Reflect.ownKeys(parsed)).toEqual(['version', 'root', 'files']);
    expect(parsed).toEqual({
      version: 1,
      root: '/',
      files: [
        { path: '.env', encoding: 'base64', content: 'ZW52' },
        { path: 'a.txt', encoding: 'base64', content: 'YQ==' },
        { path: 'src/a.ts', encoding: 'base64', content: 'AP8B' },
        { path: 'src/z.ts', encoding: 'base64', content: 'eg==' },
      ],
    });
    for (const entry of parsed.files) {
      expect(Reflect.ownKeys(entry)).toEqual(['path', 'encoding', 'content']);
      expect(entry.path.startsWith('/')).toBe(false);
      expect(entry.path).not.toContain(PROJECT_ROOT);
    }
  });

  it('excludes every derived tree and private authority namespace at any depth', () => {
    const fs = new MemoryFsSync();
    write(fs, `${PROJECT_ROOT}/src/main.ts`, 'kept');
    write(fs, `${PROJECT_ROOT}/node_modules/pkg/index.js`, 'derived');
    write(fs, `${PROJECT_ROOT}/.git/config`, 'private');
    write(fs, `${PROJECT_ROOT}/.vite/deps/pkg.js`, 'derived');
    write(fs, `${PROJECT_ROOT}/dist/bundle.js`, 'derived');
    write(fs, `${PROJECT_ROOT}/nested/node_modules/pkg/index.js`, 'nested-derived');
    write(fs, `${PROJECT_ROOT}/nested/.git/config`, 'nested-private');
    write(fs, `${PROJECT_ROOT}/nested/.vite/deps/pkg.js`, 'nested-derived');
    write(fs, `${PROJECT_ROOT}/nested/dist/bundle.js`, 'nested-derived');
    write(fs, `${PROJECT_ROOT}/.rifty/install/claim.json`, 'authority');
    write(fs, `${PROJECT_ROOT}/nested/.rifty/private.json`, 'nested-authority');
    write(fs, `${PROJECT_ROOT}/node_modules/.rifty-install-stamp.json`, 'claim');
    write(fs, `${PROJECT_ROOT}/distillery/source.ts`, 'lookalike-kept');
    write(fs, `${PROJECT_ROOT}/.github/workflows/check.yml`, 'lookalike-kept');

    const parsed = JSON.parse(exportPlaygroundArchiveV1(fs, PROJECT_ROOT)) as ArchiveV1;

    expect(parsed.files).toEqual([
      file('.github/workflows/check.yml', 'lookalike-kept'),
      file('distillery/source.ts', 'lookalike-kept'),
      file('src/main.ts', 'kept'),
    ]);
  });

  it.each([
    ['top-level directory', 'directory', PROJECT_ROOT],
    ['nested directory', 'directory', `${PROJECT_ROOT}/src`],
    ['top-level file', 'file', `${PROJECT_ROOT}/top.txt`],
    ['nested file', 'file', `${PROJECT_ROOT}/src/main.ts`],
  ] as const)(
    'propagates an exact read failure for a %s instead of returning a partial archive',
    (_case, kind, failedPath) => {
      const fs = new MemoryFsSync();
      write(fs, `${PROJECT_ROOT}/top.txt`, 'must-not-disappear');
      write(fs, `${PROJECT_ROOT}/src/main.ts`, 'must-not-disappear');
      write(fs, '/outside/keep.txt', 'outside');
      const before = snapshotWholeFs(fs);
      const readDirectory = fs.readdirSync.bind(fs);
      const readFile = fs.readFileBytesSync.bind(fs);
      const failure = new Error(`permission denied: ${failedPath}`);
      fs.readdirSync = ((path: string) => {
        if (kind === 'directory' && path === failedPath) throw failure;
        return readDirectory(path);
      }) as FsSync['readdirSync'];
      fs.readFileBytesSync = ((path: string) => {
        if (kind === 'file' && path === failedPath) throw failure;
        return readFile(path);
      }) as FsSync['readFileBytesSync'];
      const mkdir = vi.spyOn(fs, 'mkdirSync');
      const remove = vi.spyOn(fs, 'rmSync');
      const writeFile = vi.spyOn(fs, 'writeFileSync');
      const rename = vi.spyOn(fs, 'renameSync');
      let partialArchive: string | undefined;

      expect(() => {
        partialArchive = exportPlaygroundArchiveV1(fs, PROJECT_ROOT);
      }).toThrow(failure);
      expect(partialArchive).toBeUndefined();
      expect(mkdir).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(rename).not.toHaveBeenCalled();
      fs.readdirSync = readDirectory as FsSync['readdirSync'];
      fs.readFileBytesSync = readFile as FsSync['readFileBytesSync'];
      expect(snapshotWholeFs(fs)).toEqual(before);
    },
  );
});

describe('Playground archive v1 strict import boundary', () => {
  const invalidLastCases: readonly InvalidLastCase[] = [
    {
      name: 'schema',
      json: JSON.stringify({
        version: 1,
        root: '/',
        files: [file('valid-first.txt', 'valid'), { path: 'invalid-last.txt', content: 'YQ==' }],
      }),
    },
    {
      name: 'path',
      json: archive([file('valid-first.txt', 'valid'), file('../invalid-last.txt', 'invalid')]),
    },
    {
      name: 'base64',
      json: JSON.stringify({
        version: 1,
        root: '/',
        files: [
          file('valid-first.txt', 'valid'),
          { path: 'invalid-last.txt', encoding: 'base64', content: 'YQ===' },
        ],
      }),
    },
    {
      name: 'reserved path',
      json: archive([
        file('valid-first.txt', 'valid'),
        file('nested/.rifty/invalid-last.json', 'invalid'),
      ]),
    },
    {
      name: 'collision',
      json: archive([file('valid-first.txt', 'valid'), file('valid-first.txt', 'invalid-last')]),
    },
    (() => {
      const json = archive([file('valid-first.txt', 'a'), file('bounded-invalid-last.txt', 'b')]);
      return {
        name: 'bound',
        json,
        limits: {
          maxJsonCodeUnits: json.length,
          maxFiles: 1,
          maxDecodedFileBytes: 1,
          maxTotalDecodedBytes: 2,
        },
      } satisfies InvalidLastCase;
    })(),
  ];

  it.each([
    ['invalid JSON', '{'],
    ['non-object', JSON.stringify(null)],
    ['array', JSON.stringify([])],
    ['missing version', JSON.stringify({ root: '/', files: [] })],
    ['missing root', JSON.stringify({ version: 1, files: [] })],
    ['wrong version', JSON.stringify({ version: 2, root: '/', files: [] })],
    ['owner root', JSON.stringify({ version: 1, root: PROJECT_ROOT, files: [] })],
    ['relative root', JSON.stringify({ version: 1, root: '.', files: [] })],
    ['missing files', JSON.stringify({ version: 1, root: '/' })],
    ['non-array files', JSON.stringify({ version: 1, root: '/', files: {} })],
    [
      'unknown archive key',
      JSON.stringify({ version: 1, root: '/', files: [], projectId: 'project-a' }),
    ],
    ['non-object file', JSON.stringify({ version: 1, root: '/', files: [null] })],
    [
      'missing path',
      JSON.stringify({
        version: 1,
        root: '/',
        files: [{ encoding: 'base64', content: 'YQ==' }],
      }),
    ],
    [
      'missing encoding',
      JSON.stringify({
        version: 1,
        root: '/',
        files: [{ path: 'a', content: 'YQ==' }],
      }),
    ],
    [
      'missing content',
      JSON.stringify({ version: 1, root: '/', files: [{ path: 'a', encoding: 'base64' }] }),
    ],
    [
      'non-string path',
      JSON.stringify({
        version: 1,
        root: '/',
        files: [{ path: 1, encoding: 'base64', content: 'YQ==' }],
      }),
    ],
    [
      'unknown file key',
      JSON.stringify({
        version: 1,
        root: '/',
        files: [{ ...file('a'), mode: 0o644 }],
      }),
    ],
    [
      'wrong encoding',
      JSON.stringify({
        version: 1,
        root: '/',
        files: [{ path: 'a', encoding: 'utf8', content: 'a' }],
      }),
    ],
    [
      'non-string content',
      JSON.stringify({
        version: 1,
        root: '/',
        files: [{ path: 'a', encoding: 'base64', content: null }],
      }),
    ],
  ])('rejects %s before touching the live root', (_case, json) => {
    expectImportRejectionBeforeAnyFilesystemEffect(json);
  });

  it.each([
    '',
    '/absolute.ts',
    'trailing/',
    './dot.ts',
    'src/./dot.ts',
    '../escape.ts',
    'src/../escape.ts',
    'src//double.ts',
    'src\\windows.ts',
    'src/\0nul.ts',
  ])('rejects the non-normalized relative path %j before mutation', (path) => {
    expectImportRejectionBeforeAnyFilesystemEffect(archive([file(path)]));
  });

  it.each([
    'node_modules/pkg/index.js',
    'nested/node_modules/pkg/index.js',
    '.git/config',
    'nested/.git/config',
    '.vite/deps/pkg.js',
    'nested/.vite/deps/pkg.js',
    'dist/bundle.js',
    'nested/dist/bundle.js',
    '.rifty/install/claim.json',
    'nested/.rifty/private.json',
    'node_modules/.rifty-install-stamp.json',
  ])('rejects the derived or authority-owned path %s before mutation', (path) => {
    expectImportRejectionBeforeAnyFilesystemEffect(archive([file(path)]));
  });

  it.each(['YQ', 'YQ===', 'Y Q==', 'YR==', '***=', '=YQ=', 'YQ==\n'])(
    'rejects non-canonical base64 %j before mutation',
    (content) => {
      const json = JSON.stringify({
        version: 1,
        root: '/',
        files: [{ path: 'next.txt', encoding: 'base64', content }],
      });

      expectImportRejectionBeforeAnyFilesystemEffect(json);
    },
  );

  it.each([
    ['exact duplicate', ['a.txt', 'a.txt']],
    ['normalized duplicate', ['src/a.ts', 'src//a.ts']],
    ['ancestor before child', ['src', 'src/a.ts']],
    ['child before ancestor', ['src/a.ts', 'src']],
  ])('rejects %s collisions before mutation', (_case, paths) => {
    expectImportRejectionBeforeAnyFilesystemEffect(archive(paths.map((path) => file(path))));
  });

  it('accepts an empty archive as an exact empty project replacement', () => {
    const fs = new MemoryFsSync();
    write(fs, `${PROJECT_ROOT}/old.txt`, 'old');

    importInto(fs, archive([]));

    expect(fs.statSyncOrNull(PROJECT_ROOT)?.isDirectory).toBe(true);
    expect(snapshotTree(fs)).toEqual({});
  });

  it('round-trips a zero-byte file and allows non-reserved lookalike segments', () => {
    const fs = new MemoryFsSync();

    importInto(
      fs,
      archive([
        file('empty.bin', ''),
        file('distillery/source.ts', 'kept'),
        file('.github/workflows/check.yml', 'kept'),
      ]),
    );

    expect(snapshotTree(fs)).toEqual({
      '/.github/workflows/check.yml': [...encoder.encode('kept')],
      '/distillery/source.ts': [...encoder.encode('kept')],
      '/empty.bin': [],
    });
  });

  it.each(invalidLastCases)(
    'fully validates a valid-first/$name-invalid-last archive before any filesystem effect',
    ({ json, limits }) => {
      expectImportRejectionBeforeAnyFilesystemEffect(json, limits ?? PLAYGROUND_ARCHIVE_V1_LIMITS);
    },
  );

  it('replaces only the fixed live project root after complete validation', () => {
    const fs = new MemoryFsSync();
    write(fs, `${PROJECT_ROOT}/old.txt`, 'old');
    write(fs, `${PROJECT_ROOT}/src/stale.ts`, 'stale');
    const sibling = '/.rifty/workbench/v1/projects/project-b/tree/keep.txt';
    write(fs, sibling, 'other project');

    importInto(fs, archive([file('package.json', '{}\n'), file('src/main.ts', 'next')]));

    expect(snapshotTree(fs)).toEqual({
      '/package.json': [...encoder.encode('{}\n')],
      '/src/main.ts': [...encoder.encode('next')],
    });
    expect(decoder.decode(fs.readFileBytesSync(sibling))).toBe('other project');
  });
});

describe('Playground archive atomic import', () => {
  it('leaves the original root exact when staging a decoded file fails', () => {
    const fs = new MemoryFsSync();
    write(fs, `${PROJECT_ROOT}/keep.txt`, 'keep');
    write(fs, `${PROJECT_ROOT}/src/main.ts`, 'original');
    write(fs, '/outside/keep.txt', 'outside');
    fs.mkdirSync('/outside/empty', { recursive: true });
    const before = snapshotWholeFs(fs);
    const writeFile = fs.writeFileSync.bind(fs);
    const failure = new Error('quota while staging archive');
    let injected = false;
    fs.writeFileSync = ((path: string, data: Uint8Array) => {
      if (!injected && decoder.decode(data) === 'explode') {
        injected = true;
        throw failure;
      }
      writeFile(path, data);
    }) as FsSync['writeFileSync'];
    const prepared = preparePlaygroundArchiveV1Import(
      fs,
      PROJECT_ROOT,
      archive([file('a.txt', 'first'), file('z.txt', 'explode')]),
    );

    expect(() => prepared.apply()).toThrow(failure);
    expect(snapshotWholeFs(fs)).toEqual(before);
  });

  it('leaves only an exact rollback or exact promoted tree for private recovery after a live fault', () => {
    const fs = new MemoryFsSync();
    write(fs, `${PROJECT_ROOT}/keep.txt`, 'keep');
    write(fs, `${PROJECT_ROOT}/src/main.ts`, 'original');
    write(fs, '/outside/keep.txt', 'outside');
    fs.mkdirSync('/outside/empty', { recursive: true });
    const before = snapshotWholeFs(fs);
    const completedFs = new MemoryFsSync();
    write(completedFs, `${PROJECT_ROOT}/a.txt`, 'first');
    write(completedFs, `${PROJECT_ROOT}/z.txt`, 'second');
    write(completedFs, '/outside/keep.txt', 'outside');
    completedFs.mkdirSync('/outside/empty', { recursive: true });
    const completed = snapshotWholeFs(completedFs);
    const remove = fs.rmSync.bind(fs);
    const mkdir = fs.mkdirSync.bind(fs);
    const writeFile = fs.writeFileSync.bind(fs);
    const rename = fs.renameSync.bind(fs);
    const failure = new Error('durability failure after a live-root mutation');
    let liveMutations = 0;
    let injected = false;
    const touchesLiveRoot = (path: string): boolean =>
      path === PROJECT_ROOT || path.startsWith(`${PROJECT_ROOT}/`);
    const injectBeforeSecondLiveMutation = (...paths: readonly string[]): void => {
      if (injected || !paths.some(touchesLiveRoot)) return;
      liveMutations += 1;
      if (liveMutations === 2) {
        injected = true;
        throw failure;
      }
    };
    fs.rmSync = ((path: string, options: { recursive?: boolean; force?: boolean }) => {
      injectBeforeSecondLiveMutation(path);
      remove(path, options);
    }) as FsSync['rmSync'];
    fs.mkdirSync = ((path: string, options: { recursive?: boolean }) => {
      injectBeforeSecondLiveMutation(path);
      mkdir(path, options);
    }) as FsSync['mkdirSync'];
    fs.writeFileSync = ((path: string, data: Uint8Array) => {
      injectBeforeSecondLiveMutation(path);
      writeFile(path, data);
    }) as FsSync['writeFileSync'];
    fs.renameSync = ((source: string, target: string) => {
      injectBeforeSecondLiveMutation(source, target);
      rename(source, target);
    }) as FsSync['renameSync'];
    const prepared = preparePlaygroundArchiveV1Import(
      fs,
      PROJECT_ROOT,
      archive([file('a.txt', 'first'), file('z.txt', 'second')]),
    );

    expect(() => prepared.apply()).toThrow(failure);
    expect(injected).toBe(true);
    // Shared-fixture ordinal/restart coverage will replace this structural
    // proof. Until then, permit rollback or a private exact backup+stage only.
    expectRollbackOrPrivateRecovery(before, completed, snapshotWholeFs(fs));
  });

  it('performs no mkdir, remove, write or rename anywhere while malformed input is rejected', () => {
    const fs = new MemoryFsSync();
    write(fs, `${PROJECT_ROOT}/keep.txt`, 'keep');
    write(fs, '/outside/keep.txt', 'outside');
    fs.mkdirSync('/outside/empty', { recursive: true });
    const before = snapshotWholeFs(fs);
    const mkdir = vi.spyOn(fs, 'mkdirSync');
    const remove = vi.spyOn(fs, 'rmSync');
    const writeFile = vi.spyOn(fs, 'writeFileSync');
    const rename = vi.spyOn(fs, 'renameSync');
    const malformed = archive([file('src'), file('src/main.ts')]);

    expect(() => preparePlaygroundArchiveV1Import(fs, PROJECT_ROOT, malformed)).toThrow();
    expect(mkdir).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(snapshotWholeFs(fs)).toEqual(before);
  });
});
