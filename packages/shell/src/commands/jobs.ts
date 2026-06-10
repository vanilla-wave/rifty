import type { ShellCommand } from '../types.ts';

export interface ShellJobListItem {
  readonly id: number;
  readonly command: string;
  readonly status: 'Running' | 'Done' | `Exit ${number}`;
}

export function jobs(listJobs: () => readonly ShellJobListItem[]): ShellCommand {
  return async (_args, ctx) => {
    for (const job of listJobs()) {
      ctx.stdout.write(`[${job.id}] ${job.status} ${job.command}\n`);
    }
    return 0;
  };
}
