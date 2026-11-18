/**
 * I4 limits (goal isolate-host-run-code, scenario step 5): each overrun ends
 * the child, not this (consumer) process, with a distinct `termination`; the
 * output cap truncates and discards. Every case runs a real child + isolate.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { runCode } from '../src/index.ts';
import { childPids } from './support.ts';

/** Max main-thread lag of this process while `work` runs. */
async function withLag<T>(work: () => Promise<T>): Promise<{ value: T; maxLagMs: number }> {
  let maxLagMs = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    maxLagMs = Math.max(maxLagMs, now - last - 10);
    last = now;
  }, 10);
  try {
    return { value: await work(), maxLagMs };
  } finally {
    clearInterval(timer);
  }
}

afterEach(async () => {
  // The consumer keeps working after every overrun, and no child is left behind.
  await expect(runCode('console.log(6 * 7)')).resolves.toEqual({
    stdout: '42\n',
    stderr: '',
    exitCode: 0,
  });
  expect(childPids()).toEqual([]);
});

describe('runCode limits (I4)', () => {
  it('a synchronous busy loop is killed at the deadline without blocking the host', async () => {
    const started = Date.now();
    const { value, maxLagMs } = await withLag(() =>
      runCode("console.log('spin'); for (;;) {}", { timeoutMs: 1500 }),
    );
    expect(value).toEqual({ stdout: 'spin\n', stderr: '', exitCode: null, termination: 'timeout' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(maxLagMs).toBeLessThan(250);
  });

  it('a never-draining event loop is killed at the deadline', async () => {
    const value = await runCode("setInterval(() => {}, 50); console.log('armed')", {
      timeoutMs: 1000,
    });
    expect(value).toEqual({
      stdout: 'armed\n',
      stderr: '',
      exitCode: null,
      termination: 'timeout',
    });
  });

  it('isolate heap growth past memoryLimitMb ends with termination memory', async () => {
    const value = await runCode(
      "console.log('grow'); const a = []; for (;;) a.push({ x: Math.random(), s: 'y'.repeat(100) })",
      { memoryLimitMb: 64, timeoutMs: 60_000 },
    );
    expect(value).toEqual({ stdout: 'grow\n', stderr: '', exitCode: null, termination: 'memory' });
  });

  it('a catastrophic OOM ends with termination catastrophic-oom', async () => {
    const value = await runCode("console.log('big'); new Array(2 ** 28).fill(0)", {
      memoryLimitMb: 64,
      maxRssMb: 8192,
      timeoutMs: 90_000,
    });
    expect(value).toEqual({
      stdout: 'big\n',
      stderr: '',
      exitCode: null,
      termination: 'catastrophic-oom',
    });
  }, 120_000);

  it('child RSS past maxRssMb ends with termination rss', async () => {
    const value = await runCode("console.log('rss'); new Array(2 ** 28).fill(0)", {
      memoryLimitMb: 64,
      maxRssMb: 400,
      timeoutMs: 60_000,
    });
    expect(value).toEqual({ stdout: 'rss\n', stderr: '', exitCode: null, termination: 'rss' });
  }, 90_000);

  it('output past maxOutputBytes is truncated and the run continues to its own exit', async () => {
    const value = await runCode(
      "for (let i = 0; i < 300; i++) console.log('x'.repeat(999)); console.error('tail'); process.exitCode = 5",
      { maxOutputBytes: 100_000 },
    );
    expect(value.exitCode).toBe(5);
    expect(value.termination).toBeUndefined();
    expect(value.truncated).toBe(true);
    expect(value.stdout).toBe(`${'x'.repeat(999)}\n`.repeat(100));
    expect(value.stderr).toBe('');
  });

  it('a 256 MiB flood past the cap is discarded, not buffered, by the host', async () => {
    const before = process.memoryUsage().rss;
    const value = await runCode(
      "const s = 'z'.repeat(1 << 20); for (let i = 0; i < 256; i++) process.stdout.write(s); console.error('end')",
      { maxOutputBytes: 1 << 20, timeoutMs: 60_000 },
    );
    const grownMb = (process.memoryUsage().rss - before) / (1 << 20);
    expect(value.exitCode).toBe(0);
    expect(value.truncated).toBe(true);
    expect(value.stdout.length).toBe(1 << 20);
    expect(value.stderr).toBe('');
    expect(grownMb).toBeLessThan(64);
  }, 90_000);
});
