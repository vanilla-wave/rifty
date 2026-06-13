/**
 * `which NAME...` — report which of the NAMEs are runnable commands.
 *
 * Factory closure: takes the shell's `hasCommand` presence sink so the builtin
 * can answer "is NAME a command?" without a reverse import (mirrors `cd`'s
 * `setCwd`). The shell wires the real sink in Integrate.
 *
 * A builtin has no filesystem location, so its honest "location" is just its
 * name — we print NAME, not a path. An installed CLI (ADR-0137) DOES have one:
 * `resolveBinPath` reports its `node_modules/.bin/<name>` shim path. Builtins
 * win over a same-named shim (resolution order). On a miss we print nothing
 * (GNU `which` is silent on a miss). Exit 0 iff every NAME resolved; 1 if any
 * missed; 2 on usage error (no NAME operand).
 */

import { NotImplementedError } from '@riftydev/io';
import type { ShellCommand } from '../types.ts';

export const which =
  (
    hasCommand: (name: string) => boolean,
    resolveBinPath?: (name: string) => string | null,
  ): ShellCommand =>
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
      if (hasCommand(name)) {
        ctx.stdout.write(`${name}\n`);
        continue;
      }
      const binPath = resolveBinPath?.(name) ?? null;
      if (binPath !== null) {
        ctx.stdout.write(`${binPath}\n`);
      } else {
        allFound = false; // silent on a miss; exit reflects it.
      }
    }
    return allFound ? 0 : 1;
  };
