/**
 * `ls [-a] [-A] [-l] [-1] [-r] [-t] [--color=auto|always|never] [PATH...]`.
 *
 * The rich replacement for the inline `ls`. Layout, sort, dotfile policy and
 * color are GNU-faithful and frozen against coreutils 9.7 (fixtures/ls). The
 * `-l` long format DIVERGES on metadata: VFS has no real perms/owner/nlink
 * (ADR-0050), so those columns are fixed placeholders — NOT fixtured against
 * gls; covered structurally in ls.test.ts.
 */

import { NotImplementedError } from '@riftydev/io';
import { type VfsDirent, VfsError, syncMirror } from '@riftydev/vfs';
import type { CommandContext, ShellCommand } from '../types.ts';
import { packColumns } from './_columns.ts';
import { colorize } from './_sgr.ts';
import { resolve } from './_shared.ts';

type ColorMode = 'auto' | 'always' | 'never';

interface Opts {
  all: boolean; // -a: incl . and ..
  almostAll: boolean; // -A: dotfiles except . and ..
  long: boolean; // -l: long format (one per line, placeholder metadata)
  oneLine: boolean; // -1: one entry per line
  reverse: boolean; // -r
  byTime: boolean; // -t: sort by mtime desc
  /** null ⇒ no --color flag seen (GNU default: off). */
  color: ColorMode | null;
}

/** A listable entry plus its mtime (for -t) and dirent-kind (for color / -l). */
interface Entry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  mtime: number;
}

function parse(args: string[], ctx: CommandContext): { opts: Opts; paths: string[] } {
  const opts: Opts = {
    all: false,
    almostAll: false,
    long: false,
    oneLine: false,
    reverse: false,
    byTime: false,
    color: null,
  };
  const paths: string[] = [];
  let optsDone = false;

  for (const arg of args) {
    if (optsDone || arg === '-' || !arg.startsWith('-')) {
      paths.push(arg);
      continue;
    }
    if (arg === '--') {
      optsDone = true;
      continue;
    }
    if (arg.startsWith('--')) {
      // --color[=WHEN]: bare --color ⇒ auto.
      if (arg === '--color') {
        opts.color = 'auto';
        continue;
      }
      if (arg.startsWith('--color=')) {
        const when = arg.slice('--color='.length);
        if (when !== 'auto' && when !== 'always' && when !== 'never') {
          ctx.stderr.write(`ls: invalid argument '${when}' for '--color'\n`);
          throw new NotImplementedError('shell.ls.--color', `unknown --color value '${when}'`);
        }
        opts.color = when;
        continue;
      }
      throw new NotImplementedError(`shell.ls.${arg}`, `flag ${arg} not implemented`);
    }
    // Bundled short flags (e.g. -altr). Each char validated; unknown ones throw.
    for (const ch of arg.slice(1)) {
      switch (ch) {
        case 'a':
          opts.all = true;
          break;
        case 'A':
          opts.almostAll = true;
          break;
        case 'l':
          opts.long = true;
          break;
        case '1':
          opts.oneLine = true;
          break;
        case 'r':
          opts.reverse = true;
          break;
        case 't':
          opts.byTime = true;
          break;
        default:
          throw new NotImplementedError(`shell.ls.-${ch}`, `flag -${ch} not implemented`);
      }
    }
  }
  return { opts, paths };
}

/** Whether color escapes should be written, resolving --color against isTTY. */
function colorEnabled(mode: ColorMode | null, isTTY: boolean): boolean {
  if (mode === 'always') return true;
  if (mode === 'never' || mode === null) return false;
  return isTTY; // auto
}

/** Byte-order compare (LC_ALL=C): code-unit by code-unit, NOT locale-aware. */
function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Build the listable entries for one directory, applying dotfile policy + sort. */
function collect(dir: string, opts: Opts): Entry[] {
  const fs = syncMirror();
  const dirents = fs.readdirSync(dir);
  const entries: Entry[] = [];

  // Synthetic '.' / '..' only under -a (they precede real dotfiles in byte order).
  const visible: VfsDirent[] = [];
  if (opts.all) {
    visible.push({ name: '.', isDirectory: true, isFile: false });
    visible.push({ name: '..', isDirectory: true, isFile: false });
  }
  for (const d of dirents) {
    if (d.name.startsWith('.') && !opts.all && !opts.almostAll) continue;
    visible.push(d);
  }

  for (const d of visible) {
    // '.'/'..' are synthetic; their mtime is irrelevant (only listed under -a).
    let mtime = 0;
    if (d.name !== '.' && d.name !== '..' && (opts.byTime || opts.long)) {
      mtime = fs.statSync(resolve(dir, d.name)).mtime ?? 0;
    }
    entries.push({ name: d.name, isDirectory: d.isDirectory, isFile: d.isFile, mtime });
  }

  entries.sort((a, b) =>
    opts.byTime
      ? b.mtime - a.mtime || byteCompare(a.name, b.name) // mtime desc, name tiebreak
      : byteCompare(a.name, b.name),
  );
  if (opts.reverse) entries.reverse();
  return entries;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** GNU-ish `MMM DD HH:MM` (UTC, deterministic). -l is not byte-fixtured. */
function formatMtime(ms: number): string {
  const d = new Date(ms);
  const mon = MONTHS[d.getUTCMonth()] ?? '???';
  const day = String(d.getUTCDate()).padStart(2, ' ');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mon} ${day} ${hh}:${mm}`;
}

/** Real on-disk size for an entry (0 for synthetic '.'/'..'). */
function entrySize(e: Entry, dir: string): number {
  if (e.name === '.' || e.name === '..') return 0;
  // resolve handles BOTH a plain child (dir/name) and a file operand whose name
  // is an absolute / non-child path — e.g. `ls -l /etc/hosts` from cwd /home,
  // which the raw `${dir}/${name}` join turned into `/home//etc/hosts` (crash).
  return syncMirror().statSync(resolve(dir, e.name)).size ?? 0;
}

