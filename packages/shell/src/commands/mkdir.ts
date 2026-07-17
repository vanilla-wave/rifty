/** `mkdir [-p|--parents] DIR...` — create directories. `-p` ⇒ recursive. */

import { NotImplementedError } from '@riftydev/io';
import { VfsError, guardVfsMutations } from '@riftydev/vfs';
import type { ShellCommand } from '../types.ts';
import { commandFileSystem, resolve, strerror } from './_shared.ts';

export const mkdir: ShellCommand = async (args, ctx) => {
  let recursive = false;
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
    if (a === '--parents') {
      recursive = true;
      continue;
    }
    if (a.startsWith('--')) {
      throw new NotImplementedError(`shell.mkdir.${a}`, `flag ${a} not implemented`);
    }
    // Bundled short flags. Unknown ones throw — never created as a directory name.
    for (const ch of a.slice(1)) {
      if (ch === 'p') recursive = true;
      else throw new NotImplementedError(`shell.mkdir.-${ch}`, `flag -${ch} not implemented`);
    }
  }
  if (paths.length === 0) {
    ctx.stderr.write('mkdir: missing operand\n');
    return 1;
  }
  const fs = commandFileSystem(ctx);
  const targets = paths.map((path) => ({ path, absolute: resolve(ctx.cwd, path) }));
  return await guardVfsMutations(
    ctx.mutationGuard,
    targets.map(({ absolute }) => ({ kind: 'mkdir' as const, path: absolute })),
    () => {
      let exit = 0;
      for (const { path, absolute } of targets) {
        try {
          fs.mkdirSync(absolute, { recursive });
        } catch (err) {
          const msg = err instanceof VfsError ? strerror(err) : (err as Error).message;
          ctx.stderr.write(`mkdir: cannot create directory '${path}': ${msg}\n`);
          exit = 1;
        }
      }
      return exit;
    },
  );
};
