/**
 * `cd [DIR]` — change the shell's cwd. No arg ⇒ `$HOME` (falls back to `/`).
 *
 * Factory closure: takes the shell's `setCwd` sink so the builtin can mutate
 * shell state without a reverse import. Errors (missing / not-a-dir) exit 1.
 */

import type { ShellCommand } from '../types.ts';
import { commandFileSystem, resolve } from './_shared.ts';

export const cd =
  (setCwd: (p: string) => void): ShellCommand =>
  async (args, ctx) => {
    const target = args[0] ?? ctx.env.HOME ?? '/';
    const next = resolve(ctx.cwd, target);
    const fs = commandFileSystem(ctx);
    if (!fs.existsSync(next)) {
      ctx.stderr.write(`cd: ${target}: no such file or directory\n`);
      return 1;
    }
    if (!fs.statSync(next).isDirectory) {
      ctx.stderr.write(`cd: ${target}: not a directory\n`);
      return 1;
    }
    setCwd(next);
    return 0;
  };
