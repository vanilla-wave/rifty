import { globalProcessManager } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { exec } from './child_process.ts';

function readExec(
  command: string,
): Promise<{ error: Error | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  });
}

describe('ADR-0202 virtual ps', () => {
  const live: Array<{ kill(signal?: string): boolean }> = [];

  afterEach(() => {
    for (const handle of live) handle.kill('SIGTERM');
    live.length = 0;
  });

  it('reports active ProcessManager records as truthful PPID/PID rows', async () => {
    const child = globalProcessManager.spawn(
      'server.js',
      (io) => new Promise<void>((resolve) => io.signal.addEventListener('abort', () => resolve())),
      77,
    );
    live.push(child);

    const result = await readExec('ps -A -o ppid,pid');

    expect(result.error).toBeNull();
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/^\s*PPID\s+PID\s*$/mu);
    expect(result.stdout).toMatch(new RegExp(`^\\s*77\\s+${child.pid}\\s*$`, 'mu'));
  });

  it('returns the truthful empty default selection without invented process columns', async () => {
    const result = await readExec('ps');

    expect(result.error).toBeNull();
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/^\s*PID\s+TTY\s+TIME\s+CMD\s*$/mu);
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('keeps unsupported ps formats loud instead of pretending ps is absent', async () => {
    const result = await readExec('ps -ef');

    expect((result.error as (Error & { code?: number }) | null)?.code).toBe(1);
    expect(result.stderr).toContain(
      'NotImplementedError: Not implemented: child_process.ps-format',
    );
    expect(result.stderr).not.toContain('ENOENT');
  });

  it('keeps an unknown executable on the ENOENT-127 path', async () => {
    const result = await readExec('definitely-not-a-command');
    expect((result.error as (Error & { code?: number }) | null)?.code).toBe(127);
    expect(result.stderr).toContain('spawn definitely-not-a-command ENOENT');
  });
});
