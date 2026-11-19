/**
 * Fault matrix rows of distribution/isolate-host-acceptance: concurrent calls
 * stay independent; a failed spawn rejects at once; no worker is orphaned.
 */
import { execFileSync, spawn } from 'node:child_process';
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

  // A worker killed from outside: its calls rerun once (pool-faults.test.ts, ADR-0563 §6).

  it('a child that cannot spawn rejects the call at once (no hang)', () => {
    // A real spawn failure in a separate consumer process: its execPath points nowhere.
    const dist = new URL('../dist/index.js', import.meta.url).href;
    const script = `process.execPath = '/nonexistent/node'; const t = Date.now();
      const { runCode } = await import(${JSON.stringify(dist)});
      runCode('1', { timeoutMs: 60000 }).then(
        () => console.log('RESOLVED'),
        (e) => console.log(JSON.stringify({ code: e.code, ms: Date.now() - t })),
      );`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    const report = JSON.parse(out) as { code: string; ms: number };
    expect(report.code).toBe('ENOENT');
    expect(report.ms).toBeLessThan(1000);
  });

  it('a child whose consumer dies is not orphaned', async () => {
    const dist = new URL('../dist/index.js', import.meta.url).href;
    const consumer = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const { runCode } = await import(${JSON.stringify(dist)}); runCode('setTimeout(() => {}, 60000)', { timeoutMs: 60000 }); console.log('started');`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    await new Promise((resolve) => consumer.stdout?.once('data', resolve));
    const grandchild = await waitFor(() => childPids(consumer.pid)[0], 3000);
    // Past startup (a child still sending 'ready' dies of EPIPE anyway): the guest is running.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    consumer.kill('SIGKILL');
    await waitFor(
      () => (childPids(1).includes(grandchild) || alive(grandchild) ? undefined : true),
      3000,
    );
  });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
