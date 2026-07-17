/**
 * `head` builtin — print the leading part of each FILE.
 *
 * GNU-faithful surface: `-n N` (first N lines) / `-n -N` (all but last N),
 * `-c N` / `-c -N` (bytes, not characters), `-q`/`-v` header control. Multiple
 * files get `==> name <==` banners (suppressed by `-q`, forced by `-v`). Exit 0
 * on success, 1 if any file could not be read. `-z` is not implemented.
 */

import { NotImplementedError } from '@riftydev/io';
import { VfsError } from '@riftydev/vfs';
import type { ShellCommand } from '../types.ts';
import { commandFileSystem, dec, readAllStdin, resolve } from './_shared.ts';

const NL = 0x0a; // '\n'

interface Opts {
  /** Byte-count mode when set; otherwise line mode. */
  bytes: boolean;
  /** Count magnitude; negative when the user passed a leading '-'. */
  count: number;
  /** force | suppress | default header policy. */
  headers: 'force' | 'suppress' | 'auto';
}

/** Parse a count operand (leading '-' = "all but last"); null on a non-integer. */
function parseCount(s: string): number | null {
  const n = Number(s);
  return s.trim() !== '' && Number.isInteger(n) ? n : null;
}

/** First `n` lines (n≥0): slice through the nth newline, keeping any partial final line. */
function firstLines(buf: Uint8Array, n: number): Uint8Array {
  if (n <= 0) return buf.subarray(0, 0);
  let seen = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === NL && ++seen === n) return buf.subarray(0, i + 1);
  }
  return buf; // fewer than n lines present
}

/** All but the last `n` lines (n≥0): drop the trailing n line-terminators' content. */
function dropLastLines(buf: Uint8Array, n: number): Uint8Array {
  if (n <= 0) return buf;
  // Count total lines: each '\n' ends a line; a trailing partial line counts too.
  const total = countLines(buf);
  const keep = total - n;
  if (keep <= 0) return buf.subarray(0, 0);
  return firstLines(buf, keep);
}

function countLines(buf: Uint8Array): number {
  let lines = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === NL) lines++;
  }
  // A final byte not terminated by '\n' is one extra (partial) line.
  if (buf.length > 0 && buf[buf.length - 1] !== NL) lines++;
  return lines;
}

/** Apply the selected slice (line or byte mode) to `buf`. */
function slice(buf: Uint8Array, o: Opts): Uint8Array {
  if (o.bytes) {
    if (o.count >= 0) return buf.subarray(0, o.count);
    const end = Math.max(0, buf.length + o.count);
    return buf.subarray(0, end);
  }
  return o.count >= 0 ? firstLines(buf, o.count) : dropLastLines(buf, -o.count);
}

export const head: ShellCommand = async (args, ctx) => {
  const opts: Opts = { bytes: false, count: 10, headers: 'auto' };
  const files: string[] = [];
  let optsDone = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue; // unreachable under the loop bound; satisfies noUncheckedIndexedAccess
    if (optsDone || a === '-' || !a.startsWith('-')) {
      files.push(a);
      continue;
    }
    if (a === '--') {
      optsDone = true;
      continue;
    }
    // Long forms we recognise enough to route to the right error.
    if (a === '-z' || a === '--zero-terminated') {
      throw new NotImplementedError('shell.head.-z', 'NUL line delimiter not supported');
    }
    if (a === '-q' || a === '--quiet' || a === '--silent') {
      opts.headers = 'suppress';
      continue;
    }
    if (a === '-v' || a === '--verbose') {
      opts.headers = 'force';
      continue;
    }
    if (a === '-n' || a === '-c') {
      const val = args[++i];
      if (val === undefined) {
        ctx.stderr.write(`head: option requires an argument -- '${a.slice(1)}'\n`);
        return 1;
      }
      const n = parseCount(val);
      if (n === null) {
        ctx.stderr.write(`head: invalid number of ${a === '-c' ? 'bytes' : 'lines'}: '${val}'\n`);
        return 1;
      }
      opts.bytes = a === '-c';
      opts.count = n;
      continue;
    }
    // Attached form: -nN / -cN (e.g. -n3, -c-5).
    if (a.startsWith('-n') || a.startsWith('-c')) {
      const bytes = a.startsWith('-c');
      const raw = a.slice(2);
      const n = parseCount(raw);
      if (n === null) {
        ctx.stderr.write(`head: invalid number of ${bytes ? 'bytes' : 'lines'}: '${raw}'\n`);
        return 1;
      }
      opts.bytes = bytes;
      opts.count = n;
      continue;
    }
    ctx.stderr.write(`head: invalid option -- '${a.slice(1)}'\n`);
    return 1;
  }

  // No FILE → read stdin if connected; a `-` operand also reads stdin (GNU).
  // Neither a FILE nor a connected stdin → usage error (unchanged).
  const sources = files.length > 0 ? files : ctx.stdin ? ['-'] : [];
  if (sources.length === 0) {
    ctx.stderr.write('head: reading from standard input is not implemented; use a file\n');
    return 1;
  }

  const fs = commandFileSystem(ctx);
  const showHeaders = opts.headers === 'force' || (opts.headers === 'auto' && sources.length > 1);
  let status = 0;
  let printed = 0; // files actually emitted, for blank-line separators
  let stdinBytes: Uint8Array | null = null; // drained once, shared by every `-`

  for (const file of sources) {
    let buf: Uint8Array;
    if (file === '-') {
      if (stdinBytes === null) stdinBytes = await readAllStdin(ctx);
      buf = stdinBytes;
    } else {
      try {
        buf = fs.readFileBytesSync(resolve(ctx.cwd, file));
      } catch (e) {
        const msg =
          e instanceof VfsError && e.code === 'EISDIR'
            ? `head: error reading '${file}': Is a directory\n`
            : `head: cannot open '${file}' for reading: No such file or directory\n`;
        ctx.stderr.write(msg);
        status = 1;
        continue;
      }
    }
    if (showHeaders) {
      if (printed > 0) ctx.stdout.write('\n');
      ctx.stdout.write(`==> ${file === '-' ? 'standard input' : file} <==\n`);
    }
    ctx.stdout.write(dec.decode(slice(buf, opts)));
    printed++;
  }

  return status;
};
