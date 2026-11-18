/**
 * I4 limits (goal isolate-host-run-code, scenario step 5): each overrun ends
 * the child, not this (consumer) process, with a distinct `termination`; the
 * output cap truncates and discards. Every case runs a real child + isolate.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCode } from '../src/index.ts';
import { rssKb, soleChild, waitFor } from './support.ts';

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
  // The consumer keeps working after every overrun (worker lifetime: pool.test.ts, I6).
  await expect(runCode('console.log(6 * 7)')).resolves.toEqual({
    stdout: '42\n',
    stderr: '',
    exitCode: 0,
  });
});

describe('runCode limits (I4)', () => {
  it('a synchronous busy loop is killed at the deadline without blocking the host', async () => {
    const started = Date.now();
    const { value, maxLagMs } = await withLag(() =>
      runCode("console.log('spin'); for (;;) {}", { timeoutMs: 1500 }),
    );
    expect(value).toEqual({ stdout: 'spin\n', stderr: '', exitCode: null, termination: 'timeout' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
    expect(Date.now() - started).toBeLessThanOrEqual(1500 + 1000);
    expect(maxLagMs).toBeLessThan(250);
  });

  it('a never-draining event loop is killed at the deadline', async () => {
    const started = Date.now();
    const { value, maxLagMs } = await withLag(() =>
      runCode("setInterval(() => {}, 50); console.log('armed')", { timeoutMs: 1000 }),
    );
    expect(value).toEqual({
      stdout: 'armed\n',
      stderr: '',
      exitCode: null,
      termination: 'timeout',
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
    expect(Date.now() - started).toBeLessThanOrEqual(1000 + 1000);
    expect(maxLagMs).toBeLessThan(250);
  });

  it('isolate heap growth past memoryLimitMb ends with termination memory', async () => {
    const started = Date.now();
    const value = await runCode(
      "console.log('grow'); const a = []; for (;;) a.push({ x: Math.random(), s: 'y'.repeat(100) })",
      { memoryLimitMb: 64, timeoutMs: 60_000 },
    );
    expect(value).toEqual({ stdout: 'grow\n', stderr: '', exitCode: null, termination: 'memory' });
    expect(Date.now() - started).toBeLessThan(61_000);
  });

  it('memoryLimitMb is the heap limit: 2e6 small objects die at 128 MiB and complete at 512 MiB', async () => {
    const code =
      "const a = []; for (let i = 0; i < 2e6; i++) a.push({ i, s: 'k' + i }); console.log(a.length)";
    // 128 MiB is also isolated-vm's own default: the 512 MiB run proves the option reaches the isolate.
    await expect(runCode(code, { memoryLimitMb: 128, timeoutMs: 60_000 })).resolves.toEqual({
      stdout: '',
      stderr: '',
      exitCode: null,
      termination: 'memory',
    });
    await expect(runCode(code, { memoryLimitMb: 512, timeoutMs: 60_000 })).resolves.toEqual({
      stdout: '2000000\n',
      stderr: '',
      exitCode: 0,
    });
  }, 120_000);

  it('a catastrophic allocation ends with termination memory, child RSS held near 256 + 3 × limit', async () => {
    const started = Date.now();
    const running = runCode("console.log('big'); new Array(2 ** 28).fill(0)", {
      memoryLimitMb: 64,
      timeoutMs: 60_000,
    });
    running.catch(() => {}); // asserted below
    // isolated-vm lets this guest grow far past memoryLimit (probe: ~1.26 GB before
    // its fatal-OOM callback); the RSS watchdog (ceiling 448 MiB here) must stop it
    // first. A sampled watchdog overshoots by one backing-store doubling (measured
    // 661–808 MiB on macOS arm64), so the bound is 2 × the ceiling.
    const pid = await waitFor(() => soleChild(), 2000);
    let peakMb = 0;
    const sampler = setInterval(() => {
      const kb = rssKb(pid);
      if (kb !== null) peakMb = Math.max(peakMb, kb / 1024);
    }, 20);
    const value = await running.finally(() => clearInterval(sampler));
    expect(value).toEqual({ stdout: 'big\n', stderr: '', exitCode: null, termination: 'memory' });
    expect(Date.now() - started).toBeLessThan(61_000);
    expect(peakMb).toBeGreaterThan(0);
    expect(peakMb).toBeLessThan((256 + 3 * 64) * 2);
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
      // memoryLimitMb 32 → child RSS ceiling 352 MiB: a child buffering the flood
      // (≥ 256 MiB over its baseline) would end as `memory`, not exit 0.
      { maxOutputBytes: 1 << 20, timeoutMs: 60_000, memoryLimitMb: 32 },
    );
    const grownMb = (process.memoryUsage().rss - before) / (1 << 20);
    expect(value.exitCode).toBe(0);
    expect(value.truncated).toBe(true);
    expect(value.stdout.length).toBe(1 << 20);
    expect(value.stderr).toBe('');
    expect(grownMb).toBeLessThan(64);
  }, 90_000);

  it("empty writes count against nothing and buffer nothing (1e6 × write('') at a 1 KiB cap)", async () => {
    const before = process.memoryUsage().rss;
    const value = await runCode(
      "for (let i = 0; i < 1e6; i++) process.stdout.write(''); process.stdout.write('end')",
      { maxOutputBytes: 1024, timeoutMs: 120_000 },
    );
    expect(value).toEqual({ stdout: 'end', stderr: '', exitCode: 0 });
    expect((process.memoryUsage().rss - before) / (1 << 20)).toBeLessThan(64);
  }, 150_000);

  it('1e6 one-byte writes past a 512 KiB cap stay bounded in the consumer', async () => {
    const before = process.memoryUsage().rss;
    const value = await runCode(
      "for (let i = 0; i < 1e6; i++) process.stdout.write(i % 2 ? 'a' : 'b'); console.error('e')",
      { maxOutputBytes: 1 << 19, timeoutMs: 120_000 },
    );
    expect(value.exitCode).toBe(0);
    expect(value.truncated).toBe(true);
    expect(value.stdout.length).toBe(1 << 19);
    expect((process.memoryUsage().rss - before) / (1 << 20)).toBeLessThan(64);
  }, 150_000);

  it('a flip to truncated with no new bytes still reaches the consumer', async () => {
    // Exactly the cap, then more: the later write adds no kept bytes, only the flip.
    const value = await runCode(
      "process.stdout.write('abcd'); setTimeout(() => process.stdout.write('e'), 20)",
      { maxOutputBytes: 4 },
    );
    expect(value).toEqual({ stdout: 'abcd', stderr: '', exitCode: 0, truncated: true });
  });

  it('truncation survives a timeout kill', async () => {
    const value = await runCode("process.stdout.write('x'.repeat(5000)); for (;;) {}", {
      maxOutputBytes: 100,
      timeoutMs: 1000,
    });
    expect(value).toEqual({
      stdout: 'x'.repeat(100),
      stderr: '',
      exitCode: null,
      termination: 'timeout',
      truncated: true,
    });
  });

  it('timeoutMs above the timer range is refused, not fired at once', async () => {
    await expect(runCode('1', { timeoutMs: 2 ** 31 })).rejects.toThrow(RangeError);
    await expect(runCode('1', { timeoutMs: 2 ** 31 - 1 })).resolves.toEqual({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
  });
});

describe('a refused timer keeps nothing alive (I4)', () => {
  it('2000 caught setTimeout(f, 1n) holding 80 KB each run in a 64 MiB heap, as in Node', async () => {
    // `after *= 1` throws before the timer exists: its callback (and what it
    // closes over) must not stay in the host's timer table.
    const code =
      "for (let i = 0; i < 2000; i++) { const big = new Array(1e4).fill(i); try { setTimeout(() => big, 1n) } catch {} } console.log('done')";
    const cwd = mkdtempSync(join(tmpdir(), 'isolate-host-oracle-'));
    try {
      const node = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', code], {
        cwd,
        env: {},
        encoding: 'utf8',
      });
      expect({ stdout: node.stdout, code: node.status }).toEqual({ stdout: 'done\n', code: 0 });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
    expect(await runCode(code, { memoryLimitMb: 64 })).toEqual({
      stdout: 'done\n',
      stderr: '',
      exitCode: 0,
    });
  });
});
