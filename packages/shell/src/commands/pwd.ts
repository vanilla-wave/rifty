/** `pwd` — print the current working directory. Always exits 0. */

import type { ShellCommand } from '../types.ts';

export const pwd: ShellCommand = async (_args, ctx) => {
  ctx.stdout.write(`${ctx.cwd}\n`);
  return 0;
};
