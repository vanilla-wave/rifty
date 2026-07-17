/** `rm [-r|-R] [-f] PATH...` — remove files/dirs. `-f` ignores missing operands. */

import { NotImplementedError } from '@riftydev/io';
import { VfsError, guardVfsMutations } from '@riftydev/vfs';
import type { ShellCommand } from '../types.ts';
import { commandFileSystem, resolve, strerror } from './_shared.ts';

export const rm: ShellCommand = async (args, ctx) => {
  let recursive = false;
  let force = false;
  const paths: string[] = [];
  let optsDone = false;
  for (const a of args) {
    if (optsDone || a === '-' || !a.startsWith('-')) {
      paths.push(a);
      continue;
    }
    if (a === '--') {
      optsDone = true;
      continue;
    }
    // Bundled short flags (-rf/-fr/...). Unknown ones throw (loud gap) — never
    // silently ignored, matching cp/mv/grep/ls.
    for (const ch of a.slice(1)) {
      if (ch === 'r' || ch === 'R') recursive = true;
      else if (ch === 'f') force = true;
      else throw new NotImplementedError(`shell.rm.-${ch}`, `flag -${ch} not implemented`);
    }
  }
  if (paths.length === 0) {
    if (force) return 0; // GNU: `rm -f` with no operand is a silent no-op.
    ctx.stderr.write('rm: missing operand\n');
    return 1;
  }
  const fs = commandFileSystem(ctx);
  const targets = paths.map((path) => ({ path, absolute: resolve(ctx.cwd, path) }));
  return await guardVfsMutations(
    ctx.mutationGuard,
    targets.map(({ absolute }) => ({ kind: 'rm' as const, path: absolute })),
    () => {
      let exit = 0;
      for (const { path, absolute } of targets) {
        // GNU refuses to remove ANY directory (empty or not) without -r/-d.
        try {
          if (!recursive && fs.existsSync(absolute) && fs.statSync(absolute).isDirectory) {
            ctx.stderr.write(`rm: cannot remove '${path}': Is a directory\n`);
            exit = 1;
            continue;
          }
        } catch {
          // stat edge — fall through; rmSync reports authoritatively.
        }
        try {
          fs.rmSync(absolute, { recursive, force });
        } catch (err) {
          if (force) continue; // -f suppresses errors (e.g. ENOENT).
          const msg = err instanceof VfsError ? strerror(err) : (err as Error).message;
          ctx.stderr.write(`rm: cannot remove '${path}': ${msg}\n`);
          exit = 1;
        }
      }
      return exit;
    },
  );
};
