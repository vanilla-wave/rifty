/** `touch FILE...` — create empty files, or bump mtime if they already exist. */

import { NotImplementedError } from '@riftydev/io';
import { type FsSync, VfsError, guardVfsMutations } from '@riftydev/vfs';
import type { ShellCommand } from '../types.ts';
import { commandFileSystem, enc, resolve, strerror } from './_shared.ts';

/**
 * Update mtime of an existing file/dir on the command filesystem via
 * `FsSync.utimes` (ADR-0029). `Date.now()` can return the same value twice
 * in tight loops, so we monotonically bump the timestamp by at least 1 ms so
 * consecutive `touch`es are visibly distinct (matches GNU `touch` semantics
 * in practice).
 */
function bumpMtime(fs: FsSync, path: string): void {
  const prev = fs.statSync(path).mtime ?? 0;
  const now = Date.now();
  const next = now > prev ? now : prev + 1;
  fs.utimes(path, next, next);
}

export const touch: ShellCommand = async (args, ctx) => {
  const files: string[] = [];
  let optsDone = false;
  for (const a of args) {
    if (optsDone || a === '-' || !a.startsWith('-')) {
      files.push(a);
      continue;
    }
    if (a === '--') {
      optsDone = true;
      continue;
    }
    // No touch flags implemented yet (-c/-m/-a/-t/-r). Throw loudly rather than
    // create a file literally named after the flag.
    throw new NotImplementedError(`shell.touch.${a}`, `flag ${a} not implemented`);
  }
  if (files.length === 0) {
    ctx.stderr.write('touch: missing operand\n');
    return 1;
  }
  const fs = commandFileSystem(ctx);
  const targets = files.map((path) => {
    const absolute = resolve(ctx.cwd, path);
    return { path, absolute, exists: fs.existsSync(absolute) };
  });
  return await guardVfsMutations(
    ctx.mutationGuard,
    targets.map(({ absolute, exists }) => ({
      kind: exists ? ('utimes' as const) : ('write' as const),
      path: absolute,
    })),
    () => {
      let exit = 0;
      for (const { path, absolute } of targets) {
        try {
          if (fs.existsSync(absolute)) bumpMtime(fs, absolute);
          else fs.writeFileSync(absolute, enc.encode(''));
        } catch (err) {
          const msg = err instanceof VfsError ? strerror(err) : (err as Error).message;
          ctx.stderr.write(`touch: cannot touch '${path}': ${msg}\n`);
          exit = 1;
        }
      }
      return exit;
    },
  );
};
