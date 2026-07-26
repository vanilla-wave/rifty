import { Shell } from '@riftydev/shell';
import { describe, expect, it } from 'vitest';
import { createOwnerProcessListCommand } from './owner-process-list-command.ts';

describe('owner process-list command', () => {
  it('renders the live owner-root PID/PPID snapshot', async () => {
    const shell = new Shell();
    shell.registerCommand(
      'ps',
      createOwnerProcessListCommand(() => [
        { pid: 1, ppid: 0, command: 'rifty' },
        { pid: 2, ppid: 1, command: 'nodemon' },
        { pid: 20, ppid: 2, command: 'node' },
      ]),
    );

    const result = await shell.run('ps -A -o ppid,pid');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [' PPID   PID', '    0     1', '    1     2', '    2    20', ''].join('\n'),
    );
  });

  it('fails loudly for an unsupported ps form', async () => {
    const shell = new Shell();
    shell.registerCommand(
      'ps',
      createOwnerProcessListCommand(() => []),
    );

    const result = await shell.run('ps aux');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('ps: Not implemented: workbench.ps (unsupported ps form: ps aux)\n');
  });
});
