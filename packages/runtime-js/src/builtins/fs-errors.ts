/**
 * Node-shaped fs error kit shared by every `node:fs` surface (fs.ts,
 * fs-streams.ts): `fsError` renders the exact Node message + `code`/`errno`/
 * `syscall`/`path`/`dest` fields, and `withSyscall` is the single VfsError→Node
 * translation boundary (review 2026-07-05). Parity contract:
 * `cases/fs/error-shape-errno-syscall.case.ts` — real libraries switch on
 * `err.errno`/`err.syscall`, so a raw `VfsError` leaking to user code is a bug.
 */

import { VfsError } from '@riftydev/vfs';
import { type PathLike, pathToString } from './fs-path.ts';

// Node-shaped errno (negative Linux ABI, matches builtins/os.ts table) + the
// message prose Node renders: "ENOENT: no such file or directory, open '/x'".
export const FS_ERRNO: Record<string, { errno: number; description: string }> = {
  EACCES: { errno: -13, description: 'permission denied' },
  EBADF: { errno: -9, description: 'bad file descriptor' },
  EEXIST: { errno: -17, description: 'file already exists' },
  EINVAL: { errno: -22, description: 'invalid argument' },
  EISDIR: { errno: -21, description: 'illegal operation on a directory' },
  ENOENT: { errno: -2, description: 'no such file or directory' },
  ENOTDIR: { errno: -20, description: 'not a directory' },
  ENOTEMPTY: { errno: -39, description: 'directory not empty' },
};

export function fsError(
  code: string,
  path?: string,
  syscall?: string,
  dest?: string,
): NodeJS.ErrnoException {
  const info = FS_ERRNO[code];
  // Node renders every combination: ", open 'x'", ", rename 'a' -> 'b'", and
  // syscall-only (fd/opendir paths carry no name): "EISDIR: …, read".
  const suffix = syscall
    ? `, ${syscall}${path !== undefined ? ` '${path}'` : ''}${dest !== undefined ? ` -> '${dest}'` : ''}`
    : path !== undefined
      ? `: ${path}`
      : '';
  const message = info ? `${code}: ${info.description}${suffix}` : `${code}${suffix}`;
  const err = new Error(message) as NodeJS.ErrnoException & { dest?: string };
  err.code = code;
  if (info) err.errno = info.errno;
  err.path = path;
  err.syscall = syscall;
  if (dest !== undefined) err.dest = dest;
  return err;
}

/**
 * Per-op syscall name for the error a `VfsError` code maps to. A plain string
 * covers ops whose failures Node attributes to one syscall; the record form
 * covers split attribution (`readFileSync`: ENOENT → `open`, EISDIR → `read`).
 */
export type SyscallSpec = string | { readonly default: string; readonly [code: string]: string };

// Syscalls Node renders WITHOUT a path (fd-level ops + opendir).
const PATHLESS_SYSCALLS = new Set(['read', 'write', 'opendir']);

/** `withSyscall`'s translation step, usable directly in async/event error paths. */
export function toNodeFsError(
  err: unknown,
  spec: SyscallSpec,
  p?: PathLike,
  dest?: string,
): unknown {
  if (err instanceof VfsError) {
    const syscall = typeof spec === 'string' ? spec : (spec[err.code] ?? spec.default);
    const path = PATHLESS_SYSCALLS.has(syscall) || p === undefined ? undefined : pathToString(p);
    return fsError(err.code, path, syscall, dest);
  }
  return err;
}

/**
 * The single VfsError→Node translation boundary (review 2026-07-05). Every
 * public `fs` entry point funnels backend errors through here so user programs
 * always observe Node-shaped errors: `code` + `errno` + `syscall` + `path`
 * (the path AS PASSED by the caller, not the resolved absolute — Node parity)
 * + `dest` on two-path ops + Node's message rendering. Non-VfsError errors
 * (already Node-shaped `fsError`s, TypeError validation) pass through.
 */
export function withSyscall<T>(
  spec: SyscallSpec,
  p: PathLike | undefined,
  fn: () => T,
  dest?: string,
): T {
  try {
    return fn();
  } catch (err) {
    throw toNodeFsError(err, spec, p, dest);
  }
}
