/**
 * `tail` builtin — print the last part of files. GNU-faithful: default last 10
 * lines; `-n N`/`-c N` last N lines/bytes; `-n +N`/`-c +N` from line/byte N to
 * end (1-based). Headers `==> NAME <==` for 2+ files (or `-v`), suppressed by
 * `-q`. `-f`/`-F`/`--retry` throw (no polling loop — ADR: no silent stubs).
 *
 * Exit codes (load-bearing for &&/||): 0 all files read; 1 a usage error or any
 * file could not be opened (remaining operands still processed).
 */

import { NotImplementedError } from '@riftydev/io';
import { type FsSync, syncMirror } from '@riftydev/vfs';
import type { ShellCommand } from '../types.ts';
import { dec, resolve } from './_shared.ts';

type Unit = 'lines' | 'bytes';
/** `from > 0` ⇒ start at 1-based index `from` (the `+N` form); else take last `count`. */
interface Count {
  unit: Unit;
  count: number;
  from: number;
}

interface ParsedArgs {
  count: Count;
  files: string[];
  quiet: boolean;
  verbose: boolean;
}

/** Parse a count operand, distinguishing the `+N` (from-offset) form. Returns null if not a valid number. */
function parseCount(unit: Unit, raw: string): Count | null {
  const plus = raw.startsWith('+');
  const body = plus || raw.startsWith('-') ? raw.slice(1) : raw;
  if (!/^\d+$/.test(body)) return null;
  const n = Number.parseInt(body, 10);
  return plus ? { unit, count: 0, from: Math.max(n, 1) } : { unit, count: n, from: 0 };
}

/**
 * Parse argv. Throws {@link NotImplementedError} for follow modes. Returns a
 * usage error string instead of throwing for bad counts (GNU prints + exit 1).
 */
function parseArgs(args: string[]): ParsedArgs | { error: string } {
  const out: ParsedArgs = {
    count: { unit: 'lines', count: 10, from: 0 },
    files: [],
    quiet: false,
    verbose: false,
  };
  let onlyFiles = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (onlyFiles || a === '-' || !a.startsWith('-')) {
      out.files.push(a);
      continue;
    }
    if (a === '--') {
      onlyFiles = true;
      continue;
    }
    if (a === '-f' || a === '-F' || a === '--follow' || a === '--retry') {
      throw new NotImplementedError('shell.tail.-f', 'follow/retry needs a polling loop');
    }
    if (a === '-q' || a === '--quiet' || a === '--silent') {
      out.quiet = true;
      continue;
    }
    if (a === '-v' || a === '--verbose') {
      out.verbose = true;
      continue;
    }
    // -n / -c, value either attached (-n5, --lines=5) or as the next arg.
    const long: readonly [Unit, string] | null = a.startsWith('--lines=')
      ? ['lines', a.slice('--lines='.length)]
      : a.startsWith('--bytes=')
        ? ['bytes', a.slice('--bytes='.length)]
        : null;
    const short: readonly [Unit, string] | null =
      a.startsWith('-n') || a.startsWith('-c')
        ? [a.startsWith('-n') ? 'lines' : 'bytes', a.slice(2)]
        : null;
    const opt = long ?? short;
    if (opt) {
      const [unit] = opt;
      let val: string | undefined = opt[1];
      if (val === '') {
        val = args[++i];
        if (val === undefined) return { error: `tail: option requires an argument -- '${a[1]}'` };
      }
      const parsed = parseCount(unit, val);
      if (!parsed) {
        const kind = unit === 'lines' ? 'number of lines' : 'number of bytes';
        return { error: `tail: invalid ${kind}: '${val}'` };
      }
      out.count = parsed;
      continue;
    }
    return { error: `tail: invalid option -- '${a.slice(1)}'` };
  }
  return out;
}

/** Tail bytes: `from>0` ⇒ slice from 1-based byte `from`; else last `count` bytes. */
function tailBytes(data: Uint8Array, c: Count): Uint8Array {
  if (c.from > 0) return data.subarray(Math.min(c.from - 1, data.length));
  return c.count >= data.length ? data : data.subarray(data.length - c.count);
}

/**
 * Tail lines. A trailing newline does NOT create a phantom final line: we count
 * the `\n`-delimited records (last record may be unterminated) and slice the raw
 * bytes at a line boundary so output is byte-for-byte a suffix of the input.
 */
function tailLines(data: Uint8Array, c: Count): Uint8Array {
  if (data.length === 0) return data;
  const NL = 10;
  // Offsets where each line begins (0 plus the index after every \n, except a
  // trailing \n which ends the file rather than starting a new line).
  const starts: number[] = [0];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === NL && i + 1 < data.length) starts.push(i + 1);
  }
  if (c.from > 0) {
    const idx = Math.min(c.from - 1, starts.length);
    return idx >= starts.length ? data.subarray(data.length) : data.subarray(starts[idx]);
  }
  if (c.count >= starts.length) return data;
  return c.count <= 0 ? data.subarray(data.length) : data.subarray(starts[starts.length - c.count]);
}

function readFile(fs: FsSync, path: string): Uint8Array {
  const st = fs.statSync(path);
  if (st.isDirectory) {
    const e = new Error('EISDIR') as Error & { code: string };
    e.code = 'EISDIR';
    throw e;
  }
  return fs.readFileBytesSync(path);
}

export const tail: ShellCommand = async (args, ctx) => {
  const parsed = parseArgs(args);
  if ('error' in parsed) {
    ctx.stderr.write(`${parsed.error}\n`);
    return 1;
  }

  const fs = syncMirror();
  const files = parsed.files.length > 0 ? parsed.files : ['-'];
  const showHeaders = parsed.verbose || (!parsed.quiet && files.length > 1);
  let status = 0;
  let printed = 0;

  for (const name of files) {
    if (name === '-') {
      // No stdin tail without buffering all input + a follow loop; keep loud.
      ctx.stderr.write('tail: reading from standard input is not implemented; use a file\n');
      status = 1;
      continue;
    }
    let data: Uint8Array;
    try {
      data = readFile(fs, resolve(ctx.cwd, name));
    } catch (e) {
      const code = (e as { code?: string }).code;
      const reason =
        code === 'EISDIR'
          ? `error reading '${name}': Is a directory`
          : `cannot open '${name}' for reading: No such file or directory`;
      ctx.stderr.write(`tail: ${reason}\n`);
      status = 1;
      continue;
    }
    if (showHeaders) {
      ctx.stdout.write(`${printed > 0 ? '\n' : ''}==> ${name} <==\n`);
    }
    const slice =
      parsed.count.unit === 'bytes' ? tailBytes(data, parsed.count) : tailLines(data, parsed.count);
    ctx.stdout.write(dec.decode(slice));
    printed++;
  }
  return status;
};
