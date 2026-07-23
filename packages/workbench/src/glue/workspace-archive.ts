import type { VfsDirent } from '@riftydev/vfs';
import { dirname, joinPath, normalizePath } from '@riftydev/vfs';
import { isInstallStampPath } from './install-stamp.ts';
import { SNAPSHOT_EXCLUDE_DIRS } from './vfs-snapshot-port.ts';

export interface WorkspaceArchiveFile {
  readonly path: string;
  readonly encoding: 'base64';
  readonly content: string;
}

export interface WorkspaceArchiveV1 {
  readonly version: 1;
  readonly root: string;
  readonly files: readonly WorkspaceArchiveFile[];
}

export interface WorkspaceArchiveFs {
  existsSync(path: string): boolean;
  readdirSync(path: string): readonly VfsDirent[];
  readFileBytesSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
  mkdirSync(path: string, options: { recursive?: boolean }): void;
  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
}

export interface ExportWorkspaceArchiveOptions {
  readonly exclude?: readonly string[];
}

export interface ImportWorkspaceArchiveOptions {
  readonly root?: string;
  readonly replace?: boolean;
  /**
   * Apply the archive's root-RELATIVE files under `root` even when it differs
   * from `archive.root` (ADR-0165): a dep snapshot baked at one root (e.g.
   * `/workspace/node_modules`) restores into the active project root
   * (`/scratch` or `/projects/<id>/node_modules`). Off by default so the
   * user-facing import keeps the same-root safety guard.
   */
  readonly rebase?: boolean;
}

