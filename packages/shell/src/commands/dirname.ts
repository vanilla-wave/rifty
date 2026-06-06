/**
 * `dirname` — output each NAME with its last non-slash component removed.
 * Pure string logic (no VFS read).
 *
 * VFS `dirname` normalizes first, so `dirname('/a/b/')` yields `/a/b`; GNU
 * yields `/a`. We implement the GNU algorithm directly instead: strip trailing
 * slashes, drop the last component, strip trailing slashes again.
 */

import { NotImplementedError } from '@riftydev/io';
import type { ShellCommand } from '../types.ts';

const USAGE = 'usage: dirname NAME...\n';

function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 1 && s[end - 1] === '/') end--;
  return s.slice(0, end);
}

/** GNU `dirname`: trailing-slash-tolerant, root and bare names handled. */
function dirOf(name: string): string {
  const trimmed = stripTrailingSlashes(name);
  const idx = trimmed.lastIndexOf('/');
  if (idx === -1) return '.';
  const head = stripTrailingSlashes(trimmed.slice(0, idx));
  return head === '' ? '/' : head;
}

export const dirname: ShellCommand = async (args, ctx) => {
  const names: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--') {
      for (let j = i + 1; j < args.length; j++) names.push(args[j] ?? '');
      break;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      if (arg === '-z') {
        throw new NotImplementedError('shell.dirname.-z', 'NUL line terminator not supported');
      }
      ctx.stderr.write(`dirname: invalid option -- '${arg.slice(1)}'\n`);
      ctx.stderr.write(USAGE);
      return 1;
    }
    names.push(arg);
  }

  if (names.length === 0) {
    ctx.stderr.write('dirname: missing operand\n');
    ctx.stderr.write(USAGE);
    return 1;
  }

  for (const name of names) ctx.stdout.write(`${dirOf(name)}\n`);
  return 0;
};
