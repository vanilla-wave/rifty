/**
 * `which NAME...` — report which of the NAMEs are runnable commands.
 *
 * Factory closure takes the shell's live resolution sink so selection and the
 * reported location are projections of the same result.
 *
 * A builtin has no filesystem location, so its honest "location" is just its
 * name — we print NAME, not a path. An installed CLI prints its absolute
 * `node_modules/.bin/<name>` path. An explicitly addressed relative file keeps
 * the user's spelling. On a miss we print nothing (GNU `which` is silent on a
 * miss). Exit 0 iff every NAME resolved; 1 if any missed; 2 on usage error.
 */

import { NotImplementedError } from '@riftydev/io';
import type { CommandResolution } from '../command-resolver.ts';
import type { ShellCommand } from '../types.ts';

export const which =
  (resolveCommand: (name: string) => CommandResolution): ShellCommand =>
  async (args, ctx) => {
    const names: string[] = [];
    for (const arg of args) {
      // -a/--all enumerate every PATH hit; -s is silent-mode. We have neither a
      // PATH nor a use for them yet — throw loudly rather than mis-treat as a name.
      if (arg === '-a' || arg === '--all') {
        throw new NotImplementedError('shell.which.-a', 'no PATH to enumerate all hits');
      }
      if (arg === '-s') {
        throw new NotImplementedError('shell.which.-s', 'silent mode not implemented');
      }
      names.push(arg);
    }
    if (names.length === 0) {
      ctx.stderr.write('which: missing argument\n');
      return 2; // usage error — distinct from a 1 "not found".
    }
    let allFound = true;
    for (const name of names) {
      const resolution = resolveCommand(name);
      switch (resolution.kind) {
        case 'registered':
          ctx.stdout.write(`${name}\n`);
          break;
        case 'file':
          ctx.stdout.write(`${resolution.source === 'direct' ? name : resolution.path}\n`);
          break;
        case 'miss':
          allFound = false; // silent on a miss; exit reflects it.
          break;
      }
    }
    return allFound ? 0 : 1;
  };