export interface PreparedWorkspaceArchiveImport {
  readonly root: string;
  apply(): void;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function relativePath(root: string, path: string): string {
  if (path === root) return '';
  if (!path.startsWith(`${root}/`)) throw new Error(`Path "${path}" is outside "${root}"`);
  return path.slice(root.length + 1);
}

function assertSafeRelativePath(path: string): void {
  if (path.startsWith('/') || path === '' || path.split('/').includes('..')) {
    throw new Error(`Unsafe archive path "${path}"`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertArchive(value: unknown): asserts value is WorkspaceArchiveV1 {
  if (!isRecord(value)) throw new Error('Workspace archive must be an object');
  if (value.version !== 1)
    throw new Error(`Unsupported workspace archive version ${value.version}`);
  if (typeof value.root !== 'string') throw new Error('Workspace archive root must be a string');
  if (!Array.isArray(value.files)) throw new Error('Workspace archive files must be an array');
  for (const [index, file] of value.files.entries()) {
    if (!isRecord(file)) throw new Error(`Workspace archive file ${index} must be an object`);
    if (typeof file.path !== 'string') {
      throw new Error(`Workspace archive file ${index} path must be a string`);
    }
    if (file.encoding !== 'base64') {
      throw new Error(`Workspace archive file ${index} encoding must be base64`);
    }
    if (typeof file.content !== 'string') {
      throw new Error(`Workspace archive file ${index} content must be a string`);
    }
  }
}

export function exportWorkspaceArchive(
  fs: Pick<WorkspaceArchiveFs, 'readdirSync' | 'readFileBytesSync'>,
  root: string,
  options: ExportWorkspaceArchiveOptions = {},
): string {
  return JSON.stringify(buildWorkspaceArchive(fs, root, options));
}

/** Object-form export — dep snapshots (ADR-0135) embed the archive directly. */
export function buildWorkspaceArchive(
  fs: Pick<WorkspaceArchiveFs, 'readdirSync' | 'readFileBytesSync'>,
  root: string,
  options: ExportWorkspaceArchiveOptions = {},
): WorkspaceArchiveV1 {
  const normalizedRoot = normalizePath(root);
  const exclude = new Set(options.exclude ?? SNAPSHOT_EXCLUDE_DIRS);
  const files: WorkspaceArchiveFile[] = [];

  const walk = (dir: string): void => {
    const children = fs.readdirSync(dir);
    const sorted = [...children].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of sorted) {
      const path = joinPath(dir, child.name);
      // A corrupt marker may be a directory. Omit the whole authority-owned
      // namespace before descending, not only a marker-shaped file.
      if (isInstallStampPath(path)) continue;
      if (child.isDirectory) {
        if (!exclude.has(child.name)) walk(path);
        continue;
      }
      // Install claims are owner authority state, never portable project or
      // dependency bytes (ADR-0261). The absolute walk path also catches a
      // top-level marker when `root` itself is a node_modules directory.
      files.push({
        path: relativePath(normalizedRoot, path),
        encoding: 'base64',
        content: bytesToBase64(fs.readFileBytesSync(path)),
      });
    }
  };

  walk(normalizedRoot);
  return { version: 1, root: normalizedRoot, files };
}

export function importWorkspaceArchive(
  fs: WorkspaceArchiveFs,
  archiveJson: string,
  options: ImportWorkspaceArchiveOptions = {},
): void {
  prepareWorkspaceArchiveImport(fs, JSON.parse(archiveJson) as unknown, options).apply();
}

/** Object-form import — dep snapshots (ADR-0135) embed the archive directly. */
export function applyWorkspaceArchive(
  fs: WorkspaceArchiveFs,
  archive: WorkspaceArchiveV1,
  options: ImportWorkspaceArchiveOptions = {},
): void {
  prepareWorkspaceArchiveImport(fs, archive, options).apply();
}

/** Validate/decode without mutation; the returned apply owns the root replace. */
export function prepareWorkspaceArchiveImport(
  fs: WorkspaceArchiveFs,
  archive: unknown,
  options: ImportWorkspaceArchiveOptions = {},
): PreparedWorkspaceArchiveImport {
  assertArchive(archive);
  const root = normalizePath(options.root ?? archive.root);
  const archiveRoot = normalizePath(archive.root);
  // Files are stored root-relative (see relativePath above), so applying them at
  // a different `root` is safe — `rebase` opts into that re-root (dep snapshots,
  // ADR-0165). Without it, the same-root guard stays (user-facing import).
  if (!options.rebase && archiveRoot !== root) {
    throw new Error(`Archive root mismatch: expected ${root}, got ${archiveRoot}`);
  }
  if (root === '/') throw new Error('Refusing to import a workspace archive at /');

  const decoded = archive.files.map((file) => {
    assertSafeRelativePath(file.path);
    const target = joinPath(root, file.path);
    if (isInstallStampPath(target)) {
      throw new Error(`Workspace archive contains reserved install-stamp claim "${file.path}"`);
    }
    if (!options.rebase && file.path.split('/').includes('node_modules')) {
      throw new Error(`Workspace archive contains derived node_modules path "${file.path}"`);
    }
    if (!target.startsWith(`${root}/`)) throw new Error(`Archive path escaped root: ${file.path}`);
    return { path: file.path, target, content: base64ToBytes(file.content) };
  });

  const archivePathByTarget = new Map<string, string>();
  for (const file of decoded) {
    const priorPath = archivePathByTarget.get(file.target);
    if (priorPath !== undefined) {
      throw new Error(
        `Workspace archive target collision: "${priorPath}" and "${file.path}" map to ${file.target}`,
      );
    }
    archivePathByTarget.set(file.target, file.path);
  }
  for (const file of decoded) {
    let parent = dirname(file.target);
    while (parent !== root) {
      const parentArchivePath = archivePathByTarget.get(parent);
      if (parentArchivePath !== undefined) {
        throw new Error(
          `Workspace archive target collision: file "${parentArchivePath}" is an ancestor of "${file.path}"`,
        );
      }
      const next = dirname(parent);
      if (next === parent) break;
      parent = next;
    }
  }

  return {
    root,
    apply() {
      if (options.replace ?? true) {
        fs.rmSync(root, { recursive: true, force: true });
      }
      fs.mkdirSync(root, { recursive: true });

      for (const file of decoded) {
        const target = file.target;
        fs.mkdirSync(dirname(target), { recursive: true });
        fs.writeFileSync(target, file.content);
      }
    },
  };
}