/**
 * One `-l` line with PLACEHOLDER metadata (ADR-0050): type char from the
 * dirent, fixed perms, nlink 1, owner/group 'user'. Only size + mtime are real.
 * `sizeWidth` right-aligns the size column GNU-style across the listing.
 */
function longLine(e: Entry, dir: string, color: boolean, sizeWidth: number): string {
  const typeChar = e.isDirectory ? 'd' : '-';
  const perms = e.isDirectory ? 'rwxr-xr-x' : 'rw-r--r--';
  const size = String(entrySize(e, dir)).padStart(sizeWidth, ' ');
  const name = colorize(e.name, { isDirectory: e.isDirectory, isFile: e.isFile }, color);
  return `${typeChar}${perms} 1 user user ${size} ${formatMtime(e.mtime)} ${name}`;
}

/** Render one directory's entries to the chosen layout. */
function renderDir(entries: Entry[], dir: string, opts: Opts, ctx: CommandContext): string {
  const color = colorEnabled(opts.color, ctx.isTTY ?? false);

  if (opts.long) {
    if (entries.length === 0) return '';
    const sizeWidth = Math.max(...entries.map((e) => String(entrySize(e, dir)).length));
    return `${entries.map((e) => longLine(e, dir, color, sizeWidth)).join('\n')}\n`;
  }

  // One-per-line on non-TTY OR -1; column-packed only on an interactive TTY.
  const onePerLine = opts.oneLine || !ctx.isTTY;
  if (onePerLine) {
    if (entries.length === 0) return '';
    return `${entries
      .map((e) => colorize(e.name, { isDirectory: e.isDirectory, isFile: e.isFile }, color))
      .join('\n')}\n`;
  }
  // Column layout measures PLAIN names; color is applied per cell via `decorate`
  // so SGR bytes never inflate the computed column widths.
  const byName = new Map(entries.map((e) => [e.name, e]));
  const decorate = (name: string): string => {
    const e = byName.get(name);
    return e ? colorize(e.name, { isDirectory: e.isDirectory, isFile: e.isFile }, color) : name;
  };
  return packColumns(
    entries.map((e) => e.name),
    ctx.cols ?? 80,
    decorate,
  );
}

/**
 * `ls` — list directory contents. Exit 0 on success; 1 if any operand is
 * missing. Unimplemented flags throw NotImplementedError (never silently
 * ignored). See module doc for the -l metadata divergence (ADR-0050).
 */
export const ls: ShellCommand = async (args, ctx) => {
  const { opts, paths } = parse(args, ctx);
  const fs = syncMirror();
  const operands = paths.length === 0 ? ['.'] : paths;

  // Classify operands; a missing one is reported now (GNU exits 1, lists rest).
  const fileEntries: Entry[] = [];
  const dirOperands: string[] = [];
  let exit = 0;

  for (const p of operands) {
    const abs = resolve(ctx.cwd, p);
    let stat: { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number };
    try {
      stat = fs.statSync(abs);
    } catch (e) {
      if (e instanceof VfsError && e.code === 'ENOENT') {
        ctx.stderr.write(`ls: cannot access '${p}': No such file or directory\n`);
        exit = 1;
        continue;
      }
      throw e;
    }
    if (stat.isDirectory) {
      dirOperands.push(p);
    } else {
      // A file operand is listed by its given name (no dir read), grouped first.
      fileEntries.push({
        name: p,
        isDirectory: false,
        isFile: true,
        mtime: stat.mtime ?? 0,
      });
    }
  }

  // Header per directory only when >1 operand total (GNU rule).
  const showHeaders = operands.length > 1;
  const groups: string[] = [];

  if (fileEntries.length > 0) {
    fileEntries.sort((a, b) =>
      opts.byTime ? b.mtime - a.mtime || byteCompare(a.name, b.name) : byteCompare(a.name, b.name),
    );
    if (opts.reverse) fileEntries.reverse();
    // File group is rendered as its own (header-less) block.
    groups.push(renderDir(fileEntries, ctx.cwd, opts, ctx));
  }

  for (const p of dirOperands) {
    const abs = resolve(ctx.cwd, p);
    const entries = collect(abs, opts);
    const body = renderDir(entries, abs, opts, ctx);
    groups.push(showHeaders ? `${p}:\n${body}` : body);
  }

  // Blank line between groups (GNU emits one separator, not a trailing one).
  ctx.stdout.write(groups.join('\n'));
  return exit;
};
