import { NotImplementedError } from '@riftydev/io';
import { VfsError } from '@riftydev/vfs';
import type { CommandContext, ShellCommand } from '../types.ts';
import { osc8FileLink } from './_osc8.ts';
import {
  commandFileSystem,
  dec,
  escapeRegExp,
  readAllStdin,
  resolve,
  strerror,
} from './_shared.ts';
import { walk } from './_walk.ts';

interface Opts {
  recursive: boolean; // -r / -R
  lineNo: boolean; // -n
  ignoreCase: boolean; // -i
  invert: boolean; // -v
  countOnly: boolean; // -c
  filesWithMatch: boolean; // -l
  withFilename: boolean; // -H (force the filename prefix)
  fixed: boolean; // -F (literal pattern: escape regex metachars)
}

function parse(args: string[]): { opts: Opts; pattern: string | undefined; files: string[] } {
  const opts: Opts = {
    recursive: false,
    lineNo: false,
    ignoreCase: false,
    invert: false,
    countOnly: false,
    filesWithMatch: false,
    withFilename: false,
    fixed: false,
  };
  const positional: string[] = [];
  let optsEnded = false;
  for (const arg of args) {
    if (optsEnded || arg === '-' || !arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }
    if (arg === '--') {
      optsEnded = true;
      continue;
    }
    // Bundled short flags (-rn). Each char validated; unknown/unimplemented throw.
    for (const ch of arg.slice(1)) {
      switch (ch) {
        case 'r':
        case 'R':
          opts.recursive = true;
          break;
        case 'n':
          opts.lineNo = true;
          break;
        case 'i':
          opts.ignoreCase = true;
          break;
        case 'v':
          opts.invert = true;
          break;
        case 'c':
          opts.countOnly = true;
          break;
        case 'l':
          opts.filesWithMatch = true;
          break;
        case 'H':
          opts.withFilename = true;
          break;
        case 'F':
          opts.fixed = true;
          break;
        // -E/-P/-A/-B/-C/-w/-x/-o (and any unknown flag) are unimplemented: a
        // silent no-op would lie about the result (e.g. -E selects a different
        // regex dialect than our JS-RegExp default).
        default:
          throw new NotImplementedError(`shell.grep.-${ch}`, `flag -${ch} not implemented`);
      }
    }
  }
  // First positional is PATTERN; the rest are FILEs.
  const [pattern, ...files] = positional;
  return { opts, pattern, files };
}

/** A grep target: `read` is the VFS path to open, `show` the path to print (as given). */
interface Target {
  read: string;
  show: string;
}

/**
 * Join a relative walk path onto a start path AS GIVEN (mirrors `find`): `.` ->
 * `./a`, `/abs` -> `/abs/a`. GNU prints `grep -r` matches relative to the start
 * path as typed, NOT absolutized — `joinPath`/`normalizePath` would drop the `./`.
 */
function joinAsGiven(startPath: string, rel: string): string {
  const base = startPath.replace(/\/+$/, '');
  return base === '' ? `/${rel}` : `${base}/${rel}`;
}

/** Match `text`'s lines against `re`; `linePrefix(n)` builds each kept line's prefix. */
function grepText(
  text: string,
  re: RegExp,
  opts: Opts,
  linePrefix: (lineNo: number) => string,
): { count: number; lines: string[] } {
  // Split on '\n'; a trailing newline yields a final empty segment grep ignores.
  const segments = text.split('\n');
  if (text.endsWith('\n')) segments.pop();
  const lines: string[] = [];
  let count = 0;
  for (let i = 0; i < segments.length; i++) {
    const line = segments[i] as string;
    // Fresh lastIndex each test: `re` has no /g so test() is stateless anyway.
    const matched = re.test(line) !== opts.invert;
    if (!matched) continue;
    count++;
    if (opts.countOnly || opts.filesWithMatch) continue; // suppress the line itself
    lines.push(`${linePrefix(i + 1)}${line}`);
  }
  return { count, lines };
}

/** One file's bytes -> matched lines. `show` is the printed prefix; `read` is opened. */
function grepFile(
  t: Target,
  re: RegExp,
  opts: Opts,
  showName: boolean,
  ctx: CommandContext,
): { count: number; lines: string[] } {
  const text = dec.decode(commandFileSystem(ctx).readFileBytesSync(t.read));
  const name = showName ? `${osc8FileLink(t.read, t.show, ctx)}:` : '';
  return grepText(text, re, opts, (lineNo) => `${name}${opts.lineNo ? `${lineNo}:` : ''}`);
}

