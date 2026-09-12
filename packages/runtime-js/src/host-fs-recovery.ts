import { dirname, normalizePath } from '@riftydev/vfs';
import type { FsOperation, ToolchainActivationState } from './protocol.ts';

const absolute = (path: string): string => normalizePath(path.startsWith('/') ? path : `/${path}`);
const contains = (parent: string, path: string): boolean =>
  parent === '/' || parent === path || path.startsWith(`${parent}/`);

/** Update the existing acknowledged recovery image, never infer failed effects. */
export function applyRecoveryFsOperation(
  state: ToolchainActivationState | null,
  op: FsOperation,
): ToolchainActivationState | null {
  if (
    state === null ||
    op.op === 'readFile' ||
    op.op === 'readdir' ||
    op.op === 'stat' ||
    op.op === 'flush'
  )
    return state;
  let files = [...state.files];
  let directories = [...(state.directories ?? [])];
  const addParents = (path: string): void => {
    for (let next = path; next !== '/'; next = dirname(next))
      if (!directories.includes(next)) directories.push(next);
  };
  if (op.op === 'writeFile') {
    const path = absolute(op.path);
    files = files.filter((file) => file.path !== path);
    files.push({
      path,
      data: typeof op.data === 'string' ? new TextEncoder().encode(op.data) : op.data,
    });
    addParents(dirname(path));
  } else if (op.op === 'mkdir') addParents(absolute(op.path));
  else if (op.op === 'rm') {
    const path = absolute(op.path);
    files = files.filter((file) => !contains(path, file.path));
    directories = directories.filter((dir) => !contains(path, dir));
  } else if (op.op === 'rename') {
    const source = absolute(op.sourcePath);
    const target = absolute(op.targetPath);
    if (source === target) return state;
    const moved = files
      .filter((file) => contains(source, file.path))
      .map((file) => ({ ...file, path: target + file.path.slice(source.length) }));
    files = files
      .filter((file) => !contains(source, file.path) && !contains(target, file.path))
      .concat(moved);
    const movedDirs = directories
      .filter((dir) => contains(source, dir))
      .map((dir) => target + dir.slice(source.length));
    directories = directories
      .filter((dir) => !contains(source, dir) && !contains(target, dir))
      .concat(movedDirs);
  }
  return Object.freeze({
    ...state,
    files: Object.freeze(files.toSorted((a, b) => a.path.localeCompare(b.path))),
    directories: Object.freeze(directories.toSorted()),
  });
}
