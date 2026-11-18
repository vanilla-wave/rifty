/**
 * Goal isolate-host-worker-pool, acceptance rows 5–8: a culprit on a shared
 * worker (memory, time, host-side floods) costs its neighbours nothing but
 * delay (I3, I4, I8); a worker lost with no culprit reruns its calls once
 * (I5). Each scenario runs in its own cold consumer process, so 4 concurrent
 * calls share its one worker (row 2 proves the packing).
 */
import { describe, expect, it } from 'vitest';
import { consumer } from './support.ts';

interface Outcome {
  /** Children while all 4 calls are in flight: 1 = they share a worker. */
  shared: number;
  culprit: Record<string, unknown> & { ms: number };
  neighbours: unknown[];
  next: unknown;
}

/** 3 neighbours (b<i> at 3 s), then the culprit, concurrently on one cold worker; then one more call. */
async function withNeighbours(culprit: string, options: string): Promise<Outcome> {
  const { value } = await consumer(
    `const neighbours = [0, 1, 2].map((i) =>
       settle(runCode("console.log('a" + i + "'); setTimeout(() => console.log('b" + i + "'), 3000)")));
     await sleep(300);
     const t0 = now();
     const running = settle(runCode(${JSON.stringify(culprit)}, ${options}));
     await sleep(150);
     const shared = children().length;
     const culprit = await running;
     const ms = now() - t0;
     out({ shared, culprit: { ...culprit, ms }, neighbours: await Promise.all(neighbours), next: await settle(runCode('console.log(6 * 7)')) });`,
    { timeoutMs: 90_000 },
  );
  return value as Outcome;
}

const neighbour = (i: number) => ({ stdout: `a${i}\nb${i}\n`, stderr: '', exitCode: 0 });
const NEIGHBOURS = [0, 1, 2].map(neighbour);
const NEXT = { stdout: '42\n', stderr: '', exitCode: 0 };

describe('memory on a shared worker (I3)', () => {
  it('a catastrophic allocation is the culprit alone; neighbours get their own result once', async () => {
    const v = await withNeighbours(
      "console.log('big'); new Array(2 ** 28).fill(0)",
      '{ memoryLimitMb: 64, timeoutMs: 60000 }',
    );
    const { ms: _ms, ...culprit } = v.culprit;
    expect(culprit).toEqual({ stdout: 'big\n', stderr: '', exitCode: null, termination: 'memory' });
    expect(v.shared).toBe(1);
    expect(v.neighbours).toEqual(NEIGHBOURS);
    expect(v.next).toEqual(NEXT);
  }, 120_000);

  it('heap growth past the limit is the culprit alone', async () => {
    const v = await withNeighbours(
      "console.log('grow'); const a = []; for (;;) a.push({ x: Math.random(), s: 'y'.repeat(100) })",
      '{ memoryLimitMb: 64, timeoutMs: 60000 }',
    );
    const { ms: _ms, ...culprit } = v.culprit;
    expect(culprit).toEqual({
      stdout: 'grow\n',
      stderr: '',
      exitCode: null,
      termination: 'memory',
    });
    expect(v.shared).toBe(1);
    expect(v.neighbours).toEqual(NEIGHBOURS);
    expect(v.next).toEqual(NEXT);
  }, 120_000);
});

describe('time on a shared worker (I4)', () => {
  it.each([
    ['a busy loop', "console.log('c'); for (;;) {}"],
    [
      'Atomics.wait forever',
      "console.log('c'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)",
    ],
    [
      'a builtin that ignores termination (default-comparator sort of 3e6 doubles)',
      "const a = Array.from({ length: 3e6 }, Math.random); console.log('c'); for (;;) a.sort()",
    ],
  ])(
    '%s: culprit timeout within timeoutMs + 1000 ms; neighbours exact',
    async (_, code) => {
      const v = await withNeighbours(code, '{ timeoutMs: 1500 }');
      const { ms, ...culprit } = v.culprit;
      expect(culprit).toEqual({
        stdout: 'c\n',
        stderr: '',
        exitCode: null,
        termination: 'timeout',
      });
      expect(ms).toBeGreaterThanOrEqual(1500);
      expect(ms).toBeLessThanOrEqual(1500 + 1000);
      expect(v.shared).toBe(1);
      expect(v.neighbours).toEqual(NEIGHBOURS);
      expect(v.next).toEqual(NEXT);
    },
    120_000,
  );
});

describe('host-side floods change a neighbour only by delay (I8)', () => {
  it.each([
    [
      'an output flood past a 1 KiB cap',
      "for (;;) process.stdout.write('x'.repeat(65536))",
      '{ timeoutMs: 2000, maxOutputBytes: 1024 }',
    ],
    [
      '20000 one-millisecond intervals',
      'for (let i = 0; i < 20000; i++) setInterval(() => {}, 1)',
      '{ timeoutMs: 3000 }',
    ],
  ])(
    '%s: the culprit ends, neighbours exact',
    async (_, code, options) => {
      const v = await withNeighbours(code, options);
      expect(v.culprit.exitCode).toBeNull();
      expect(['timeout', 'memory']).toContain(v.culprit.termination);
      expect(v.shared).toBe(1);
      expect(v.neighbours).toEqual(NEIGHBOURS);
      expect(v.next).toEqual(NEXT);
    },
    120_000,
  );
});

describe('a worker lost with no culprit (I5)', () => {
  it('killed once: the call reruns on a new worker and resolves exactly once', async () => {
    const { value } = await consumer(`
      const call = settle(runCode("console.log('x'); setTimeout(() => console.log('y'), 3000)", { timeoutMs: 20000 }));
      const first = await waitFor(() => children()[0], 5000);
      await sleep(500);
      kill(first);
      const second = await waitFor(() => children().find((p) => p !== first), 5000);
      out({ result: await call, moved: first !== second });`);
    expect(value).toEqual({ result: { stdout: 'x\ny\n', stderr: '', exitCode: 0 }, moved: true });
  });

  it('killed twice: the call rejects naming the signal, at once', async () => {
    const { value } = await consumer(`
      const call = settle(runCode("console.log('x'); setTimeout(() => console.log('y'), 5000)", { timeoutMs: 30000 }));
      const first = await waitFor(() => children()[0], 5000);
      await sleep(500);
      kill(first);
      const second = await waitFor(() => children().find((p) => p !== first), 5000);
      await sleep(500);
      const t0 = now();
      kill(second);
      const result = await call;
      out({ result, ms: now() - t0, next: await settle(runCode('console.log(6 * 7)')) });`);
    const v = value as { result: { rejected?: string }; ms: number; next: unknown };
    expect(v.result.rejected).toMatch(/isolate-host .*exited unexpectedly .*SIGKILL/);
    expect(v.ms).toBeLessThan(1000);
    expect(v.next).toEqual(NEXT);
  });

  it('two calls sharing a killed worker both resolve exactly', async () => {
    const { value } = await consumer(`
      const calls = [0, 1].map((i) => settle(runCode("console.log('x" + i + "'); setTimeout(() => console.log('y'), 2000)")));
      const first = await waitFor(() => children()[0], 5000);
      await sleep(500);
      const shared = children().length;
      kill(first);
      out({ shared, results: await Promise.all(calls) });`);
    expect(value).toEqual({
      shared: 1,
      results: [0, 1].map((i) => ({ stdout: `x${i}\ny\n`, stderr: '', exitCode: 0 })),
    });
  });
});
