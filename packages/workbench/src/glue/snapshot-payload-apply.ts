import { dirname, joinPath, normalizePath } from '@riftydev/vfs';
import { SnapshotApplicationConflictError } from '../workbench/errors.ts';
import type { SnapshotApplication } from '../workbench/playground.ts';
import { type DepSnapshotV3, fetchVerifiedDepSnapshot } from './dep-snapshot.ts';
import type { WorkspaceArchiveFs } from './workspace-archive.ts';

const encoder = new TextEncoder();
const TREE_PREFIX = 'tree';

export function inspectSnapshotApplication(value: unknown): SnapshotApplication {
  if (value === undefined) return Object.freeze({ mode: 'initial-deployment-only' });
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('snapshotApplication must be an object');
  }
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record).sort();
  if (record.mode === 'initial-deployment-only') {
    if (keys.length !== 1 || keys[0] !== 'mode') {
      throw new TypeError('snapshotApplication.initial-deployment-only must have only mode');
    }
    return Object.freeze({ mode: 'initial-deployment-only' });
  }
  if (record.mode === 'apply') {
    if (record.conflict === undefined) {
      if (keys.length !== 1 || keys[0] !== 'mode') {
        throw new TypeError('snapshotApplication.apply must have only mode or mode+conflict');
      }
      return Object.freeze({ mode: 'apply' });
    }
    if (record.conflict !== 'error' && record.conflict !== 'overwrite') {
      throw new TypeError('snapshotApplication.conflict must be error or overwrite');
    }
    if (keys.length !== 2 || keys[0] !== 'conflict' || keys[1] !== 'mode') {
      throw new TypeError('snapshotApplication.apply must have only mode or mode+conflict');
    }
    return Object.freeze({ mode: 'apply', conflict: record.conflict });
  }
  throw new TypeError('snapshotApplication.mode is invalid');
}

export interface ApplySnapshotIdentity {
  readonly snapshotId: string;
  readonly templateId: string;
}

export interface SnapshotTreeFile {
  readonly path: string;
  readonly bytes: readonly number[];
}

export interface SnapshotTreeImage {
  readonly directories: readonly string[];
  readonly files: readonly SnapshotTreeFile[];
}

function payloadEntries(snapshot: DepSnapshotV3): ReadonlyMap<string, Uint8Array | 'dir'> {
  const entries = new Map<string, Uint8Array | 'dir'>();
  if (snapshot.lockfile.length > 0) {
    entries.set('/package-lock.json', encoder.encode(snapshot.lockfile));
  }
  for (const directory of snapshot.nodeModules.directories ?? []) {
    entries.set(normalizePath(`/node_modules/${directory}`), 'dir');
  }
  for (const file of snapshot.nodeModules.files) {
    entries.set(normalizePath(`/node_modules/${file.path}`), Buffer.from(file.content, 'base64'));
  }
  return entries;
}

function existingKind(fs: WorkspaceArchiveFs, path: string): 'file' | 'dir' | 'missing' {
  if (!fs.existsSync(path)) return 'missing';
  try {
    fs.readFileBytesSync(path);
    return 'file';
  } catch {
    return 'dir';
  }
}

function ancestorConflict(fs: WorkspaceArchiveFs, path: string, root: string): string | null {
  const rootPrefix = normalizePath(root);
  const parts = path.split('/').filter((part) => part.length > 0);
  let current = '';
  for (const part of parts.slice(0, -1)) {
    current = `${current}/${part}`;
    if (current === rootPrefix || !current.startsWith(`${rootPrefix}/`)) continue;
    if (existingKind(fs, current) === 'file') return current;
  }
  return null;
}

export function collectSnapshotPayloadConflicts(
  fs: WorkspaceArchiveFs,
  root: string,
  snapshot: DepSnapshotV3,
): readonly string[] {
  const conflicts = new Set<string>();
  for (const [relative, expected] of payloadEntries(snapshot)) {
    const path = joinPath(root, relative);
    const ancestor = ancestorConflict(fs, path, root);
    if (ancestor !== null) {
      conflicts.add(ancestor.slice(root.length) || ancestor);
      continue;
    }
    const kind = existingKind(fs, path);
    if (kind === 'missing') continue;
    if (expected === 'dir') {
      if (kind !== 'dir') conflicts.add(relative);
      continue;
    }
    if (kind !== 'file') {
      conflicts.add(relative);
      continue;
    }
    const actual = fs.readFileBytesSync(path);
    if (
      actual.length !== expected.length ||
      actual.some((byte, index) => byte !== expected[index])
    ) {
      conflicts.add(relative);
    }
  }
  return [...conflicts].sort();
}

export async function loadVerifiedApplySnapshot(
  assetUrl: string,
  expected: ApplySnapshotIdentity,
): Promise<DepSnapshotV3> {
  const verified = await fetchVerifiedDepSnapshot(assetUrl, expected.snapshotId);
  if (verified.status === 'mismatch') {
    throw new Error(`snapshot-id-mismatch: ${assetUrl}`);
  }
  if (verified.snapshot.templateId !== expected.templateId) {
    throw new Error(`snapshot-template-mismatch: ${assetUrl}`);
  }
  return verified.snapshot;
}

function removeTargetAndDescendants(
  directories: Set<string>,
  files: Map<string, readonly number[]>,
  target: string,
): void {
  for (const path of [...files.keys()]) {
    if (path === target || path.startsWith(`${target}/`)) files.delete(path);
  }
  for (const directory of [...directories]) {
    if (directory === target || directory.startsWith(`${target}/`)) directories.delete(directory);
  }
}

function addAncestorDirectories(
  directories: Set<string>,
  files: Map<string, readonly number[]>,
  path: string,
): void {
  let parent = dirname(path);
  while (parent !== '.' && parent !== '') {
    if (files.has(parent)) removeTargetAndDescendants(directories, files, parent);
    directories.add(parent);
    parent = dirname(parent);
  }
}

/** Merge payload into a captured project-container image. Extras stay; only
 * overwritten conflict targets (and their descendants) are removed. */
export function mergeSnapshotPayloadIntoTree(
  tree: SnapshotTreeImage,
  snapshot: DepSnapshotV3,
): SnapshotTreeImage {
  const directories = new Set(tree.directories);
  const files = new Map(tree.files.map((file) => [file.path, file.bytes]));
  for (const [relative, expected] of payloadEntries(snapshot)) {
    const path = `${TREE_PREFIX}${relative}`;
    addAncestorDirectories(directories, files, path);
    if (expected === 'dir') {
      if (files.has(path)) removeTargetAndDescendants(directories, files, path);
      directories.add(path);
      continue;
    }
    if (directories.has(path)) removeTargetAndDescendants(directories, files, path);
    files.set(path, [...expected]);
  }
  return Object.freeze({
    directories: Object.freeze(
      [...directories].sort((left, right) =>
        left.length === right.length
          ? left < right
            ? -1
            : left > right
              ? 1
              : 0
          : left.length - right.length,
      ),
    ),
    files: Object.freeze(
      [...files.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([path, bytes]) => Object.freeze({ path, bytes: Object.freeze([...bytes]) })),
    ),
  });
}

export function preflightSnapshotApply(
  fs: WorkspaceArchiveFs,
  root: string,
  snapshot: DepSnapshotV3,
  application: Extract<SnapshotApplication, { readonly mode: 'apply' }>,
): void {
  const conflicts = collectSnapshotPayloadConflicts(fs, root, snapshot);
  if ((application.conflict ?? 'error') === 'error' && conflicts.length > 0) {
    throw new SnapshotApplicationConflictError(conflicts);
  }
}
