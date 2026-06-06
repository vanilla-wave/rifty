/**
 * `true` / `false` — degenerate POSIX/GNU commands that do nothing and exit
 * 0 / 1 respectively. Both ignore ALL arguments by specification (operands and
 * flags alike), so there is no flag parsing and nothing to throw: unlike other
 * builtins, an unknown `-x` here is the GNU-correct no-op, not a silent stub.
 * Load-bearing exit codes: shells branch `&&` / `||` on them.
 */

import type { ShellCommand } from '../types.ts';

export const trueCmd: ShellCommand = async () => 0;
export const falseCmd: ShellCommand = async () => 1;
