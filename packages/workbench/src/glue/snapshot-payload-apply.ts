import { joinPath, normalizePath } from '@riftydev/vfs';
import { SnapshotApplicationConflictError } from '../workbench/errors.ts';
import type { SnapshotApplication } from '../workbench/playground.ts';
import { type DepSnapshotV3, fetchDepSnapshot, prepareDepSnapshotRestore } from './dep-snapshot.ts';
import type { WorkspaceArchiveFs } from './workspace-archive.ts';

const encoder = new TextEncoder();

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

function ancestorConflict(fs: WorkspaceArchiveFs, path: string): string | null {
  const parts = path.split('/').filter((part) => part.length > 0);
  let current = '';
  for (const part of parts.slice(0, -1)) {
    current = `${current}/${part}`;
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
    const ancestor = ancestorConflict(fs, path);
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

export async function applySnapshotPayload(
  fs: WorkspaceArchiveFs,
  root: string,
  assetUrl: string,
  application: Extract<SnapshotApplication, { readonly mode: 'apply' }>,
): Promise<void> {
  const snapshot = await fetchDepSnapshot(assetUrl);
  const conflicts = collectSnapshotPayloadConflicts(fs, root, snapshot);
  const conflict = application.conflict ?? 'error';
  if (conflict === 'error' && conflicts.length > 0) {
    throw new SnapshotApplicationConflictError(conflicts);
  }
  const prepared = await prepareDepSnapshotRestore(fs, root, snapshot);
  prepared.apply();
}
