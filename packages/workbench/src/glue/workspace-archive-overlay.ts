import { type FsSync, type VfsMutationIntent, dirname, normalizePath } from '@riftydev/vfs';
import { SnapshotApplicationConflictError } from '../workbench/errors.ts';
import type { DecodedWorkspaceArchive, WorkspaceArchiveFs } from './workspace-archive.ts';

export type WorkspaceOverlayFs = WorkspaceArchiveFs & Pick<FsSync, 'statSyncOrNull'>;

/** Verified entries overlay one target; preflight may inspect a still-unmigrated source. */
export function prepareWorkspaceArchiveOverlay(
  fs: WorkspaceOverlayFs,
  decoded: DecodedWorkspaceArchive,
  options: {
    readonly preflightRoot?: string;
    readonly conflict: 'error' | 'overwrite';
  },
) {
  const root = decoded.root;
  const preflightRoot = normalizePath(options.preflightRoot ?? root);
  const directories = new Set(decoded.directories.map((entry) => entry.target));
  for (const entry of decoded.files) {
    let parent = dirname(entry.target);
    while (parent !== root) {
      directories.add(parent);
      parent = dirname(parent);
    }
  }
  const orderedDirectories = [...directories].sort(
    (left, right) => left.length - right.length || (left < right ? -1 : 1),
  );
  const conflicts = new Set<string>();
  const blockedDirectories: string[] = [];
  const intents: VfsMutationIntent[] = [];
  const inspectionPath = (path: string) => `${preflightRoot}${path.slice(root.length)}`;
  const blocked = (path: string) =>
    blockedDirectories.some((parent) => path.startsWith(`${parent}/`));
  for (const path of orderedDirectories) {
    if (blocked(path)) continue;
    const current = fs.statSyncOrNull(inspectionPath(path));
    if (current !== null && !current.isDirectory) {
      conflicts.add(path.slice(root.length));
      blockedDirectories.push(path);
      intents.push({ kind: 'replace', path });
    } else if (current === null) intents.push({ kind: 'mkdir', path });
  }
  const sameBytes = (left: Uint8Array, right: Uint8Array) =>
    left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
  for (const entry of decoded.files) {
    if (blocked(entry.target)) continue;
    const path = inspectionPath(entry.target);
    const current = fs.statSyncOrNull(path);
    if (current?.isFile && sameBytes(fs.readFileBytesSync(path), entry.content)) continue;
    if (current !== null) conflicts.add(entry.target.slice(root.length));
    intents.push({ kind: current?.isDirectory ? 'replace' : 'write', path: entry.target });
  }
  if (options.conflict === 'error' && conflicts.size > 0) {
    throw new SnapshotApplicationConflictError([...conflicts]);
  }
  return {
    intents: Object.freeze(intents),
    apply() {
      for (const path of orderedDirectories) {
        const current = fs.statSyncOrNull(path);
        if (current !== null && !current.isDirectory) fs.rmSync(path, { force: true });
        if (current?.isDirectory !== true) fs.mkdirSync(path, { recursive: true });
      }
      for (const entry of decoded.files) {
        const current = fs.statSyncOrNull(entry.target);
        if (current?.isFile && sameBytes(fs.readFileBytesSync(entry.target), entry.content))
          continue;
        if (current !== null && !current.isFile)
          fs.rmSync(entry.target, { recursive: true, force: true });
        fs.writeFileSync(entry.target, entry.content);
      }
    },
  };
}
