import { NotImplementedError } from '@riftydev/io';
import { VfsError } from '@riftydev/vfs';
import type { ShellCommand } from '../types.ts';
import { commandFileSystem, enc, readAllStdin, resolve, strerror } from './_shared.ts';

interface Opts {
  numberAll: boolean; // -n
  numberNonBlank: boolean; // -b (implies -n's format, blanks skip the counter)
  showEnds: boolean; // -E; implied by -A/-e
  showTabs: boolean; // -T: tab -> ^I; implied by -A/-t
  showNonPrinting: boolean; // -v: ^X / M- notation; implied by -A/-e/-t
}

const LF = new Uint8Array([0x0a]);
const DOLLAR = enc.encode('$');

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, chunk) => n + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * GNU `-v` notation for one byte (verified vs coreutils cat in debian):
 * control (except \t\n here) → `^X` (X = byte+64), DEL → `^?`, high bit →
 * `M-` + the low-7-bit rendering (`M-^X` for 128–159, `M-x` for 160–254,
 * `M-^?` for 255). \n never reaches this (line separator); \t is `-T`'s job.
 */
function nonPrintingMark(b: number): string {
  if (b < 0x20) return `^${String.fromCharCode(b + 64)}`;
  if (b === 0x7f) return '^?';
  const low = b - 128;
  if (low < 0x20) return `M-^${String.fromCharCode(low + 64)}`;
  if (low === 0x7f) return 'M-^?';
  return `M-${String.fromCharCode(low)}`;
}

/** One pass applying `-T` (tab → ^I) and `-v` marks; untouched spans stay raw bytes. */
function renderMarks(line: Uint8Array, o: Opts): Uint8Array {
  const chunks: Uint8Array[] = [];
  let start = 0;
  const mark = (i: number, text: string): void => {
    if (i > start) chunks.push(line.subarray(start, i));
    chunks.push(enc.encode(text));
    start = i + 1;
  };
  for (let i = 0; i < line.byteLength; i++) {
    const b = line[i] as number;
    if (b === 0x09) {
      if (o.showTabs) mark(i, '^I');
      continue;
    }
    if (!o.showNonPrinting) continue;
    if (b < 0x20 || b >= 0x7f) mark(i, nonPrintingMark(b));
  }
  if (chunks.length === 0) return line;
  if (start < line.byteLength) chunks.push(line.subarray(start));
  return concat(chunks);
}

/**
 * Apply -n/-b/-E/-A transforms to one file's byte stream. Lines are split on
 * byte 0x0a; invalid UTF-8 bytes stay untouched. Markers/prefixes are ASCII.
 */
function render(
  bytes: Uint8Array,
  o: Opts,
  startNo: number,
): { bytes: Uint8Array; nextNo: number } {
  if (!o.numberAll && !o.numberNonBlank && !o.showEnds && !o.showTabs && !o.showNonPrinting) {
    return { bytes, nextNo: startNo };
  }
  let n = startNo;
  const out: Uint8Array[] = [];
  let lineStart = 0;
  while (lineStart < bytes.byteLength) {
    const newline = bytes.indexOf(0x0a, lineStart);
    const hasNewline = newline !== -1;
    const lineEnd = hasNewline ? newline : bytes.byteLength;
    const raw = bytes.subarray(lineStart, lineEnd);
    const body = o.showTabs || o.showNonPrinting ? renderMarks(raw, o) : raw;
    if (o.numberNonBlank) {
      if (raw.byteLength !== 0) out.push(enc.encode(`${pad(n++)}\t`));
    } else if (o.numberAll) {
      out.push(enc.encode(`${pad(n++)}\t`));
    }
    out.push(body);
    if (o.showEnds) out.push(DOLLAR);
    if (hasNewline) out.push(LF);
    lineStart = hasNewline ? lineEnd + 1 : bytes.byteLength;
  }
  return { bytes: concat(out), nextNo: n };
}

