/**
 * `clear` — clear the terminal screen and scrollback. Always exits 0.
 *
 * isTTY-gated (ADR-0089): emits the CSI sequences only when stdout is an
 * interactive terminal. Real `clear` writes them unconditionally, so `clear > f`
 * dumps escape bytes into the file — a deliberate divergence we make to never
 * corrupt a non-TTY sink (Q-2026-06-07: clear isTTY-gating). Any flag (-T TERM,
 * -x, …) is unsupported: throw loud rather than silently ignore.
 */

import { NotImplementedError } from '@riftydev/io';
import type { ShellCommand } from '../types.ts';

const ESC = String.fromCharCode(27);
// Cursor home + erase entire screen + erase scrollback — what GNU `clear -x`
// emits on a modern xterm-256color (the default-no-flag path).
const SEQ = `${ESC}[H${ESC}[2J${ESC}[3J`;

export const clear: ShellCommand = async (args, ctx) => {
  for (const arg of args) {
    if (arg.startsWith('-') && arg !== '-') {
      throw new NotImplementedError(`shell.clear.${arg}`, 'unsupported clear flag');
    }
  }
  if (ctx.isTTY) ctx.stdout.write(SEQ);
  return 0;
};
