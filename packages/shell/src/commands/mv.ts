import { NotImplementedError } from '@riftydev/io';
import { VfsError, basename, guardVfsMutations, joinPath, syncMirror } from '@riftydev/vfs';
import type { ShellCommand } from '../types.ts';
import { resolve, strerror } from './_shared.ts';

interface Opts {
  noClobber: boolean; // -n
  verbose: boolean; // -v
}

function parse(args: string[]): { opts: Opts; operands: string[] } {
  const opts: Opts = { noClobber: false, verbose: false };
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
    // Bundled short flags (-nv). Unknown ones throw, never silently ignored.
    for (const ch of arg.slice(1)) {
      switch (ch) {
        case 'n':
          opts.noClobber = true;
          break;
        case 'v':
          opts.verbose = true;
          break;
        default:
          throw new NotImplementedError(`shell.mv.-${ch}`, `flag -${ch} not implemented`);
      }
    }
  }
  return { opts, operands };
}

/** One src→dst move honoring -n/-v. Returns 0 on success/skip, 1 on VfsError. */
function move(
  srcAbs: string,
  dstAbs: string,
  opts: Opts,
  ctx: Parameters<ShellCommand>[1],
): number {
  const fs = syncMirror();
  if (opts.noClobber && fs.existsSync(dstAbs)) return 0; // skip silently (GNU -n)
  try {
    fs.renameSync(srcAbs, dstAbs);
  } catch (e) {
    if (e instanceof VfsError) {
      // GNU wording via shared strerror: a missing SRC is a stat failure, any
      // other error names the move (matches cp's diagnostic shape).
      const msg =
        e.code === 'ENOENT' && e.path === srcAbs
          ? `mv: cannot stat '${srcAbs}': ${strerror(e)}`
          : `mv: cannot move '${srcAbs}' to '${dstAbs}': ${strerror(e)}`;
      ctx.stderr.write(`${msg}\n`);
      return 1;
    }
    throw e;
  }
  if (opts.verbose) ctx.stdout.write(`renamed '${srcAbs}' -> '${dstAbs}'\n`);
  return 0;
}

/**
 * `mv [-n] [-v] SRC DST` / `mv [-n] [-v] SRC... DIR` — rename/move via
 * `FsSync.renameSync` (mtime preserved — ADR-0090). When DST is an existing
 * directory each SRC lands at DST/basename (GNU — file and dir sources alike);
 * the multi-source form requires DST to be an existing directory.
 *
 * Exit 0 on success; 1 on any VfsError (ENOENT/EISDIR/ENOTDIR/ENOTEMPTY/EINVAL,
 * e.g. moving onto a non-empty dir) or a usage error. `-f/-i/-u/-b` throw
 * NotImplementedError (no silent stub).
 */
export const mv: ShellCommand = async (args, ctx) => {
  const { opts, operands } = parse(args);
  if (operands.length < 2) {
    ctx.stderr.write('mv: missing file operand\n');
    return 1;
  }
  const fs = syncMirror();
  // Guarded by `operands.length < 2` above; assert through noUncheckedIndexedAccess.
  const dst = operands[operands.length - 1] as string;
  const sources = operands.slice(0, -1);
  const dstAbs = resolve(ctx.cwd, dst);
  const dstIsDir = fs.existsSync(dstAbs) && fs.statSync(dstAbs).isDirectory;

  if (sources.length > 1 && !dstIsDir) {
    ctx.stderr.write(`mv: target '${dst}' is not a directory\n`);
    return 1;
  }
  const moves = sources.map((source) => {
    const sourcePath = resolve(ctx.cwd, source);
    const targetPath = dstIsDir ? joinPath(dstAbs, basename(sourcePath)) : dstAbs;
    return { sourcePath, targetPath };
  });
  return await guardVfsMutations(
    ctx.mutationGuard,
    moves.map(({ sourcePath, targetPath }) => ({ kind: 'rename', sourcePath, targetPath })),
    () => {
      let exit = 0;
      for (const { sourcePath, targetPath } of moves) {
        if (move(sourcePath, targetPath, opts, ctx) !== 0) exit = 1;
      }
      return exit;
    },
  );
};
