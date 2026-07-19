import { describe, expect, it, vi } from 'vitest';
import type { PlaygroundScm, PlaygroundScmChange } from '@riftydev/workbench/playground';
import type { ProjectDocument, ProjectDocuments } from '@riftydev/workbench';
import type {
  ProjectFileRead,
  ProjectFiles,
  ProjectFilesSnapshot,
} from '@riftydev/workbench';
import type { ProjectFileEntry } from '@riftydev/workbench';
import {
  createPlaygroundDocumentWriter,
  createPlaygroundFileMutations,
  createPlaygroundProjectMirror,
  preparePlaygroundOwnerByteOperation,
  readPlaygroundEditorRemoteFile,
  readPlaygroundGitOriginalText,
} from './playground-project-view.ts';

const encoder = new TextEncoder();

function entry(
  path: string,
  kind: ProjectFileEntry['kind'],
  version: string,
  size = 0,
): ProjectFileEntry {
  return Object.freeze({ path, kind, version, size });
}

function filesHarness(initial: {
  readonly entries: readonly ProjectFileEntry[];
  readonly bytes: Readonly<Record<string, string>>;
}) {
  let snapshot: ProjectFilesSnapshot = Object.freeze({
    excludedDirectoryNames: Object.freeze(['node_modules', '.git', '.vite', 'dist']),
    entries: Object.freeze([...initial.entries]),
  });
  const contents = new Map(
    Object.entries(initial.bytes).map(([path, text]) => [path, encoder.encode(text)] as const),
  );
  const listeners = new Set<(value: ProjectFilesSnapshot) => void>();
  const readFile = vi.fn(async (path: string): Promise<ProjectFileRead> => {
    const current = snapshot.entries.find((candidate) => candidate.path === path);
    const bytes = contents.get(path);
    if (current?.kind !== 'file' || bytes === undefined) throw new Error(`ENOENT ${path}`);
    return Object.freeze({ path, bytes: bytes.slice(), version: current.version });
  });
  const publish = (entries: readonly ProjectFileEntry[]): void => {
    snapshot = Object.freeze({ ...snapshot, entries: Object.freeze([...entries]) });
    for (const listener of listeners) listener(snapshot);
  };
  const files = {
    readFile,
    readdir: vi.fn(),
    writeFile: vi.fn(async (path: string, data: Uint8Array, options) => {
      const current = snapshot.entries.find((candidate) => candidate.path === path);
      expect(options.expectedVersion).toBe(current?.version ?? null);
      const version = `v${String(Number.parseInt(current?.version.slice(1) ?? '0', 10) + 1)}`;
      contents.set(path, data.slice());
      const next = snapshot.entries.filter((candidate) => candidate.path !== path);
      publish([...next, entry(path, 'file', version, data.byteLength)]);
      return { path, version };
    }),
    mkdir: vi.fn(async (path: string, options) => {
      expect(options).toEqual({ expectedVersion: null });
      publish([...snapshot.entries, entry(path, 'dir', 'v1')]);
      return { path, version: 'v1' };
    }),
    rename: vi.fn(async (from: string, to: string, options) => {
      const source = snapshot.entries.find((candidate) => candidate.path === from);
      expect(options).toEqual({
        expectedSourceVersion: source?.version,
        expectedTargetVersion: null,
      });
      if (source === undefined) throw new Error(`ENOENT ${from}`);
      const descendants = snapshot.entries.filter(
        (candidate) => candidate.path === from || candidate.path.startsWith(`${from}/`),
      );
      const untouched = snapshot.entries.filter((candidate) => !descendants.includes(candidate));
      for (const candidate of descendants) {
        const nextPath = `${to}${candidate.path.slice(from.length)}`;
        const data = contents.get(candidate.path);
        if (data !== undefined) {
          contents.delete(candidate.path);
          contents.set(nextPath, data);
        }
      }
      publish([
        ...untouched,
        ...descendants.map((candidate) =>
          entry(
            `${to}${candidate.path.slice(from.length)}`,
            candidate.kind,
            candidate.version,
            candidate.size,
          ),
        ),
      ]);
      return { path: to, version: source.version };
    }),
    remove: vi.fn(async (path: string, options) => {
      const source = snapshot.entries.find((candidate) => candidate.path === path);
      expect(options.expectedVersion).toBe(source?.version);
      for (const candidate of snapshot.entries) {
        if (candidate.path === path || candidate.path.startsWith(`${path}/`)) {
          contents.delete(candidate.path);
        }
      }
      publish(
        snapshot.entries.filter(
          (candidate) => candidate.path !== path && !candidate.path.startsWith(`${path}/`),
        ),
      );
    }),
    snapshot: () => snapshot,
    subscribe(listener: (value: ProjectFilesSnapshot) => void) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
  } satisfies ProjectFiles;
  return { files, contents, publish, readFile };
}

