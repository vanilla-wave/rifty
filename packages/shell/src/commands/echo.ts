/**
 * `echo [-n] [-e] [-E] ARGS...` — print args joined by single spaces.
 *
 * GNU-faithful flag parsing: the leading run of `-…` words sets options and is
 * consumed; the first non-flag arg ends parsing, so `echo hi -n` prints
 * `hi -n` (the `-n` is data, not a flag). Exit code is always 0.
 */

import { NotImplementedError } from '@riftydev/io';
import type { ShellCommand } from '../types.ts';

/** GNU `echo -e` backslash escapes we support. `\0NNN` octal is NOT supported. */
function interpretEscapes(s: string): string {
  let r = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i + 1 >= s.length) {
      r += s[i];
      continue;
    }
    const c = s[++i];
    switch (c) {
      case 'n':
        r += '\n';
        break;
      case 't':
        r += '\t';
        break;
      case 'r':
        r += '\r';
        break;
      case '\\':
        r += '\\';
        break;
      case '0':
        r += '\0';
        break;
      default:
        // Unknown escape: GNU echo prints the backslash + char literally.
        r += `\\${c}`;
    }
  }
  return r;
}

/** A leading word is a flag iff it is `-` followed by 1+ of n/e/E only. */
function isFlagWord(arg: string): boolean {
  return /^-[neE]+$/.test(arg);
}

export const echo: ShellCommand = async (args, ctx) => {
  let trailingNewline = true;
  let escapes = false;
  let i = 0;

  for (; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '' || arg[0] !== '-' || arg === '-') break; // non-flag → operands begin
    if (!isFlagWord(arg)) {
      // A `-…` word that isn't a recognised flag combo: fail loudly per the
      // no-silent-stub rule rather than print it or quietly skip it.
      throw new NotImplementedError(`shell.echo.${arg}`, 'unsupported echo flag');
    }
    for (const ch of arg.slice(1)) {
      if (ch === 'n') trailingNewline = false;
      else if (ch === 'e') escapes = true;
      else escapes = false; // 'E'
    }
  }

  const operands = args.slice(i);
  const body = (escapes ? operands.map(interpretEscapes) : operands).join(' ');
  ctx.stdout.write(trailingNewline ? `${body}\n` : body);
  return 0;
};
