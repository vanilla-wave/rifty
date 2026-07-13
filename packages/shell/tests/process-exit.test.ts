import { describe, expect, it } from 'vitest';
import { Shell, shellCommandExitCode } from '../src/index.ts';
import type { ProcessExit, ProcessExitSignal } from '../src/index.ts';

function exactExit(code: number, signal: null): ProcessExit;
function exactExit(code: null, signal: ProcessExitSignal): ProcessExit;
function exactExit(code: number | null, signal: ProcessExitSignal | null): ProcessExit {
  return { code, signal } as ProcessExit;
}

describe('exact shell command exit', () => {
  it('preserves a signal-only command result and derives the legacy shell status', async () => {
    const shell = new Shell();
    shell.registerCommand('terminated', async () => exactExit(null, 'SIGTERM'));

    const result = await shell.run('terminated');

    expect(result.exitCode).toBe(143);
    expect(result.exit).toEqual({ code: null, signal: 'SIGTERM' });
  });

  it('preserves a code exit and selects the last executed compound/pipeline result', async () => {
    const shell = new Shell();
    let markerRuns = 0;
    shell.registerCommand('coded', async () => exactExit(7, null));
    shell.registerCommand('terminated', async () => exactExit(null, 'SIGTERM'));
    shell.registerCommand('marker', async () => {
      markerRuns += 1;
      return 0;
    });

    await expect(shell.run('coded')).resolves.toMatchObject({
      exitCode: 7,
      exit: { code: 7, signal: null },
    });
    await expect(shell.run('terminated ; true')).resolves.toMatchObject({
      exitCode: 0,
      exit: { code: 0, signal: null },
    });
    await expect(shell.run('true | terminated')).resolves.toMatchObject({
      exitCode: 143,
      exit: { code: null, signal: 'SIGTERM' },
    });
    await expect(shell.run('terminated && marker')).resolves.toMatchObject({
      exitCode: 143,
      exit: { code: null, signal: 'SIGTERM' },
    });
    expect(markerRuns).toBe(0);
    await expect(shell.run('terminated || marker')).resolves.toMatchObject({
      exitCode: 0,
      exit: { code: 0, signal: null },
    });
    expect(markerRuns).toBe(1);
    await expect(shell.run('terminated | true')).resolves.toMatchObject({
      exitCode: 0,
      exit: { code: 0, signal: null },
    });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid numeric command status %s as loudly as an invalid rich exit',
    async (status) => {
      const shell = new Shell();
      shell.registerCommand('invalid', async () => status);

      const result = await shell.run('invalid');

      expect(result.exitCode).toBe(1);
      expect(result.exit).toEqual({ code: 1, signal: null });
      expect(result.stderr).toMatch(/invalid: .*status|invalid: .*exit/i);
      expect(() => shellCommandExitCode(status)).toThrow(/status|exit/i);
    },
  );

  it('reports host cancellation as SIGINT while owned settlement waits for the handler', async () => {
    const shell = new Shell();
    const abort = new AbortController();
    shell.registerCommand(
      'owned',
      (_args, ctx) =>
        new Promise<number>((resolve) =>
          ctx.signal?.addEventListener('abort', () => resolve(0), { once: true }),
        ),
    );

    const run = shell.run('owned', {
      signal: abort.signal,
      awaitAbortSettlement: true,
    });
    abort.abort();

    await expect(run).resolves.toMatchObject({
      exitCode: 130,
      exit: { code: null, signal: 'SIGINT' },
    });
  });

  it('keeps the physical signal from an owned child while retaining shell abort status 130', async () => {
    const shell = new Shell();
    const abort = new AbortController();
    shell.registerCommand(
      'child',
      (_args, ctx) =>
        new Promise<ProcessExit>((resolve) =>
          ctx.signal?.addEventListener('abort', () => resolve(exactExit(null, 'SIGTERM')), {
            once: true,
          }),
        ),
    );

    const run = shell.run('child', {
      signal: abort.signal,
      awaitAbortSettlement: true,
    });
    abort.abort();

    await expect(run).resolves.toMatchObject({
      exitCode: 130,
      exit: { code: null, signal: 'SIGTERM' },
    });
  });
});