describe('Playground logical project view', () => {
  it('flushes live editor bytes before closing every replaced model and document tree', async () => {
    const events: string[] = [];
    const editor = {
      flushPendingWrites: vi.fn(async () => {
        events.push('editor:flush');
      }),
      closePathTree: vi.fn((path: string) => {
        events.push(`editor:close:${path}`);
      }),
    };
    const documents = {
      closeTree: vi.fn(async (path: string) => {
        events.push(`documents:close:${path}`);
      }),
    };

    await preparePlaygroundOwnerByteOperation({
      editor,
      documents,
      replacePaths: ['/src', '/src', '/README.md'],
    });

    expect(events).toEqual([
      'editor:flush',
      'editor:close:/src',
      'editor:close:/README.md',
      'documents:close:/src',
      'documents:close:/README.md',
    ]);
  });

  it('prevalidates every replacement path before flushing editor bytes', async () => {
    const editor = {
      flushPendingWrites: vi.fn(async () => {}),
      closePathTree: vi.fn(),
    };
    const documents = { closeTree: vi.fn(async () => {}) };

    await expect(
      preparePlaygroundOwnerByteOperation({
        editor,
        documents,
        replacePaths: ['/src', '../outside'],
      }),
    ).rejects.toThrow(/Invalid logical project path/u);

    expect(editor.flushPendingWrites).not.toHaveBeenCalled();
    expect(editor.closePathTree).not.toHaveBeenCalled();
    expect(documents.closeTree).not.toHaveBeenCalled();
  });

  it('reads the HEAD baseline through the staged SCM change and clean mirror', async () => {
    const staged = Object.freeze({
      path: '/README.md',
      code: 'MM',
      area: 'staged' as const,
    });
    const working = Object.freeze({
      path: '/README.md',
      code: 'MM',
      area: 'working' as const,
    });
    const changes: readonly PlaygroundScmChange[] = Object.freeze([working, staged]);
    const diff = vi.fn(async (change: PlaygroundScmChange) =>
      change.area === 'staged'
        ? Object.freeze({
            original: Object.freeze({ source: 'head' as const, bytes: encoder.encode('head\n') }),
            modified: Object.freeze({ source: 'index' as const, bytes: encoder.encode('index\n') }),
          })
        : Object.freeze({
            original: Object.freeze({ source: 'index' as const, bytes: encoder.encode('index\n') }),
            modified: Object.freeze({
              source: 'working' as const,
              bytes: encoder.encode('work\n'),
            }),
          }),
    );
    const scm = {
      snapshot: () => Object.freeze({ history: Object.freeze([]), changes }),
      diff,
    } satisfies Pick<PlaygroundScm, 'snapshot' | 'diff'>;
    const mirror = {
      ensureFile: vi.fn(async () => encoder.encode('clean\n')),
    };

    await expect(
      readPlaygroundGitOriginalText(scm, mirror, { path: '/README.md', ref: 'HEAD' }),
    ).resolves.toBe('head\n');
    await expect(
      readPlaygroundGitOriginalText(scm, mirror, { path: '/clean.js', ref: 'HEAD' }),
    ).resolves.toBe('clean\n');
    expect(diff).toHaveBeenCalledTimes(1);
    expect(diff).toHaveBeenCalledWith(staged);
    expect(mirror.ensureFile).toHaveBeenCalledWith('/clean.js');
  });

  it('bounds excluded editor reads before transferring file bytes', async () => {
    const small = new Uint8Array([0, 1, 2, 3]);
    const readFile = vi.fn(async (path: string): Promise<ProjectFileRead> => {
      if (path !== '/node_modules/pkg/index.d.ts') throw new Error(`unexpected read ${path}`);
      return Object.freeze({ path, bytes: small.slice(), version: 'small-v1' });
    });
    const readdir = vi.fn(async (path: string): Promise<readonly ProjectFileEntry[]> => {
      if (path === '/node_modules/pkg') {
        return Object.freeze([
          entry('/node_modules/pkg/index.d.ts', 'file', 'small-v1', small.byteLength),
          entry('/node_modules/pkg/large.d.ts', 'file', 'large-v1', 128 * 1024 + 1),
        ]);
      }
      throw new Error(`unexpected readdir ${path}`);
    });
    const files = { readFile, readdir } satisfies Pick<ProjectFiles, 'readFile' | 'readdir'>;

    await expect(
      readPlaygroundEditorRemoteFile(files, '/node_modules/pkg/index.d.ts'),
    ).resolves.toEqual({ size: 4, content: small });
    await expect(
      readPlaygroundEditorRemoteFile(files, '/node_modules/pkg/large.d.ts'),
    ).resolves.toEqual({ size: 128 * 1024 + 1, content: null });
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('renders only logical / paths and admits editable bytes after an exact-version read', async () => {
    const h = filesHarness({
      entries: [entry('/src', 'dir', 'v1'), entry('/src/main.ts', 'file', 'v2', 18)],
      bytes: { '/src/main.ts': 'export const x = 1;\n' },
    });
    const mirror = createPlaygroundProjectMirror(h.files);

    expect(mirror.root).toBe('/');
    expect(mirror.filePaths()).toEqual(['/src/main.ts']);
    expect(mirror.readdirSync('/').map(({ name }) => name)).toEqual(['src']);
    expect(() => mirror.readFileBytesSync('/src/main.ts')).toThrow(/not loaded/i);

    await mirror.ensureFile('/src/main.ts');

    expect(new TextDecoder().decode(mirror.readFileBytesSync('/src/main.ts'))).toBe(
      'export const x = 1;\n',
    );
    expect(mirror.version('/src/main.ts')).toBe('v2');
    mirror.dispose();
  });

  it('drops cached bytes when the owner publishes a newer version and never serves them as current', async () => {
    const h = filesHarness({
      entries: [entry('/main.js', 'file', 'v1', 3)],
      bytes: { '/main.js': 'one' },
    });
    const mirror = createPlaygroundProjectMirror(h.files);
    await mirror.ensureFile('/main.js');
    h.contents.set('/main.js', encoder.encode('two'));
    h.publish([entry('/main.js', 'file', 'v2', 3)]);

    expect(() => mirror.readFileBytesSync('/main.js')).toThrow(/not loaded/i);
    await mirror.ensureFile('/main.js');
    expect(new TextDecoder().decode(mirror.readFileBytesSync('/main.js'))).toBe('two');
    mirror.dispose();
  });

  it('threads owner-published versions through every FileExplorer mutation', async () => {
    const h = filesHarness({
      entries: [entry('/src', 'dir', 'v1'), entry('/src/a.js', 'file', 'v4', 1)],
      bytes: { '/src/a.js': 'a' },
    });
    const mirror = createPlaygroundProjectMirror(h.files);
    const beforeMutation = vi.fn(async () => {});
    const mutations = createPlaygroundFileMutations(h.files, mirror, beforeMutation);

    await mutations.writeFile('/src/a.js', encoder.encode('b'));
    await mutations.createFile('/src/new.js');
    await mutations.createDir('/assets');
    await mutations.renamePath('/src/new.js', '/src/renamed.js');
    await mutations.deletePath('/src/renamed.js');

    expect(beforeMutation).toHaveBeenCalledTimes(5);
    expect(h.files.writeFile).toHaveBeenNthCalledWith(1, '/src/a.js', expect.any(Uint8Array), {
      expectedVersion: 'v4',
    });
    expect(h.files.writeFile).toHaveBeenNthCalledWith(2, '/src/new.js', expect.any(Uint8Array), {
      expectedVersion: null,
    });
    mirror.dispose();
  });

  it.each(['rename', 'delete'] as const)(
    '%s samples its source version after the editor-write preflight',
    async (operation) => {
      const h = filesHarness({
        entries: [entry('/src', 'dir', 'v1'), entry('/src/a.js', 'file', 'v1', 1)],
        bytes: { '/src/a.js': 'a' },
      });
      const mirror = createPlaygroundProjectMirror(h.files);
      const beforeMutation = vi.fn(async () => {
        h.publish([entry('/src', 'dir', 'v1'), entry('/src/a.js', 'file', 'v2', 1)]);
      });
      const mutations = createPlaygroundFileMutations(h.files, mirror, beforeMutation);

      if (operation === 'rename') {
        await mutations.renamePath('/src/a.js', '/src/b.js');
        expect(h.files.rename).toHaveBeenCalledWith('/src/a.js', '/src/b.js', {
          expectedSourceVersion: 'v2',
          expectedTargetVersion: null,
        });
      } else {
        await mutations.deletePath('/src/a.js');
        expect(h.files.remove).toHaveBeenCalledWith('/src/a.js', {
          expectedVersion: 'v2',
        });
      }
      mirror.dispose();
    },
  );

  it('prevalidates every renameMany path before editor preflight or owner mutation', async () => {
    const h = filesHarness({
      entries: [
        entry('/src', 'dir', 'v1'),
        entry('/src/a.js', 'file', 'v1', 1),
        entry('/src/c.js', 'file', 'v1', 1),
      ],
      bytes: { '/src/a.js': 'a', '/src/c.js': 'c' },
    });
    const mirror = createPlaygroundProjectMirror(h.files);
    const beforeMutation = vi.fn(async () => {});
    const mutations = createPlaygroundFileMutations(h.files, mirror, beforeMutation);

    await expect(
      mutations.renameMany([
        { from: '/src/a.js', to: '/src/b.js' },
        { from: '/src/c.js', to: '../outside.js' },
      ]),
    ).rejects.toThrow(/Invalid logical project path/);

    expect(beforeMutation).not.toHaveBeenCalled();
    expect(h.files.rename).not.toHaveBeenCalled();
    expect(mirror.filePaths()).toEqual(['/src/a.js', '/src/c.js']);
    mirror.dispose();
  });

  it('prevalidates every writeFiles path before editor preflight or owner mutation', async () => {
    const h = filesHarness({
      entries: [entry('/src', 'dir', 'v1'), entry('/src/a.js', 'file', 'v1', 1)],
      bytes: { '/src/a.js': 'a' },
    });
    const mirror = createPlaygroundProjectMirror(h.files);
    const beforeMutation = vi.fn(async () => {});
    const mutations = createPlaygroundFileMutations(h.files, mirror, beforeMutation);

    await expect(
      mutations.writeFiles([
        { path: '/src/a.js', data: encoder.encode('changed') },
        { path: '../outside.js', data: encoder.encode('outside') },
      ]),
    ).rejects.toThrow(/Invalid logical project path/);

    expect(beforeMutation).not.toHaveBeenCalled();
    expect(h.files.writeFile).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(h.contents.get('/src/a.js'))).toBe('a');
    mirror.dispose();
  });
});

describe('Playground editor Documents binding', () => {
  it('keeps one public document per path and saves the exact editor text', async () => {
    const replace = vi.fn();
    const save = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const document = {
      path: '/src/main.ts',
      snapshot: vi.fn(),
      replace,
      save,
      close,
    } satisfies ProjectDocument;
    const documents = { open: vi.fn(async () => document) } satisfies ProjectDocuments;
    const writer = createPlaygroundDocumentWriter(documents);

    await writer.write('/src/main.ts', 'const x = 1;\n');
    await writer.write('/src/main.ts', 'const x = 2;\n');
    await writer.closeTree('/src');

    expect(documents.open).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenNthCalledWith(1, 'const x = 1;\n');
    expect(replace).toHaveBeenNthCalledWith(2, 'const x = 2;\n');
    expect(save).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
