import { NotImplementedError } from '@riftydev/io';
import { type FsSync, VfsError } from '@riftydev/vfs';
import type { ShellCommand } from '../types.ts';
import { matchSegment } from './_glob.ts';
import { commandFileSystem, resolve } from './_shared.ts';
import { walk } from './_walk.ts';

type TypeFilter = 'f' | 'd';

interface Opts {
  name: string | null; // -name GLOB (basename match via matchSegment)
  type: TypeFilter | null; // -type f|d
  maxDepth: number; // -maxdepth N (start path = depth 0); default +Inf
  minDepth: number; // -mindepth N; default 0
}

/** Predicates GNU `find` supports that we don't yet — each throws, never no-ops. */
const UNIMPLEMENTED = new Set([
  '-exec',
  '-print0',
  '-mtime',
  '-size',
  '-newer',
  '-regex',
  '-prune',
  '-delete',
  '-empty',
  '-o',
  '-a',
  '-path',
]);

/** Parse an integer flag value; a non-integer is a usage error GNU rejects. */
function parseIntFlag(flag: string, value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new NotImplementedError(`shell.find.${flag}`, `${flag} needs a non-negative integer`);
  }
  return Number(value);
}

function parse(args: string[]): { paths: string[]; opts: Opts } {
  const paths: string[] = [];
  const opts: Opts = { name: null, type: null, maxDepth: Number.POSITIVE_INFINITY, minDepth: 0 };
  let i = 0;
  // GNU grammar: leading operands are start PATHs; the first `-`/expression token
  // ends the path list, after which everything is a predicate.
  while (i < args.length && !args[i]!.startsWith('-')) {
    paths.push(args[i]!);
    i++;
  }
  for (; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case '-name':
        opts.name = args[++i] ?? '';
        break;
      case '-type': {
        const t = args[++i];
        if (t !== 'f' && t !== 'd') {
          // -type l/c/b/p/s (symlink, devices, fifo, socket) unsupported in VFS.
          throw new NotImplementedError('shell.find.-type', `-type ${t ?? ''} not supported`);
        }
        opts.type = t;
        break;
      }
      case '-maxdepth':
        opts.maxDepth = parseIntFlag('-maxdepth', args[++i]);
        break;
      case '-mindepth':
        opts.minDepth = parseIntFlag('-mindepth', args[++i]);
        break;
      default:
        if (UNIMPLEMENTED.has(arg)) {
          throw new NotImplementedError(`shell.find.${arg}`, `predicate ${arg} not implemented`);
        }
        throw new NotImplementedError('shell.find', `unknown predicate ${arg}`);
    }
  }
  if (paths.length === 0) paths.push('.');
  return { paths, opts };
}

/** Last path segment of the start path AS GIVEN — the name `-name` matches at depth 0. */
function startName(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  const seg = slash === -1 ? trimmed : trimmed.slice(slash + 1);
  return seg === '' ? p : seg; // '/' or '' → whole path
}

/**
 * Join a relative walk path onto the start path AS GIVEN — preserving it
 * verbatim (`.` → `./a`, `/abs` → `/abs/a`). NOT joinPath/normalizePath, which
 * would drop the leading `./` GNU keeps.
 */
function joinAsGiven(startPath: string, rel: string): string {
  const base = startPath.replace(/\/+$/, '');
  return base === '' ? `/${rel}` : `${base}/${rel}`;
}

function typeMatches(filter: TypeFilter | null, isDirectory: boolean): boolean {
  if (filter === null) return true;
  return filter === 'd' ? isDirectory : !isDirectory;
}

function nameMatches(name: string | null, basename: string): boolean {
  return name === null || matchSegment(name, basename);
}

/** Emit one start path's tree. Returns 0, or 1 if the start path is missing. */
function walkOne(
  fs: FsSync,
  startPath: string,
  opts: Opts,
  stdout: { write(s: string): void },
  stderr: { write(s: string): void },
  cwd: string,
): number {
  const root = resolve(cwd, startPath);

  let rootIsDir: boolean;
  try {
    rootIsDir = fs.statSync(root).isDirectory;
  } catch (e) {
    if (e instanceof VfsError && e.code === 'ENOENT') {
      stderr.write(`find: '${startPath}': No such file or directory\n`);
      return 1;
    }
    throw e;
  }

  // Depth 0: the start path itself (walk never yields the root).
  if (
    opts.minDepth <= 0 &&
    opts.maxDepth >= 0 &&
    typeMatches(opts.type, rootIsDir) &&
    nameMatches(opts.name, startName(startPath))
  ) {
    stdout.write(`${startPath}\n`);
  }

  if (!rootIsDir) return 0; // a file start point has no descendants

  // walk yields depth 1+; its maxDepth caps descent (entries at maxDepth kept,
  // children not visited) — pass the SAME cap so -maxdepth bounds the walk too.
  const cap = opts.maxDepth === Number.POSITIVE_INFINITY ? undefined : opts.maxDepth;
  for (const entry of walk(root, { maxDepth: cap, includeDirs: true }, fs)) {
    if (entry.depth < opts.minDepth || entry.depth > opts.maxDepth) continue;
    if (!typeMatches(opts.type, entry.isDirectory)) continue;
    if (!nameMatches(opts.name, entry.name)) continue;
    const rel = entry.path.slice(root.length).replace(/^\/+/, '');
    stdout.write(`${joinAsGiven(startPath, rel)}\n`);
  }
  return 0;
}

/**
 * `find [PATH...] [-name GLOB] [-type f|d] [-maxdepth N] [-mindepth N]` —
 * recursive path lister (default PATH `.`).
 *
 * GNU traversal: the start path is emitted first (depth 0), then descendants
 * depth-first, byte-sorted within each directory (per {@link walk}). Child paths
 * are the start path AS GIVEN joined with the relative walk path — never
 * absolutized (`find .` → `.`, `./a`, …). `-name` matches the basename via
 * {@link matchSegment}; `-type f|d` filters; `-maxdepth`/`-mindepth` bound depth.
 *
 * Exit 0 normally; a missing start path is reported to stderr and forces exit 1
 * (other paths still walk). Unimplemented predicates (`-exec`, `-print0`, …)
 * throw {@link NotImplementedError} rather than silently no-op.
 */
export const find: ShellCommand = async (args, ctx) => {
  const { paths, opts } = parse(args);
  const fs = commandFileSystem(ctx);
  let exit = 0;
  for (const p of paths) {
    if (walkOne(fs, p, opts, ctx.stdout, ctx.stderr, ctx.cwd) !== 0) exit = 1;
  }
  return exit;
};
