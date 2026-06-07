/** `env` — print the environment as `KEY=value` lines. Always exits 0. */

import type { ShellCommand } from '../types.ts';

export const envCmd: ShellCommand = async (_args, ctx) => {
  for (const [k, v] of Object.entries(ctx.env)) ctx.stdout.write(`${k}=${v}\n`);
  return 0;
};