/** GNU line-number field: count right-justified in a 6-wide column. */
function pad(n: number): string {
  return String(n).padStart(6, ' ');
}

function parse(args: string[]): { opts: Opts; files: string[] } {
  const opts: Opts = {
    numberAll: false,
    numberNonBlank: false,
    showEnds: false,
    showTabs: false,
    showNonPrinting: false,
  };
  const files: string[] = [];
  let optsEnded = false;
  for (const arg of args) {
    if (optsEnded || arg === '-' || !arg.startsWith('-')) {
      files.push(arg);
      continue;
    }
    if (arg === '--') {
      optsEnded = true;
      continue;
    }
    // Bundled short flags (-nE). Each char is validated; unknown ones throw.
    for (const ch of arg.slice(1)) {
      switch (ch) {
        case 'n':
          opts.numberAll = true;
          break;
        case 'b':
          opts.numberNonBlank = true;
          break;
        case 'E':
          opts.showEnds = true;
          break;
        case 'T':
          opts.showTabs = true;
          break;
        case 'v':
          opts.showNonPrinting = true;
          break;
        // GNU combos (verified vs coreutils): -A = -vET, -e = -vE, -t = -vT.
        case 'A':
          opts.showEnds = true;
          opts.showTabs = true;
          opts.showNonPrinting = true;
          break;
        case 'e':
          opts.showEnds = true;
          opts.showNonPrinting = true;
          break;
        case 't':
          opts.showTabs = true;
          opts.showNonPrinting = true;
          break;
        default:
          throw new NotImplementedError(`shell.cat.-${ch}`, `flag -${ch} not implemented`);
      }
    }
  }
  return { opts, files };
}

/**
 * `cat [-n] [-b] [-A] [-e] [-t] [-E] [-T] [-v] FILE...` — concatenate files
 * to stdout, GNU transform semantics (`-A`=`-vET`, `-e`=`-vE`, `-t`=`-vT`).
 *
 * Exit 0 on success; 1 if any file errored (missing file or no FILE arg).
 * With no FILE it reads `ctx.stdin` (pipe RHS / `< file`); a `-` operand also
 * reads stdin (GNU). Neither a FILE nor a connected stdin → usage error.
 * Unlisted flags (e.g. `-s`, `-u`) throw NotImplementedError.
 */
export const cat: ShellCommand = async (args, ctx) => {
  const { opts, files } = parse(args);
  // No FILE → read stdin if connected; otherwise a usage error (unchanged).
  const sources = files.length > 0 ? files : ctx.stdin ? ['-'] : [];
  if (sources.length === 0) {
    ctx.stderr.write('cat: missing argument\n');
    return 1;
  }
  const fs = commandFileSystem(ctx);
  let exit = 0;
  let lineNo = 1; // GNU numbers across all files in one stream
  let stdinBytes: Uint8Array | null = null; // drained once, shared by every `-`
  for (const f of sources) {
    try {
      let bytes: Uint8Array;
      if (f === '-') {
        if (stdinBytes === null) stdinBytes = await readAllStdin(ctx);
        bytes = stdinBytes;
      } else {
        bytes = fs.readFileBytesSync(resolve(ctx.cwd, f));
      }
      if (
        !opts.numberAll &&
        !opts.numberNonBlank &&
        !opts.showEnds &&
        !opts.showTabs &&
        !opts.showNonPrinting
      ) {
        // Plain path writes RAW BYTES (ADR-0198): cat is the byte pump of the
        // pipeline — decoding here corrupted every non-UTF-8 payload.
        ctx.stdout.write(bytes);
      } else {
        const { bytes: rendered, nextNo } = render(bytes, opts, lineNo);
        lineNo = nextNo;
        ctx.stdout.write(rendered);
      }
    } catch (e) {
      if (e instanceof VfsError) {
        ctx.stderr.write(`cat: ${f}: ${strerror(e)}\n`);
        exit = 1;
        continue;
      }
      throw e;
    }
  }
  return exit;
};
