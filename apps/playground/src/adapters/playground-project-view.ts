import { type VfsDirent, dirname, isAbsolute, normalizePath } from '@riftydev/vfs';
import type { FileExplorerMutations } from '../components/FileExplorer.tsx';
import type { EditorApi } from '../components/editor-host-core.ts';
import { type FsOpsTarget, looksBinary } from '../glue/fs-ops.ts';
import { NODE_MODULES_MAX_CONTENT_BYTES } from '../glue/node-modules-model.ts';
import type { PlaygroundScm } from '../workbench/playground.ts';
import type {
  ProjectDocument,
  ProjectDocuments,
  ProjectFileEntry,
  ProjectFiles,
  ProjectFilesSnapshot,
} from '../workbench/public.ts';

interface CachedFile {
  readonly version: string;
  readonly bytes: Uint8Array;
}

export interface PlaygroundProjectMirror extends FsOpsTarget {
  readonly root: '/';
  filePaths(): readonly string[];
  version(path: string): string | null;
  ensureFile(path: string): Promise<Uint8Array>;
  dispose(): void;
}

export interface PlaygroundDocumentWriter {
  write(path: string, text: string): Promise<void>;
  closeTree(path: string): Promise<void>;
  closeAll(): Promise<void>;
}

export interface PlaygroundOwnerByteOperationOptions {
  readonly editor: Pick<EditorApi, 'flushPendingWrites' | 'closePathTree'> | null | undefined;
  readonly documents: Pick<PlaygroundDocumentWriter, 'closeTree'>;
  /** Trees whose owner bytes the operation may replace. Empty means read-only. */
  readonly replacePaths?: readonly string[];
}

export interface PlaygroundEditorRemoteFile {
  readonly size: number;
  readonly content: Uint8Array | null;
}

export interface PlaygroundGitOriginalTextInput {
  readonly path: string;
  readonly ref: string;
}

function projectPath(value: string): string {
  if (!isAbsolute(value) || value.includes('\0') || normalizePath(value) !== value) {
    throw new TypeError(`Invalid logical project path ${JSON.stringify(value)}`);
  }
  return value;
}

function pathInside(path: string, root: string): boolean {
  return path === root || (root === '/' ? path.startsWith('/') : path.startsWith(`${root}/`));
}

/** One App-level gate from live Monaco bytes to owner reads/replacements. */
export async function preparePlaygroundOwnerByteOperation(
  options: PlaygroundOwnerByteOperationOptions,
): Promise<void> {
  const replacePaths = [...new Set((options.replacePaths ?? []).map((path) => projectPath(path)))];
  await options.editor?.flushPendingWrites();
  for (const path of replacePaths) options.editor?.closePathTree(path);
  for (const path of replacePaths) await options.documents.closeTree(path);
}

function readOnly(op: string, path: string): never {
  throw new Error(`${op}: ${JSON.stringify(path)} is an owner-authoritative read view`);
}

