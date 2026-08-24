/**
 * `help` — discoverability affordance: list the LIVE registered command registry +
 * a one-line synopsis per command.
 *
 * Lists from an injected registered-name source so output cannot drift from
 * builtins or host registrations while installed `.bin` discovery stays out.
 * Per-command synopses are editorial text in {@link SYNOPSIS}; keep in sync
 * with `commands/` as builtins are added.
 */

import type { ShellCommand } from '../types.ts';

const SYNOPSIS: Record<string, string> = {
  pwd: 'print the current working directory',
  cd: 'change the current working directory',
  echo: 'write arguments to stdout',
  ls: 'list directory contents',
  cat: 'concatenate files (or stdin) to stdout',
  mkdir: 'create directories',
  rm: 'remove files and directories',
  env: 'print environment variables',
  find: 'walk the file tree',
  grep: 'search for a pattern in files or stdin',
  git: 'version control (subset)',
  which: 'locate a command',
  clear: 'clear the terminal screen',
  touch: 'create empty files or bump mtime',
  head: 'print the leading lines of files or stdin',
  jobs: 'list background jobs',
  tail: 'print the trailing lines of files',
  wc: 'count lines, words and bytes',
  basename: 'strip directory and suffix from a path',
  dirname: 'strip the last component from a path',
  realpath: 'resolve a path to its absolute form',
  seq: 'print a sequence of numbers',
  sleep: 'pause for N seconds',
  true: 'do nothing, exit 0',
  false: 'do nothing, exit 1',
  printf: 'format and print arguments',
  cp: 'copy files and directories',
  mv: 'move or rename files',
  help: 'list commands and show per-command help',
};

const RUN_PROGRAMS_NOTE = 'node, npm and vite run programs — use `<tool> --help`.';

/**
 * `help [command]`. Factory: takes the shell's live command-name lister so the
 * listing reflects every registered command at invocation time.
 */
export function help(listRegisteredCommandNames: () => readonly string[]): ShellCommand {
  return async (args, ctx) => {
    const topic = args[0];
    if (topic !== undefined) {
      const synopsis = SYNOPSIS[topic];
      if (synopsis === undefined) {
        ctx.stderr.write(`help: no help topic for '${topic}'\n`);
        return 1;
      }
      ctx.stdout.write(`${topic} — ${synopsis}\n`);
      return 0;
    }
    const names = [...listRegisteredCommandNames()].sort();
    ctx.stdout.write(`Commands:  ${names.join('  ')}\n`);
    ctx.stdout.write(`${RUN_PROGRAMS_NOTE}\n`);
    ctx.stdout.write('Run `help <command>` for a one-line description.\n');
    return 0;
  };
}
