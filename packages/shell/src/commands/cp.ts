import { NotImplementedError } from '@riftydev/io';
import { type FsSync, VfsError, basename, guardVfsMutations } from '@riftydev/vfs';
import type { ShellCommand } from '../types.ts';
import { commandFileSystem, resolve, strerror } from './_shared.ts';

interface Opts {
  recursive: boolean; // -r / -R
  noClobber: boolean; // -n
  verbose: boolean; // -v
}

function parse(args: string[]): { opts: Opts; operands: string[] } {
  const opts: Opts = { recursive: false, noClobber: false, verbose: false };
  const operands: string[] = [];
  let optsEnded = false;
  for (const arg of args) {
    if (optsEnded || arg === '-' || !arg.startsWith('-')) {
      operands.push(arg);
      continue;
    }
    if (arg === '--') {
      optsEnded = true;
      continue;
    }
    // Bundled short flags (-rv). Each char validated; unknown ones throw.
    for (const ch of arg.slice(1)) {
      switch (ch) {
        case 'r':
        case 'R':
          opts.recursive = true;
          break;
        case 'n':
          opts.noClobber = true;
          break;
        case 'v':
          opts.verbose = true;
          break;
        // -p/-a/-u/-f/-i/-l/-s (and any unknown flag) are unimplemented: a
        // silent no-op would be a lie (e.g. -p implies mtime we don't keep).
        default:
          throw new NotImplementedError(`shell.cp.-${ch}`, `flag -${ch} not implemented`);
      }
    }
  }
  return { opts, operands };
}

/** Copy one src → dst (resolved). Returns 0 on success, 1 (with stderr) on a VfsError. */
function copyOne(
  fs: FsSync,
  src: string,
  dst: string,
  opts: Opts,
  stderr: { write(s: string): void },
): number {
  if (opts.noClobber && fs.existsSync(dst)) return 0; // skip, not an error
  try {
    if (opts.recursive) {
      fs.cpSync(src, dst, { recursive: true });
    } else {
      // Single-file copy: a dir src surfaces EISDIR → GNU's omitting-directory.
      fs.copyFileSync(src, dst);
    }
    return 0;
  } catch (e) {
    if (e instanceof VfsError) {
      if (e.code === 'EISDIR' && !opts.recursive && e.path === src) {
        stderr.write(`cp: -r not specified; omitting directory '${src}'\n`);
      } else if (e.code === 'ENOENT' && e.path === src) {
        stderr.write(`cp: cannot stat '${src}': ${strerror(e)}\n`);
      } else {
        stderr.write(`cp: ${strerror(e)}\n`);
      }
      return 1;
    }
    throw e;
  }
}

/**
 * `cp [-r|-R] [-n] [-v] SRC DST` / `cp SRC... DIR` — copy files & trees.
 *
 * Exit 0 on success; 1 on any VfsError or usage error (GNU-faithful: `&&`/`||`
 * branch on this). Multi-source form requires DIR to be an existing directory;
 * each source lands at DIR/basename(src). Unsupported flags throw
 * NotImplementedError (no silent no-op). `-n` skips an existing dst (exit 0).
 */
export const cp: ShellCommand = async (args, ctx) => {
  const { opts, operands } = parse(args);
  if (operands.length === 0) {
    ctx.stderr.write('cp: missing file operand\n');
    return 1;
  }
  if (operands.length === 1) {
    ctx.stderr.write('cp: missing destination file operand\n');
    return 1;
  }

  const fs = commandFileSystem(ctx);
  // length >= 2 verified above, so pop() yields the dest and leaves >=1 source.
  const dest = operands[operands.length - 1] as string;
  const sources = operands.slice(0, -1);
  const destResolved = resolve(ctx.cwd, dest);
  const destIsDir = fs.existsSync(destResolved) && fs.statSync(destResolved).isDirectory;

  // >2 operands ⇒ last MUST be an existing directory (GNU error otherwise).
  if (sources.length > 1 && !destIsDir) {
    ctx.stderr.write(`cp: target '${dest}' is not a directory\n`);
    return 1;
  }

  const copies = sources.map((source) => {
    const sourcePath = resolve(ctx.cwd, source);
    // Into-directory form: copy as DIR/basename(src). Single-operand dst that is
    // itself a dir also lands inside it (GNU behavior).
    const targetPath = destIsDir ? resolve(destResolved, basename(sourcePath)) : destResolved;
    return { sourcePath, targetPath };
  });
  return await guardVfsMutations(
    ctx.mutationGuard,
    copies.map(({ sourcePath, targetPath }) => ({ kind: 'copy', sourcePath, targetPath })),
    () => {
      let exit = 0;
      for (const { sourcePath, targetPath } of copies) {
        const code = copyOne(fs, sourcePath, targetPath, opts, ctx.stderr);
        if (code === 0 && opts.verbose) {
          ctx.stdout.write(`'${sourcePath}' -> '${targetPath}'\n`);
        }
        if (code !== 0) exit = 1;
      }
      return exit;
    },
  );
};
