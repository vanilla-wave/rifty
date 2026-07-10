import { tokenize } from '@riftydev/shell';

/**
 * True when the accepted shell grammar can launch work after `Shell.run`
 * returns. Uses the shell's tokenizer so quoted/escaped `&` and `&&` cannot
 * drift from execution. This is deliberately conservative: a short-circuited
 * trailing background segment still protects Scratch (extra dirty > wipe).
 */
export function ptyRunMayOutliveExit(line: string, env: Readonly<Record<string, string>>): boolean {
  const tokens = tokenize(line, env);
  const last = tokens.at(-1);
  return last !== undefined && 'op' in last && last.op === '&';
}
