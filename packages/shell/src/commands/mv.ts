import { NotImplementedError } from '@riftydev/io';
import { VfsError, basename, joinPath, syncMirror } from '@riftydev/vfs';
import type { ShellCommand } from '../types.ts';
import { resolve } from './_shared.ts';

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
      ctx.stderr.write(`mv: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
  if (opts.verbose) ctx.stdout.write(`renamed '${srcAbs}' -> '${dstAbs}'\n`);
  return 0;
}

/**
 * `mv [-n] [-v] SRC DST` / `mv [-n] [-v] SRC... DIR` — rename/move via
 * `FsSync.renameSync` (mtime preserved — ADR-0083). Multi-source form requires
 * the final operand to be an existing directory; each SRC lands at DIR/basename.
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

  // 2-operand form is a direct rename onto DST (so onto a non-empty dir
  // surfaces ENOTEMPTY); multi-source form requires DST to be a directory and
  // lands each SRC at DST/basename.
  if (sources.length === 1) {
    return move(resolve(ctx.cwd, sources[0] as string), dstAbs, opts, ctx) === 0 ? 0 : 1;
  }
  if (!(fs.existsSync(dstAbs) && fs.statSync(dstAbs).isDirectory)) {
    ctx.stderr.write(`mv: target '${dst}' is not a directory\n`);
    return 1;
  }

  let exit = 0;
  for (const src of sources) {
    const srcAbs = resolve(ctx.cwd, src);
    if (move(srcAbs, joinPath(dstAbs, basename(srcAbs)), opts, ctx) !== 0) exit = 1;
  }
  return exit;
};
