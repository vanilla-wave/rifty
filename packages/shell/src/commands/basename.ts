/**
 * `basename` — strip directory and optional trailing SUFFIX from each NAME.
 * Pure node:path-style string logic (no VFS read).
 *
 * Forms (GNU):
 *   basename NAME [SUFFIX]      — single name, optional suffix
 *   basename -a NAME...         — all args are names, one per line
 *   basename -s SUFFIX NAME...  — implies -a, strip SUFFIX from each
 */

import { NotImplementedError } from '@riftydev/io';
import { basename as vfsBasename } from '@riftydev/vfs';
import type { ShellCommand } from '../types.ts';

const USAGE =
  'usage: basename NAME [SUFFIX]\n   or: basename -a NAME...\n   or: basename -s SUFFIX NAME...\n';

/** GNU `basename`: root collapses to '/' (VFS basename returns '' there). */
function baseOf(name: string, suffix?: string): string {
  const b = vfsBasename(name, suffix);
  return b === '' ? '/' : b;
}

export const basename: ShellCommand = async (args, ctx) => {
  let allMode = false;
  let suffix: string | undefined;
  const names: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--') {
      // Everything after '--' is an operand.
      for (let j = i + 1; j < args.length; j++) names.push(args[j] ?? '');
      break;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      if (arg === '-a') {
        allMode = true;
        continue;
      }
      if (arg === '-s') {
        const v = args[i + 1];
        if (v === undefined) {
          ctx.stderr.write("basename: option requires an argument -- 's'\n");
          ctx.stderr.write(USAGE);
          return 1;
        }
        suffix = v;
        allMode = true;
        i++;
        continue;
      }
      if (arg === '-z') {
        throw new NotImplementedError('shell.basename.-z', 'NUL line terminator not supported');
      }
      ctx.stderr.write(`basename: invalid option -- '${arg.slice(1)}'\n`);
      ctx.stderr.write(USAGE);
      return 1;
    }
    names.push(arg);
  }

  if (names.length === 0) {
    ctx.stderr.write('basename: missing operand\n');
    ctx.stderr.write(USAGE);
    return 1;
  }

  if (allMode) {
    for (const name of names) ctx.stdout.write(`${baseOf(name, suffix)}\n`);
    return 0;
  }

  // 1-arg/2-arg form: NAME [SUFFIX]; >2 operands is a usage error.
  if (names.length > 2) {
    ctx.stderr.write(`basename: extra operand '${names[2]}'\n`);
    ctx.stderr.write(USAGE);
    return 1;
  }
  ctx.stdout.write(`${baseOf(names[0] ?? '', names[1])}\n`);
  return 0;
};