/**
 * `grep [-r|-R] [-n] [-i] [-v] [-c] [-l] [-H] [-F] PATTERN [FILE...]` — match
 * lines against a pattern.
 *
 * PATTERN compiles as a JS RegExp (`new RegExp(pattern, i?'i':'')`), a
 * documented divergence from POSIX BRE; `-F` escapes metachars to force a
 * literal. Exit tri-state is load-bearing (GNU): 0 if any line matched, 1 if
 * none matched with no error, 2 on error (bad regex, unreadable/missing path,
 * or no FILE without -r/stdin). stdin-filter mode is M12 — a clean exit-2 error
 * is correct, never a silent stub. Unimplemented flags throw NotImplementedError.
 */
export const grep: ShellCommand = async (args, ctx) => {
  const { opts, pattern, files } = parse(args);

  if (pattern === undefined) {
    ctx.stderr.write('grep: missing pattern\n');
    return 2;
  }

  let re: RegExp;
  try {
    re = new RegExp(opts.fixed ? escapeRegExp(pattern) : pattern, opts.ignoreCase ? 'i' : '');
  } catch {
    ctx.stderr.write(`grep: invalid pattern: ${pattern}\n`);
    return 2;
  }

  // No FILE (non-recursive) + connected stdin → filter stdin (pipe RHS / `< f`).
  // No filename prefix in stdin mode (GNU). Exit 0 if any match, else 1.
  if (!opts.recursive && files.length === 0 && ctx.stdin) {
    const text = dec.decode(await readAllStdin(ctx));
    const { count, lines } = grepText(text, re, opts, (lineNo) =>
      opts.lineNo ? `${lineNo}:` : '',
    );
    if (opts.filesWithMatch) {
      if (count > 0) ctx.stdout.write('(standard input)\n');
    } else if (opts.countOnly) {
      ctx.stdout.write(`${count}\n`);
    } else {
      for (const line of lines) ctx.stdout.write(`${line}\n`);
    }
    return count > 0 ? 0 : 1;
  }

  // Build the file worklist. -r: each dir arg (default '.') expands via walk() to
  // files-only, printed as-given (relative to the start path, like find/GNU).
  // Non-recursive: the literal FILEs, printed as typed.
  const targets: Target[] = [];
  let errored = false;
  if (opts.recursive) {
    const roots = files.length > 0 ? files : ['.'];
    for (const root of roots) {
      const resolved = resolve(ctx.cwd, root);
      try {
        const fs = commandFileSystem(ctx);
        // A file arg (not a dir) is grepped directly; only dirs are walked.
        if (fs.statSync(resolved).isDirectory) {
          for (const entry of walk(resolved, {}, fs)) {
            const rel = entry.path.slice(resolved.length).replace(/^\/+/, '');
            targets.push({ read: entry.path, show: joinAsGiven(root, rel) });
          }
        } else {
          targets.push({ read: resolved, show: root });
        }
      } catch (e) {
        if (e instanceof VfsError) {
          ctx.stderr.write(`grep: ${root}: ${strerror(e)}\n`);
          errored = true;
          continue;
        }
        throw e;
      }
    }
  } else {
    if (files.length === 0) {
      // No FILE, no -r, stdin-filter mode is M12 (ADR pending): clean error.
      ctx.stderr.write('grep: no input files (stdin mode not supported)\n');
      return 2;
    }
    for (const f of files) targets.push({ read: resolve(ctx.cwd, f), show: f });
  }

  // Filename prefix when: >1 target, or -r, or explicit -H.
  const showName = opts.withFilename || opts.recursive || targets.length > 1;

  let anyMatch = false;
  for (const t of targets) {
    try {
      const { count, lines } = grepFile(t, re, opts, showName, ctx);
      if (count > 0) anyMatch = true;
      if (opts.filesWithMatch) {
        if (count > 0) ctx.stdout.write(`${osc8FileLink(t.read, t.show, ctx)}\n`);
      } else if (opts.countOnly) {
        const name = showName ? `${osc8FileLink(t.read, t.show, ctx)}:` : '';
        ctx.stdout.write(`${name}${count}\n`);
      } else {
        for (const line of lines) ctx.stdout.write(`${line}\n`);
      }
    } catch (e) {
      if (e instanceof VfsError) {
        ctx.stderr.write(`grep: ${t.show}: ${strerror(e)}\n`);
        errored = true;
        continue;
      }
      throw e;
    }
  }

  if (errored) return 2; // error trumps both match states (GNU)
  return anyMatch ? 0 : 1;
};
