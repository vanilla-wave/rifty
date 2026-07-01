import { NotImplementedError } from '@riftydev/io';
import { VfsError, syncMirror } from '@riftydev/vfs';
import type { ShellCommand } from '../types.ts';
import { dec, readAllStdin, resolve, strerror } from './_shared.ts';

interface Opts {
  numberAll: boolean; // -n
  numberNonBlank: boolean; // -b (implies -n's format, blanks skip the counter)
  showEnds: boolean; // -E and -A: '$' at each EOL
  showTabs: boolean; // -A: tab -> ^I
}

/**
 * Apply -n/-b/-E/-A transforms to one file's text. Lines are split on '\n';
 * a trailing newline yields a final empty segment we must not re-number/-emit.
 */
function render(text: string, o: Opts, startNo: number): { text: string; nextNo: number } {
  if (!o.numberAll && !o.numberNonBlank && !o.showEnds && !o.showTabs) {
    return { text, nextNo: startNo };
  }
  const trailingNewline = text.endsWith('\n');
  const lines = text.split('\n');
  if (trailingNewline) lines.pop(); // drop empty segment after final '\n'
  let n = startNo;
  const out: string[] = [];
  for (const raw of lines) {
    const body = o.showTabs ? raw.replaceAll('\t', '^I') : raw;
    const end = o.showEnds ? '$' : '';
    if (o.numberNonBlank) {
      out.push(raw === '' ? `${body}${end}` : `${pad(n++)}\t${body}${end}`);
    } else if (o.numberAll) {
      out.push(`${pad(n++)}\t${body}${end}`);
    } else {
      out.push(`${body}${end}`);
    }
  }
  // Rejoin with '\n'; restore the trailing newline iff the source had one.
  return { text: out.join('\n') + (trailingNewline ? '\n' : ''), nextNo: n };
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
        case 'A':
          opts.showEnds = true;
          opts.showTabs = true;
          break;
        default:
          throw new NotImplementedError(`shell.cat.-${ch}`, `flag -${ch} not implemented`);
      }
    }
  }
  return { opts, files };
}

/**
 * `cat [-n] [-b] [-A] [-E] FILE...` — concatenate files to stdout.
 *
 * Exit 0 on success; 1 if any file errored (missing file or no FILE arg).
 * With no FILE it reads `ctx.stdin` (pipe RHS / `< file`); a `-` operand also
 * reads stdin (GNU). Neither a FILE nor a connected stdin → usage error.
 * Unlisted flags throw NotImplementedError.
 */
export const cat: ShellCommand = async (args, ctx) => {
  const { opts, files } = parse(args);
  // No FILE → read stdin if connected; otherwise a usage error (unchanged).
  const sources = files.length > 0 ? files : ctx.stdin ? ['-'] : [];
  if (sources.length === 0) {
    ctx.stderr.write('cat: missing argument\n');
    return 1;
  }
  const fs = syncMirror();
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
      const { text, nextNo } = render(dec.decode(bytes), opts, lineNo);
      lineNo = nextNo;
      ctx.stdout.write(text);
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