function decodeProjectText(label: string, bytes: Uint8Array): string {
  if (looksBinary(bytes)) throw new Error(`${label} is binary; text diff is unavailable`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8; text diff is unavailable`);
  }
}

function parentPaths(path: string): readonly string[] {
  const result: string[] = [];
  let parent = dirname(path);
  while (parent !== '/') {
    result.push(parent);
    parent = dirname(parent);
  }
  return result.reverse();
}

/** Lazy excluded-tree read for EditorHost; metadata prevents known oversized transfers. */
export async function readPlaygroundEditorRemoteFile(
  files: Pick<ProjectFiles, 'readFile' | 'readdir'>,
  path: string,
): Promise<PlaygroundEditorRemoteFile> {
  const logical = projectPath(path);
  const entry = (await files.readdir(dirname(logical))).find(
    (candidate) => candidate.path === logical,
  );
  if (entry?.kind !== 'file') throw new Error(`ENOENT: no such project file ${logical}`);
  if (entry.size > NODE_MODULES_MAX_CONTENT_BYTES) {
    return Object.freeze({ size: entry.size, content: null });
  }
  const read = await files.readFile(logical);
  const size = read.bytes.byteLength;
  if (size > NODE_MODULES_MAX_CONTENT_BYTES) {
    return Object.freeze({ size, content: null });
  }
  if (read.version === entry.version && size !== entry.size) {
    throw new Error(`Project file ${logical} size changed without a version change`);
  }
  return Object.freeze({ size, content: read.bytes.slice() });
}

/** HEAD text for editor dirty gutters; staged wins so MM compares against HEAD, not index. */
export async function readPlaygroundGitOriginalText(
  scm: Pick<PlaygroundScm, 'snapshot' | 'diff'>,
  mirror: Pick<PlaygroundProjectMirror, 'ensureFile'>,
  input: PlaygroundGitOriginalTextInput,
): Promise<string> {
  if (input.ref !== 'HEAD') throw new Error(`Unsupported Git original ref ${input.ref}`);
  const path = projectPath(input.path);
  const changes = scm.snapshot().changes.filter((change) => change.path === path);
  const change =
    changes.find((candidate) => candidate.area === 'staged') ??
    changes.find((candidate) => candidate.area === 'working');
  if (change === undefined) {
    return decodeProjectText(`HEAD:${path}`, await mirror.ensureFile(path));
  }
  const original = (await scm.diff(change)).original;
  if (original.source !== 'head' && original.source !== 'empty') {
    throw new Error(`SCM ${change.area} diff for ${path} did not expose its HEAD baseline`);
  }
  return decodeProjectText(`HEAD:${path}`, original.bytes);
}

/** Sync read view for existing UI components; bytes enter only after an exact public read. */
export function createPlaygroundProjectMirror(files: ProjectFiles): PlaygroundProjectMirror {
  const listeners = new Set<() => void>();
  let snapshot = files.snapshot();
  let entries = new Map(snapshot.entries.map((entry) => [entry.path, entry] as const));
  const cache = new Map<string, CachedFile>();
  let disposed = false;

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        globalThis.reportError?.(error);
      }
    }
  };

  const apply = (next: ProjectFilesSnapshot): void => {
    if (disposed) return;
    snapshot = next;
    entries = new Map(next.entries.map((entry) => [entry.path, entry] as const));
    for (const [path, cached] of cache) {
      if (entries.get(path)?.version !== cached.version) cache.delete(path);
    }
    notify();
  };

  const unsubscribe = files.subscribe(apply);

  const mirror: PlaygroundProjectMirror = {
    root: '/',
    readOnly: true,

    filePaths() {
      return Object.freeze(
        [...entries.values()]
          .filter((entry) => entry.kind === 'file')
          .map((entry) => entry.path)
          .sort(),
      );
    },

    version(path) {
      return entries.get(projectPath(path))?.version ?? null;
    },

    async ensureFile(path) {
      const logical = projectPath(path);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (disposed) throw new Error('Playground project mirror is closed');
        const expected = entries.get(logical);
        if (expected?.kind !== 'file') throw new Error(`ENOENT: no such project file ${logical}`);
        const existing = cache.get(logical);
        if (existing?.version === expected.version) return existing.bytes.slice();
        const read = await files.readFile(logical);
        const current = entries.get(logical);
        if (current?.kind === 'file' && current.version === read.version) {
          const bytes = read.bytes.slice();
          cache.set(logical, { version: read.version, bytes });
          notify();
          return bytes.slice();
        }
      }
      throw new Error(`Project file ${logical} changed during four exact reads`);
    },

    existsSync(path) {
      const logical = projectPath(path);
      return logical === '/' || entries.has(logical);
    },

    readFileBytesSync(path) {
      const logical = projectPath(path);
      const entry = entries.get(logical);
      if (entry?.kind !== 'file') throw new Error(`ENOENT: no such project file ${logical}`);
      const cached = cache.get(logical);
      if (cached?.version !== entry.version) {
        throw new Error(`Project file ${logical} is not loaded at version ${entry.version}`);
      }
      return cached.bytes.slice();
    },

    readdirSync(path) {
      const logical = projectPath(path);
      if (logical !== '/' && entries.get(logical)?.kind !== 'dir') {
        throw new Error(`ENOENT: no such project directory ${logical}`);
      }
      const children: VfsDirent[] = [];
      for (const entry of entries.values()) {
        if (dirname(entry.path) !== logical) continue;
        children.push({
          name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
          isFile: entry.kind === 'file',
          isDirectory: entry.kind === 'dir',
        });
      }
      return children.sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
        const a = left.name.toLowerCase();
        const b = right.name.toLowerCase();
        return a < b ? -1 : a > b ? 1 : 0;
      });
    },

    statSync(path) {
      const logical = projectPath(path);
      if (logical === '/') return { isFile: false, isDirectory: true, size: 0 };
      const entry = entries.get(logical);
      if (entry === undefined) throw new Error(`ENOENT: no such project path ${logical}`);
      return {
        isFile: entry.kind === 'file',
        isDirectory: entry.kind === 'dir',
        size: entry.size,
      };
    },

    writeFileSync: (path) => readOnly('writeFileSync', path),
    mkdirSync: (path) => readOnly('mkdirSync', path),
    rmSync: (path) => readOnly('rmSync', path),
    renameSync: (path) => readOnly('renameSync', path),

    subscribe(listener) {
      if (disposed) throw new Error('Playground project mirror is closed');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      listeners.clear();
      cache.clear();
      snapshot = Object.freeze({
        excludedDirectoryNames: snapshot.excludedDirectoryNames,
        entries: Object.freeze([]),
      });
      entries.clear();
    },
  };

  return mirror;
}

function requiredEntry(mirror: PlaygroundProjectMirror, path: string): ProjectFileEntry {
  const logical = projectPath(path);
  const version = mirror.version(logical);
  if (version === null) throw new Error(`ENOENT: no such project path ${logical}`);
  const stat = mirror.statSync(logical);
  return {
    path: logical,
    kind: stat.isDirectory ? 'dir' : 'file',
    size: stat.size ?? 0,
    version,
  };
}

async function ensureParents(files: ProjectFiles, mirror: PlaygroundProjectMirror, path: string) {
  for (const parent of parentPaths(path)) {
    if (!mirror.existsSync(parent)) await files.mkdir(parent, { expectedVersion: null });
    else if (!mirror.statSync(parent).isDirectory) {
      throw new Error(`Project write parent is not a directory: ${parent}`);
    }
  }
}

/** ProjectFiles-backed mutation target for FileExplorer; no owner bridge escapes to the page. */
export function createPlaygroundFileMutations(
  files: ProjectFiles,
  mirror: PlaygroundProjectMirror,
  beforeMutation: (paths: readonly string[]) => Promise<void>,
): FileExplorerMutations {
  const write = async (path: string, data: Uint8Array, recursive = false): Promise<void> => {
    const logical = projectPath(path);
    await beforeMutation([logical]);
    if (recursive) await ensureParents(files, mirror, logical);
    await files.writeFile(logical, data, { expectedVersion: mirror.version(logical) });
    await mirror.ensureFile(logical);
  };

  const copy = async (from: string, to: string): Promise<void> => {
    const source = requiredEntry(mirror, from);
    if (mirror.existsSync(to)) throw new Error(`Project path already exists: ${to}`);
    if (source.kind === 'dir') {
      await files.mkdir(to, { expectedVersion: null });
      for (const child of mirror.readdirSync(from)) {
        const sourceChild = from === '/' ? `/${child.name}` : `${from}/${child.name}`;
        const targetChild = to === '/' ? `/${child.name}` : `${to}/${child.name}`;
        await copy(sourceChild, targetChild);
      }
      return;
    }
    await files.writeFile(to, await mirror.ensureFile(from), { expectedVersion: null });
    await mirror.ensureFile(to);
  };

  return {
    async createFile(path) {
      await write(path, new Uint8Array());
    },

    async createDir(path) {
      const logical = projectPath(path);
      await beforeMutation([logical]);
      if (mirror.existsSync(logical)) throw new Error(`Project path already exists: ${logical}`);
      await files.mkdir(logical, { expectedVersion: null });
    },

    async deletePath(path) {
      const logical = projectPath(path);
      await beforeMutation([logical]);
      const source = requiredEntry(mirror, logical);
      await files.remove(source.path, {
        expectedVersion: source.version,
        ...(source.kind === 'dir' ? { recursive: true } : {}),
      });
    },

    async renamePath(from, to) {
      const sourcePath = projectPath(from);
      const target = projectPath(to);
      await beforeMutation([sourcePath, target]);
      const source = requiredEntry(mirror, sourcePath);
      await files.rename(source.path, target, {
        expectedSourceVersion: source.version,
        expectedTargetVersion: mirror.version(target),
      });
    },

    async renameMany(changes) {
      const validated = changes.map(({ from, to }) => ({
        from: projectPath(from),
        to: projectPath(to),
      }));
      await beforeMutation(validated.flatMap(({ from, to }) => [from, to]));
      for (const { from, to } of validated) {
        const source = requiredEntry(mirror, from);
        await files.rename(source.path, to, {
          expectedSourceVersion: source.version,
          expectedTargetVersion: mirror.version(to),
        });
      }
    },

    async copyTree(from, to) {
      const source = projectPath(from);
      const target = projectPath(to);
      await beforeMutation([source, target]);
      await copy(source, target);
    },

    writeFile(path, data, options) {
      return write(path, data, options?.recursive === true);
    },

    async writeFiles(writes) {
      const validated = writes.map((item) => ({ ...item, path: projectPath(item.path) }));
      await beforeMutation(validated.map(({ path }) => path));
      for (const item of validated) {
        if (item.recursive === true) await ensureParents(files, mirror, item.path);
        await files.writeFile(item.path, item.data, {
          expectedVersion: mirror.version(item.path),
        });
        await mirror.ensureFile(item.path);
      }
    },
  };
}

/** One ProjectDocument handle + FIFO per open editor path. */
export function createPlaygroundDocumentWriter(
  documents: ProjectDocuments,
): PlaygroundDocumentWriter {
  const handles = new Map<string, Promise<ProjectDocument>>();
  const tails = new Map<string, Promise<void>>();

  const handle = (path: string): Promise<ProjectDocument> => {
    const logical = projectPath(path);
    const current = handles.get(logical);
    if (current !== undefined) return current;
    const opening = documents.open(logical).catch((error: unknown) => {
      if (handles.get(logical) === opening) handles.delete(logical);
      throw error;
    });
    handles.set(logical, opening);
    return opening;
  };

  const enqueue = (path: string, operation: () => Promise<void>): Promise<void> => {
    const logical = projectPath(path);
    const prior = tails.get(logical) ?? Promise.resolve();
    const next = prior.then(operation);
    tails.set(
      logical,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  };

  const closePaths = async (paths: readonly string[]): Promise<void> => {
    const failures: unknown[] = [];
    for (const path of paths) {
      try {
        await (tails.get(path) ?? Promise.resolve());
        const opened = handles.get(path);
        if (opened !== undefined) await (await opened).close();
      } catch (error) {
        failures.push(error);
      } finally {
        handles.delete(path);
        tails.delete(path);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Project editor document close failed');
    }
  };

  const writer: PlaygroundDocumentWriter = {
    write(path, text) {
      const logical = projectPath(path);
      return enqueue(logical, async () => {
        const document = await handle(logical);
        document.replace(text);
        await document.save();
      });
    },

    closeTree(path) {
      const root = projectPath(path);
      return closePaths([...handles.keys()].filter((candidate) => pathInside(candidate, root)));
    },

    closeAll: () => closePaths([...handles.keys()]),
  };
  return Object.freeze(writer);
}
