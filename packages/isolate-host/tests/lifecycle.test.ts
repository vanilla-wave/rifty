/**
 * Fault matrix rows of distribution/isolate-host-acceptance: concurrent calls
 * stay independent; a child killed from outside rejects loudly; the host
 * keeps working.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { runCode } from '../src/index.ts';
import { childPids, waitFor } from './support.ts';

describe('runCode lifecycle faults', () => {
  it('concurrent calls run in independent instances', async () => {
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        runCode(
          `globalThis.n = (globalThis.n ?? 0) + ${n}; require('fs').writeFileSync('f', '${n}'); setTimeout(() => console.log(globalThis.n, require('fs').readFileSync('f', 'utf8')), 50)`,
        ),
      ),
    );
    expect(results).toEqual(
      [1, 2, 3].map((n) => ({ stdout: `${n} ${n}\n`, stderr: '', exitCode: 0 })),
    );
  });

  it('a child killed from outside rejects the call loudly, then the host keeps working', async () => {
    const before = new Set(childPids());
    const running = runCode("setTimeout(() => console.log('never'), 5000)");
    running.catch(() => {}); // asserted below; keeps an early failure from going unhandled
    const pid = await waitFor(() => childPids().find((p) => !before.has(p)), 1000);
    const killedAt = Date.now();
    execFileSync('kill', ['-9', String(pid)]);
    await expect(running).rejects.toThrow(/isolate-host child .*SIGKILL/);
    // At once — not at the 30 s default deadline.
    expect(Date.now() - killedAt).toBeLessThan(1000);
    await expect(runCode('console.log(1)')).resolves.toEqual({
      stdout: '1\n',
      stderr: '',
      exitCode: 0,
    });
    expect(childPids()).toEqual([]);
  });
});
