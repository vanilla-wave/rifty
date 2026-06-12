import type { VfsDirent } from '@riftydev/vfs';
import { dirname, joinPath, normalizePath } from '@riftydev/vfs';
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

function assertArchive(value: WorkspaceArchiveV1): void {
  if (value.version !== 1)
    throw new Error(`Unsupported workspace archive version ${value.version}`);
  if (typeof value.root !== 'string') throw new Error('Workspace archive root must be a string');
  if (!Array.isArray(value.files)) throw new Error('Workspace archive files must be an array');
}

export function exportWorkspaceArchive(
  fs: Pick<WorkspaceArchiveFs, 'readdirSync' | 'readFileBytesSync'>,
  root: string,
  options: ExportWorkspaceArchiveOptions = {},
): string {
  const normalizedRoot = normalizePath(root);
  const exclude = new Set(options.exclude ?? SNAPSHOT_EXCLUDE_DIRS);
  const files: WorkspaceArchiveFile[] = [];

  const walk = (dir: string): void => {
    let children: readonly VfsDirent[];
    try {
      children = fs.readdirSync(dir);
    } catch {
      return;
    }
    const sorted = [...children].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of sorted) {
      const path = joinPath(dir, child.name);
      if (child.isDirectory) {
        if (!exclude.has(child.name)) walk(path);
        continue;
      }
      files.push({
        path: relativePath(normalizedRoot, path),
        encoding: 'base64',
        content: bytesToBase64(fs.readFileBytesSync(path)),
      });
    }
  };

  walk(normalizedRoot);
  const archive: WorkspaceArchiveV1 = { version: 1, root: normalizedRoot, files };
  return JSON.stringify(archive);
}

export function importWorkspaceArchive(
  fs: WorkspaceArchiveFs,
  archiveJson: string,
  options: ImportWorkspaceArchiveOptions = {},
): void {
  const archive = JSON.parse(archiveJson) as WorkspaceArchiveV1;
  assertArchive(archive);
  const root = normalizePath(options.root ?? archive.root);
  const archiveRoot = normalizePath(archive.root);
  if (archiveRoot !== root) {
    throw new Error(`Archive root mismatch: expected ${root}, got ${archiveRoot}`);
  }
  if (root === '/') throw new Error('Refusing to import a workspace archive at /');

  const decoded = archive.files.map((file) => {
    if (file.encoding !== 'base64')
      throw new Error(`Unsupported archive encoding ${file.encoding}`);
    assertSafeRelativePath(file.path);
    const target = joinPath(root, file.path);
    if (!target.startsWith(`${root}/`)) throw new Error(`Archive path escaped root: ${file.path}`);
    return { target, content: base64ToBytes(file.content) };
  });

  if (options.replace ?? true) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  fs.mkdirSync(root, { recursive: true });

  for (const file of decoded) {
    const target = file.target;
    fs.mkdirSync(dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content);
  }
}
