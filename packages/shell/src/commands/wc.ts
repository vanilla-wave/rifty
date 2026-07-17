/**
 * `wc` — line / word / byte / char counts (GNU-faithful).
 *
 * `-l` counts newline (`\n`) characters, so a final line with no trailing `\n`
 * is NOT counted (GNU). `-w` counts whitespace-delimited tokens. `-c` is BYTES
 * (UTF-8 code units), `-m` is CHARACTERS (Unicode code points) — these diverge
 * on multibyte input (documented). No flags ⇒ `-l -w -c` in that order. Counts
 * are right-justified to a single field width = digits of the largest count
 * printed across every file plus the `total` row (min 1), then a space and the
 * filename. Exit 0 on success, 1 if any file is missing/unreadable.
 */

import { NotImplementedError } from '@riftydev/io';
import { VfsError } from '@riftydev/vfs';
import type { ShellCommand } from '../types.ts';
import { commandFileSystem, dec, readAllStdin, resolve, strerror } from './_shared.ts';

interface Selected {
  lines: boolean;
  words: boolean;
  bytes: boolean;
  chars: boolean;
}

interface Counts {
  lines: number;
  words: number;
  bytes: number;
  chars: number;
}

function countBytes(data: Uint8Array): Counts {
  let lines = 0;
  for (let i = 0; i < data.length; i++) if (data[i] === 0x0a) lines++; // '\n'
  const text = dec.decode(data);
  let chars = 0;
  for (const _ of text) chars++; // iterates code points, not UTF-16 units
  let words = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    // \t \n \v \f \r space — GNU's isspace classes for token boundaries.
    const c = text.charCodeAt(i);
    const ws = c === 0x20 || (c >= 0x09 && c <= 0x0d);
    if (ws) inWord = false;
    else if (!inWord) {
      inWord = true;
      words++;
    }
  }
  return { lines, words, bytes: data.length, chars };
}

/** Emit one row's selected columns right-justified to `width`, then the label. */
function formatRow(c: Counts, sel: Selected, width: number, label: string): string {
  const cols: number[] = [];
  if (sel.lines) cols.push(c.lines);
  if (sel.words) cols.push(c.words);
  if (sel.bytes) cols.push(c.bytes);
  if (sel.chars) cols.push(c.chars);
  return `${cols.map((n) => String(n).padStart(width)).join(' ')} ${label}\n`;
}

export const wc: ShellCommand = async (args, ctx) => {
  const sel: Selected = { lines: false, words: false, bytes: false, chars: false };
  const files: string[] = [];
  let anyFlag = false;
  for (const arg of args) {
    if (arg.length > 1 && arg.startsWith('-') && arg !== '--') {
      for (const ch of arg.slice(1)) {
        switch (ch) {
          case 'l':
            sel.lines = true;
            break;
          case 'w':
            sel.words = true;
            break;
          case 'c':
            sel.bytes = true;
            break;
          case 'm':
            sel.chars = true;
            break;
          default:
            // Loud gap, not a silent ignore (CLAUDE.md): a flagless honoring is worse.
            throw new NotImplementedError(`shell.wc.-${ch}`, 'unsupported wc flag');
        }
        anyFlag = true;
      }
    } else {
      files.push(arg);
    }
  }

  if (!anyFlag) {
    sel.lines = true;
    sel.words = true;
    sel.bytes = true;
  }

  if (files.length === 0) {
    // No FILE → count stdin if connected (pipe RHS / `< file`); GNU prints just
    // the counts with no filename label. Neither FILE nor stdin → usage error.
    if (!ctx.stdin) {
      ctx.stderr.write('wc: no file operand\n');
      return 1;
    }
    const counts = countBytes(await readAllStdin(ctx));
    const cols: number[] = [];
    if (sel.lines) cols.push(counts.lines);
    if (sel.words) cols.push(counts.words);
    if (sel.bytes) cols.push(counts.bytes);
    if (sel.chars) cols.push(counts.chars);
    const width = Math.max(1, String(Math.max(0, ...cols)).length);
    ctx.stdout.write(`${cols.map((n) => String(n).padStart(width)).join(' ')}\n`);
    return 0;
  }

  const fs = commandFileSystem(ctx);
  const rows: { counts: Counts; label: string }[] = [];
  const total: Counts = { lines: 0, words: 0, bytes: 0, chars: 0 };
  let exit = 0;

  for (const file of files) {
    try {
      const data = fs.readFileBytesSync(resolve(ctx.cwd, file));
      const counts = countBytes(data);
      rows.push({ counts, label: file });
      total.lines += counts.lines;
      total.words += counts.words;
      total.bytes += counts.bytes;
      total.chars += counts.chars;
    } catch (e) {
      const msg = e instanceof VfsError ? strerror(e) : 'cannot read';
      ctx.stderr.write(`wc: ${file}: ${msg}\n`);
      exit = 1;
    }
  }

  const multi = files.length > 1;
  // Width follows the largest selected count across all rows + total (GNU).
  let max = 0;
  const consider = (c: Counts) => {
    if (sel.lines) max = Math.max(max, c.lines);
    if (sel.words) max = Math.max(max, c.words);
    if (sel.bytes) max = Math.max(max, c.bytes);
    if (sel.chars) max = Math.max(max, c.chars);
  };
  for (const r of rows) consider(r.counts);
  if (multi) consider(total);
  const width = Math.max(1, String(max).length);

  for (const r of rows) ctx.stdout.write(formatRow(r.counts, sel, width, r.label));
  if (multi) ctx.stdout.write(formatRow(total, sel, width, 'total'));

  return exit;
};
