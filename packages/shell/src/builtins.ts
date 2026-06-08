// TODO(backlog: shell/command-file-layout) — one builtin per file under commands/<cmd>.ts; this barrel only registers them.
/**
 * Built-in command registration barrel.
 *
 * Each builtin lives in its own `commands/<cmd>.ts` module (Q-2026-06-07-407);
 * this file imports them and maps argv-0 → {@link ShellCommand}.
 *
 * `which` is a factory: it needs the shell's command-presence probe to answer
 * "is NAME a command?" without a reverse import (mirrors `cd`'s `setCwd`).
 *
 * File ops go through the VFS sync mirror so the shell sees the same tree as
 * `node:fs` inside the runtime.
 */

import { basename } from './commands/basename.ts';
import { cat } from './commands/cat.ts';
import { cd } from './commands/cd.ts';
import { clear } from './commands/clear.ts';
import { cp } from './commands/cp.ts';
import { dirname } from './commands/dirname.ts';
import { echo } from './commands/echo.ts';
import { envCmd } from './commands/env.ts';
import { find } from './commands/find.ts';
import { grep } from './commands/grep.ts';
import { head } from './commands/head.ts';
import { ls } from './commands/ls.ts';
import { mkdir } from './commands/mkdir.ts';
import { mv } from './commands/mv.ts';
import { printf } from './commands/printf.ts';
import { pwd } from './commands/pwd.ts';
import { realpath } from './commands/realpath.ts';
import { rm } from './commands/rm.ts';
import { seq } from './commands/seq.ts';
import { sleep } from './commands/sleep.ts';
import { tail } from './commands/tail.ts';
import { touch } from './commands/touch.ts';
import { falseCmd, trueCmd } from './commands/true-false.ts';
import { wc } from './commands/wc.ts';
import { which } from './commands/which.ts';
import type { ShellCommand } from './types.ts';

export function builtinCommands(
  setCwd: (p: string) => void,
  hasCommand: (name: string) => boolean,
): Record<string, ShellCommand> {
  return {
    pwd,
    cd: cd(setCwd),
    echo,
    ls,
    cat,
    mkdir,
    rm,
    env: envCmd,
    find,
    grep,
    which: which(hasCommand),
    clear,
    touch,
    head,
    tail,
    wc,
    basename,
    dirname,
    realpath,
    seq,
    sleep,
    true: trueCmd,
    false: falseCmd,
    printf,
    cp,
    mv,
  };
}
