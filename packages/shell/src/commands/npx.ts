import { NotImplementedError } from '@riftydev/io';
import type { CommandResolution } from '../command-resolver.ts';
import type { BinExecutor, ShellOptions } from '../shell.ts';
import type { ShellCommand } from '../types.ts';

/** Local npm exec subset; resolution and execution keep their existing owners. */
export function npx(
  resolveBin: (name: string, cwd: string) => CommandResolution,
  execute: BinExecutor | undefined,
  assertCommand: ShellOptions['assertCommand'],
): ShellCommand {
  return async (args, ctx) => {
    let index = 0;
    while (args[index] === '--no-install') index++;
    if (args[index] === '--') index++;
    else if (args[index]?.startsWith('-')) throw new NotImplementedError('shell.npx.options');
    const name = args[index++];
    if (!name) throw new NotImplementedError('shell.npx.interactive');
    if (name.includes('@') || name.includes('/') || name.includes('\\') || name.includes(':')) {
      throw new NotImplementedError('shell.npx.package-spec');
    }
    const argv = args.slice(index);
    assertCommand?.(name, argv);
    const selected = resolveBin(name, ctx.cwd);
    if (selected.kind !== 'file') throw new NotImplementedError('shell.npx.acquire');
    if (!execute) {
      ctx.stderr.write(`${name}: cannot execute ${selected.path}: no Node executor configured\n`);
      return 126;
    }
    return execute(selected.path, argv, ctx);
  };
}
