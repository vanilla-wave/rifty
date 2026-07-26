import { NotImplementedError } from '@riftydev/io';
import type { ShellCommand } from '@riftydev/shell';

export interface OwnerProcessListRow {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

export function createOwnerProcessListCommand(
  snapshot: () => readonly OwnerProcessListRow[],
): ShellCommand {
  return async (args, ctx) => {
    const rows = snapshot();
    if (args.length === 0) {
      ctx.stdout.write(
        [
          '  PID TTY          TIME CMD',
          ...rows.map(
            ({ pid, command }) => `${String(pid).padStart(5)} ?        00:00:00 ${command}`,
          ),
          '',
        ].join('\n'),
      );
      return 0;
    }
    if (args.length === 3 && args[0] === '-A' && args[1] === '-o' && args[2] === 'ppid,pid') {
      ctx.stdout.write(
        [
          ' PPID   PID',
          ...rows.map(({ ppid, pid }) => `${String(ppid).padStart(5)} ${String(pid).padStart(5)}`),
          '',
        ].join('\n'),
      );
      return 0;
    }
    throw new NotImplementedError('workbench.ps', `unsupported ps form: ps ${args.join(' ')}`);
  };
}
