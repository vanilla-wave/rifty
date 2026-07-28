import { NotImplementedError } from '@riftydev/io';
import { type ProcessSnapshot, formatProcessSnapshot } from '@riftydev/kernel';
import type { ShellCommand } from '@riftydev/shell';

export function createOwnerProcessListCommand(
  snapshot: () => readonly ProcessSnapshot[],
): ShellCommand {
  return async (args, ctx) => {
    const output = formatProcessSnapshot(args, snapshot());
    if (output === null) {
      throw new NotImplementedError('workbench.ps', `unsupported ps form: ps ${args.join(' ')}`);
    }
    ctx.stdout.write(output);
    return 0;
  };
}
