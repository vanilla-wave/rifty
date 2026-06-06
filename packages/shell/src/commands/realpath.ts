/**
 * `realpath [-e] [-m] [-q] NAME...` — print each NAME as a normalized absolute
 * path, one per line.
 *
 * VFS has no symlinks (ADR-0050), so canonicalization reduces to normalize +
 * absolutize against cwd (MD-05). Default / `-e` / `-P` require the path to
 * exist; `-m` allows missing components (pure normalize).
 *
 * Exit 0 when every required path resolved; 1 if any required path was missing
 * (load-bearing: shell &&/|| branch on it) or no operand was given. Missing
 * operands under `-q` still exit 1 — `-q` only mutes the diagnostic.
 *
 * Unsupported flags throw {@link NotImplementedError}: `--relative-to` /
 * `--relative-base` (no symlink-free relative mode here) and `-s` (no symlink
 * mode to strip).
 */

import { NotImplementedError } from '@riftydev/io';
import { syncMirror } from '@riftydev/vfs';
import type { ShellCommand } from '../types.ts';
import { resolve } from './_shared.ts';

const USAGE = 'usage: realpath [-e] [-m] [-q] NAME...\n';

interface Opts {
  mustExist: boolean; // -e / -P / default require existence; -m relaxes it
  quiet: boolean; // -q suppress diagnostics (exit code unchanged)
}

function parse(args: string[]): { opts: Opts; names: string[] } {
  const opts: Opts = { mustExist: true, quiet: false };
  const names: string[] = [];
  let optsEnded = false;
  for (const arg of args) {
    if (optsEnded || arg === '-' || !arg.startsWith('-')) {
      names.push(arg);
      continue;
    }
    if (arg === '--') {
      optsEnded = true;
      continue;
    }
    // Long options: --relative-to / --relative-base are unimplemented. Strip
    // any `=VALUE` so `--relative-to=/x` matches `relative-to`.
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = arg.slice(2, eq === -1 ? undefined : eq);
      if (name === 'relative-to' || name === 'relative-base') {
        throw new NotImplementedError(
          `shell.realpath.--${name}`,
          'no relative-path mode without symlinks (ADR-0050)',
        );
      }
      throw new NotImplementedError(
        `shell.realpath.--${name}`,
        `long option --${name} not implemented`,
      );
    }
    // Bundled short flags (-eq). Each char validated; unknown ones throw.
    for (const ch of arg.slice(1)) {
      switch (ch) {
        case 'e':
        case 'P':
          opts.mustExist = true;
          break;
        case 'm':
          opts.mustExist = false;
          break;
        case 'q':
          opts.quiet = true;
          break;
        case 's':
          throw new NotImplementedError('shell.realpath.-s', 'no symlink mode to strip (ADR-0050)');
        default:
          throw new NotImplementedError(`shell.realpath.-${ch}`, `flag -${ch} not implemented`);
      }
    }
  }
  return { opts, names };
}

export const realpath: ShellCommand = async (args, ctx) => {
  const { opts, names } = parse(args);
  if (names.length === 0) {
    ctx.stderr.write('realpath: missing operand\n');
    ctx.stderr.write(USAGE);
    return 1;
  }

  const fs = syncMirror();
  let exit = 0;
  for (const name of names) {
    const abs = resolve(ctx.cwd, name);
    if (opts.mustExist && !fs.existsSync(abs)) {
      if (!opts.quiet) ctx.stderr.write(`realpath: ${name}: No such file or directory\n`);
      exit = 1;
      continue;
    }
    ctx.stdout.write(`${abs}\n`);
  }
  return exit;
};
