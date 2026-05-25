/**
 * Built-in shell commands.
 *
 * Each builtin gets the parsed args plus a context with `cwd`, `env`, and the
 * stdout/stderr writers. Builtins return an exit code; the shell aggregates
 * stdout/stderr into the return value of `Shell.run`.
 *
 * File ops go through the VFS sync mirror so the shell sees the same tree as
 * `node:fs` inside the runtime.
 */

import { NotImplementedError } from '@rifty/io';
import { isAbsolute, joinPath, normalizePath, syncMirror } from '@rifty/vfs';
import { MemoryFsSync } from '@rifty/vfs/internal';
import type { CommandContext, ShellCommand } from './types.ts';

function resolve(cwd: string, p: string): string {
  return normalizePath(isAbsolute(p) ? p : joinPath(cwd, p));
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export const pwd: ShellCommand = async (_args, ctx) => {
  ctx.stdout.write(`${ctx.cwd}\n`);
  return 0;
};

export const cd =
  (setCwd: (p: string) => void): ShellCommand =>
  async (args, ctx) => {
    const target = args[0] ?? ctx.env.HOME ?? '/';
    const next = resolve(ctx.cwd, target);
    const fs = syncMirror();
    if (!fs.existsSync(next)) {
      ctx.stderr.write(`cd: ${target}: no such file or directory\n`);
      return 1;
    }
    if (!fs.statSync(next).isDirectory) {
      ctx.stderr.write(`cd: ${target}: not a directory\n`);
      return 1;
    }
    setCwd(next);
    return 0;
  };

export const echo: ShellCommand = async (args, ctx) => {
  ctx.stdout.write(`${args.join(' ')}\n`);
  return 0;
};

export const ls: ShellCommand = async (args, ctx) => {
  const target = resolve(ctx.cwd, args[0] ?? '.');
  try {
    const entries = syncMirror().readdirSync(target);
    for (const e of entries) ctx.stdout.write(`${e}\n`);
    return 0;
  } catch (err) {
    ctx.stderr.write(`ls: ${(err as Error).message}\n`);
    return 1;
  }
};

export const cat: ShellCommand = async (args, ctx) => {
  if (args.length === 0) {
    ctx.stderr.write('cat: missing argument\n');
    return 1;
  }
  for (const a of args) {
    try {
      const bytes = syncMirror().readFileBytesSync(resolve(ctx.cwd, a));
      ctx.stdout.write(decoder.decode(bytes));
    } catch (err) {
      ctx.stderr.write(`cat: ${a}: ${(err as Error).message}\n`);
      return 1;
    }
  }
  return 0;
};

export const mkdir: ShellCommand = async (args, ctx) => {
  let recursive = false;
  const paths: string[] = [];
  for (const a of args) {
    if (a === '-p') recursive = true;
    else paths.push(a);
  }
  if (paths.length === 0) {
    ctx.stderr.write('mkdir: missing operand\n');
    return 1;
  }
  for (const p of paths) {
    try {
      syncMirror().mkdirSync(resolve(ctx.cwd, p), { recursive });
    } catch (err) {
      ctx.stderr.write(`mkdir: ${p}: ${(err as Error).message}\n`);
      return 1;
    }
  }
  return 0;
};

export const rm: ShellCommand = async (args, ctx) => {
  let recursive = false;
  let force = false;
  const paths: string[] = [];
  for (const a of args) {
    if (a === '-r' || a === '-rf' || a === '-R') recursive = true;
    if (a === '-f' || a === '-rf') force = true;
    if (!a.startsWith('-')) paths.push(a);
  }
  for (const p of paths) {
    try {
      syncMirror().rmSync(resolve(ctx.cwd, p), { recursive, force });
    } catch (err) {
      if (!force) {
        ctx.stderr.write(`rm: ${p}: ${(err as Error).message}\n`);
        return 1;
      }
    }
  }
  return 0;
};

export const envCmd: ShellCommand = async (_args, ctx) => {
  for (const [k, v] of Object.entries(ctx.env)) ctx.stdout.write(`${k}=${v}\n`);
  return 0;
};

/**
 * Update mtime of an existing file/dir on the active sync mirror. Returns
 * `true` if the timestamp was actually moved forward.
 *
 * The {@link FsSync} interface does not expose `utimes`. For in-memory
 * (`MemoryFsSync`) we reach into the shared {@link MemoryBackend} (ADR-0014
 * makes the backend part of the public surface). For other backends (OPFS in
 * a Worker) we throw `NotImplementedError` — silently skipping the mtime
 * update would re-introduce the silent stub the caller is trying to remove.
 *
 * TODO(ADR): Q-2026-05-25-touch-utimes — promote `utimes` onto the `FsSync`
 * interface so this isn't backend-sniffed.
 */
function bumpMtime(path: string): void {
  const fs = syncMirror();
  if (fs instanceof MemoryFsSync) {
    const node = fs.backend.resolve(path);
    if (!node) {
      // Shouldn't happen — caller verified existence — but stay defensive.
      return;
    }
    // Date.now() can return the same value twice in tight loops. Bump the
    // mtime forward by at least 1 ms so consecutive `touch`es are visibly
    // distinct (matches GNU `touch` semantics in practice).
    const now = Date.now();
    node.mtime = now > node.mtime ? now : node.mtime + 1;
    return;
  }
  throw new NotImplementedError(
    'shell.touch.utimes',
    'updating mtime on non-MemoryFsSync backends is not yet wired through FsSync — see TODO(ADR): Q-2026-05-25-touch-utimes',
  );
}

export const touch: ShellCommand = async (args, ctx) => {
  if (args.length === 0) {
    ctx.stderr.write('touch: missing operand\n');
    return 1;
  }
  for (const a of args) {
    const p = resolve(ctx.cwd, a);
    const fs = syncMirror();
    try {
      if (fs.existsSync(p)) {
        bumpMtime(p);
      } else {
        fs.writeFileSync(p, encoder.encode(''));
      }
    } catch (err) {
      ctx.stderr.write(`touch: ${a}: ${(err as Error).message}\n`);
      return 1;
    }
  }
  return 0;
};

export function builtinCommands(setCwd: (p: string) => void): Record<string, ShellCommand> {
  return {
    pwd,
    cd: cd(setCwd),
    echo,
    ls,
    cat,
    mkdir,
    rm,
    env: envCmd,
    touch,
  };
}

export type { CommandContext, ShellCommand };
