import { type ProcessExit, Shell } from '@riftydev/shell';
import { describe, expect, it } from 'vitest';
import { runNestedShellCommand } from './run-nested-shell-command.ts';

function context(signal?: AbortSignal) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    ctx: {
      cwd: '/',
      env: {},
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      signal,
      isTTY: true,
    },
    stdout,
    stderr,
  };
}

describe('runNestedShellCommand', () => {
  it('preserves the exact selected result through a real nested Shell', async () => {
    const shell = new Shell();
    let markerRuns = 0;
    shell.registerCommand(
      'terminated',
      async (): Promise<ProcessExit> => ({ code: null, signal: 'SIGTERM' }),
    );
    shell.registerCommand('marker', async () => {
      markerRuns += 1;
      return 0;
    });
    const { ctx } = context();

    await expect(runNestedShellCommand(shell, 'terminated && marker', ctx)).resolves.toEqual({
      code: null,
      signal: 'SIGTERM',
    });
    expect(markerRuns).toBe(0);
  });

  it('waits for an owned child and retains its physical SIGTERM on abort', async () => {
    const shell = new Shell();
    const abort = new AbortController();
    shell.registerCommand(
      'child',
      (_args, ctx) =>
        new Promise<ProcessExit>((resolve) =>
          ctx.signal?.addEventListener('abort', () => resolve({ code: null, signal: 'SIGTERM' }), {
            once: true,
          }),
        ),
    );
    const { ctx } = context(abort.signal);

    const run = runNestedShellCommand(shell, 'child', ctx);
    abort.abort();

    await expect(run).resolves.toEqual({ code: null, signal: 'SIGTERM' });
  });
});
