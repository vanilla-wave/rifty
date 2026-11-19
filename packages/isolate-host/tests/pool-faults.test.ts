/**
 * Goal isolate-host-worker-pool, acceptance rows 5–8: a culprit on a shared
 * worker (memory, time, host-side floods) costs its neighbours nothing but
 * delay (I2, I3, I4); a worker lost with no culprit reruns its calls once,
 * inside their deadline, on a worker of their own (I5). Each scenario runs in
 * its own cold consumer process, so 4 concurrent calls share its one worker
 * (row 2 proves the packing).
 */
import { describe, expect, it } from 'vitest';
import { consumer } from './support.ts';

/** The acceptance carrier; RED was `it.fails` before the pool landed. */
const carrier = it;

interface Outcome {
  /** Children while all 4 calls are in flight: 1 = they share a worker. */
  shared: number;
  /** The shared worker's pid is gone 3 s after the last of its calls settled. */
  retired: boolean;
  culprit: Record<string, unknown> & { ms: number };
  neighbours: unknown[];
  next: unknown;
  /** A call placed 1200 ms after the culprit settled: its result, and whether a new worker took it. */
  probe: { result: unknown; newWorker: boolean };
}

/**
 * 3 neighbours (b<i> at 3.5 s, `neighbourOptions`), then the culprit, concurrently
 * on one cold worker; a probe call 1200 ms after the culprit settled, while the
 * neighbours still run; then one more call.
 */
async function withNeighbours(
  culprit: string,
  options: string,
  neighbourOptions = '{}',
  count = 3,
): Promise<Outcome> {
  const { value } = await consumer(
    `const neighbours = Array.from({ length: ${count} }, (_, i) =>
       settle(runCode("console.log('a" + i + "'); setTimeout(() => console.log('b" + i + "'), 3500)", ${neighbourOptions})));
     await sleep(300);
     const t0 = now();
     const running = settle(runCode(${JSON.stringify(culprit)}, ${options}));
     await sleep(150);
     const pids = children();
     const culprit = await running;
     const ms = now() - t0;
     await sleep(1200);
     const probing = settle(runCode("console.log('p')"));
     const newWorker = children().some((p) => !pids.includes(p));
     const probe = { result: await probing, newWorker };
     const results = await Promise.all(neighbours);
     const retired = await waitFor(() => (children().includes(pids[0]) ? undefined : true), 3000).catch(() => false);
     out({ shared: pids.length, retired, probe, culprit: { ...culprit, ms }, neighbours: results, next: await settle(runCode('console.log(6 * 7)')) });`,
    { timeoutMs: 90_000 },
  );
  return value as Outcome;
}

const neighbour = (i: number) => ({ stdout: `a${i}\nb${i}\n`, stderr: '', exitCode: 0 });
const NEIGHBOURS = [0, 1, 2].map(neighbour);
const NEXT = { stdout: '42\n', stderr: '', exitCode: 0 };
/** The rejection a consumer can retry on: a call lost with its worker (manager decision F1). */
const LOST = 'ERR_ISOLATE_HOST_WORKER_LOST';

describe('memory on a shared worker (I3)', () => {
  carrier(
    'a catastrophic allocation is the culprit alone; neighbours get their own result once',
    async () => {
      const v = await withNeighbours(
        "console.log('big'); new Array(2 ** 28).fill(0)",
        '{ memoryLimitMb: 64, timeoutMs: 60000 }',
      );
      const { ms: _ms, ...culprit } = v.culprit;
      expect(culprit).toEqual({
        stdout: 'big\n',
        stderr: '',
        exitCode: null,
        termination: 'memory',
      });
      expect(v.shared).toBe(1);
      expect(v.neighbours).toEqual(NEIGHBOURS);
      expect(v.next).toEqual(NEXT);
    },
    120_000,
  );

  carrier(
    'heap growth past the limit is the culprit alone',
    async () => {
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
    },
    120_000,
  );
});

describe('time on a shared worker (I4)', () => {
  carrier.each([
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
    async (label, code) => {
      // Neighbours (b at 3.5 s) at 5000 ms: a rerun after the worker's loss (≥ 1.8 s)
      // could not finish in time, so they must finish where they are. Two of them:
      // the shared worker keeps a free slot for the probe unless it retires.
      const v = await withNeighbours(code, '{ timeoutMs: 1500 }', '{ timeoutMs: 5000 }', 2);
      const { ms, ...culprit } = v.culprit;
      expect(culprit).toEqual({
        stdout: 'c\n',
        stderr: '',
        exitCode: null,
        termination: 'timeout',
      });
      // libuv fires timers on its cached loop time, up to ~1 ms behind performance.now().
      expect(ms).toBeGreaterThanOrEqual(1500 - 5);
      expect(ms).toBeLessThanOrEqual(1500 + 1000);
      expect(v.shared).toBe(1);
      expect(v.neighbours).toEqual(NEIGHBOURS.slice(0, 2));
      // A guest still running after termination retires its worker once the
      // neighbours are done (I4); `next` cannot have landed there.
      expect(v.probe.result).toEqual({ stdout: 'p\n', stderr: '', exitCode: 0 });
      if (label.startsWith('a builtin')) {
        // Retiring (stuck past 1000 ms): no new call goes there, and it dies after its neighbours.
        expect(v.probe.newWorker).toBe(true);
        expect(v.retired).toBe(true);
      } else {
        // Stopped by termination: its worker keeps serving.
        expect(v.probe.newWorker).toBe(false);
      }
      expect(v.next).toEqual(NEXT);
    },
    120_000,
  );
});

describe('host-side floods change a neighbour only by delay (I2)', () => {
  carrier.each([
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
  carrier('killed once: the call reruns on a new worker and resolves exactly once', async () => {
    const { value } = await consumer(`
      const call = settle(runCode("console.log('x'); setTimeout(() => console.log('y'), 5000)", { timeoutMs: 20000 }));
      const first = await waitFor(() => children()[0], 5000);
      // Late enough that attempt 1's 'x' has reached the consumer: a pool keeping it shows 'x' twice.
      await sleep(1500);
      kill(first);
      const second = await waitFor(() => children().find((p) => p !== first), 5000);
      const result = await call;
      // The reruns' worker ends once they are settled: no idle process per loss.
      const ended = await waitFor(() => (children().includes(second) ? undefined : true), 3000).catch(() => false);
      out({ result, moved: first !== second, ended });`);
    expect(value).not.toHaveProperty('harnessError');
    expect(value).toEqual({
      result: { stdout: 'x\ny\n', stderr: '', exitCode: 0 },
      moved: true,
      ended: true,
    });
  });

  carrier('killed twice: the call rejects naming the signal, at once', async () => {
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
    expect(value).not.toHaveProperty('harnessError');
    const v = value as { result: { rejected?: string; code?: string }; ms: number; next: unknown };
    expect(v.result.rejected).toMatch(/isolate-host .*exited unexpectedly .*SIGKILL/);
    expect(v.result.code).toBe(LOST);
    expect(v.ms).toBeLessThan(1000);
    expect(v.next).toEqual(NEXT);
  });

  carrier(
    'a rerun that cannot finish inside its original deadline rejects naming the lost worker, at the deadline',
    async () => {
      const { value } = await consumer(`
      const t0 = now();
      const call = settle(runCode("console.log('x'); setTimeout(() => console.log('y'), 3000)", { timeoutMs: 4000 }));
      const first = await waitFor(() => children()[0], 5000);
      await sleep(1500);
      kill(first);
      // The rerun is attempted (a new worker), not refused up front.
      await waitFor(() => children().find((p) => p !== first), 2000);
      const result = await call;
      out({ result, ms: now() - t0 });`);
      expect(value).not.toHaveProperty('harnessError');
      const v = value as { result: { rejected?: string; code?: string }; ms: number };
      expect(v.result.rejected).toMatch(/isolate-host .*exited unexpectedly .*SIGKILL/);
      expect(v.result.code).toBe(LOST);
      expect(v.ms).toBeGreaterThanOrEqual(4000 - 5);
      expect(v.ms).toBeLessThanOrEqual(4000 + 1000);
    },
  );

  carrier(
    "a fresh call is never placed with reruns: killing the reruns' worker rejects only them",
    async () => {
      const { value } = await consumer(`
      const suspect = settle(runCode("setTimeout(() => console.log('s'), 4000)", { timeoutMs: 20000 }));
      const first = await waitFor(() => children()[0], 5000);
      await sleep(500);
      kill(first);
      const quarantine = await waitFor(() => children().find((p) => p !== first), 5000);
      await sleep(300);
      const fresh = settle(runCode("setTimeout(() => console.log('f'), 2000)", { timeoutMs: 20000 }));
      await sleep(500);
      const workers = children().length;
      kill(quarantine);
      out({ suspect: await suspect, fresh: await fresh, workers });`);
      expect(value).not.toHaveProperty('harnessError');
      const v = value as { suspect: { code?: string }; fresh: unknown; workers: number };
      expect(v.workers).toBe(2);
      expect(v.suspect.code).toBe(LOST);
      expect(v.fresh).toEqual({ stdout: 'f\n', stderr: '', exitCode: 0 });
    },
  );

  carrier('each lost call reruns alone, never on a live worker with free slots', async () => {
    const { value } = await consumer(`
      const lost = [0, 1, 2, 3].map((i) => settle(runCode("setTimeout(() => console.log('s" + i + "'), 5000)", { timeoutMs: 20000 })));
      const first = await waitFor(() => children()[0], 5000);
      await sleep(300);
      const other = settle(runCode("setTimeout(() => console.log('o'), 4000)", { timeoutMs: 20000 }));
      const second = await waitFor(() => children().find((p) => p !== first), 5000);
      await sleep(1200);
      kill(first);
      // Four solo workers, one per lost call; the live worker with 3 free slots takes none.
      const solos = await waitFor(() => { const s = children().filter((p) => p !== first && p !== second); return s.length === 4 ? s : undefined; }, 5000);
      await sleep(300);
      // A solo's loss is its own call's: the other three still resolve.
      kill(solos[0]);
      const results = await Promise.all(lost);
      out({ codes: results.map((r) => r.code ?? r.stdout), other: await other });`);
    expect(value).not.toHaveProperty('harnessError');
    const v = value as { codes: string[]; other: unknown };
    expect(v.codes.filter((c) => c === LOST)).toHaveLength(1);
    expect(v.codes.filter((c) => c !== LOST).sort()).toHaveLength(3);
    for (const c of v.codes) if (c !== LOST) expect(c).toMatch(/^s[0-3]\n$/);
    expect(v.other).toEqual({ stdout: 'o\n', stderr: '', exitCode: 0 });
  });

  carrier(
    'a call placed as a second idle worker ends is not lost with it: it keeps its one rerun',
    async () => {
      const { value } = await consumer(`
      // W1 holds 4 calls that end last; W2 holds 1 that ends first. When W1 goes
      // idle it is the second idle worker and ends: the next call must not land there.
      const w1 = [0, 1, 2, 3].map(() => runCode("setTimeout(() => {}, 1200)"));
      await sleep(100);
      await runCode("setTimeout(() => {}, 200)");
      const call = Promise.all(w1).then(() =>
        settle(runCode("console.log('n'); setTimeout(() => console.log('m'), 3000)", { timeoutMs: 20000 })));
      await sleep(2000);
      // One loss for whatever runs it now: a call that already spent its rerun would reject.
      for (const pid of children()) kill(pid);
      out({ result: await call });`);
      expect(value).toEqual({ result: { stdout: 'n\nm\n', stderr: '', exitCode: 0 } });
    },
  );

  carrier('two calls sharing a killed worker both resolve exactly', async () => {
    const { value } = await consumer(`
      const calls = [0, 1].map((i) => settle(runCode("console.log('x" + i + "'); setTimeout(() => console.log('y'), 4000)")));
      const first = await waitFor(() => children()[0], 5000);
      await sleep(1500);
      const shared = children().length;
      kill(first);
      // Each rerun alone, on a worker of its own.
      const sampler = sampleChildren();
      const results = await Promise.all(calls);
      out({ shared, rerunWorkers: sampler.stop(), results });`);
    expect(value).toEqual({
      shared: 1,
      rerunWorkers: 2,
      results: [0, 1].map((i) => ({ stdout: `x${i}\ny\n`, stderr: '', exitCode: 0 })),
    });
  });
});

describe('bounded worker memory (I10)', () => {
  carrier(
    'a worker left holding a big call’s memory is recycled, never kept warm above 512 MiB',
    async () => {
      const { value } = await consumer(`
      await runCode('1');
      const warm = children();
      const big = await runCode("const a = []; for (let i = 0; i < 8e6; i++) a.push({ i, s: 'k' + i }); console.log(a.length)", { memoryLimitMb: 1536, timeoutMs: 60000 });
      await sleep(1000);
      const rssKb = (pid) => { try { return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) || null; } catch { return null; } };
      out({ warm, big, idleRssMb: children().map((p) => (rssKb(p) ?? 0) / 1024), next: await runCode('console.log(6 * 7)') });`);
      const v = value as { warm: number[]; big: unknown; idleRssMb: number[]; next: unknown };
      expect(v.warm).toHaveLength(1);
      expect(v.big).toEqual({ stdout: '8000000\n', stderr: '', exitCode: 0 });
      for (const mb of v.idleRssMb) expect(mb).toBeLessThanOrEqual(512);
      expect(v.next).toEqual(NEXT);
    },
    120_000,
  );
});

describe('guest memory outside the isolate heap: a solo rerun names the culprit (I2, I3)', () => {
  // Neighbours at memoryLimitMb 64: the shared worker's ceiling is 256 + 3 × 256 MiB.
  const SMALL = '{ memoryLimitMb: 64 }';
  carrier.each([
    [
      'WebAssembly.Memory with written pages',
      // 10 MiB more every 10 ms: slow enough to be seen sharing its worker first.
      'const m = new WebAssembly.Memory({ initial: 1, maximum: 65536 }); let k = 0; const step = () => { if (k++ >= 400) return; m.grow(160); const u = new Uint8Array(m.buffer); for (let i = 0; i < u.length; i += 4096) u[i] = 1; setTimeout(step, 10) }; step()',
    ],
    [
      'a resizable ArrayBuffer with written pages',
      'const b = new ArrayBuffer(0, { maxByteLength: 2 ** 34 }); let k = 0; const step = () => { if (k++ >= 400) return; b.resize(k * (10 << 20)); const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 4096) u[i] = 1; setTimeout(step, 10) }; step()',
    ],
    [
      'a growable SharedArrayBuffer with written pages',
      'const b = new SharedArrayBuffer(0, { maxByteLength: 2 ** 34 }); let k = 0; const step = () => { if (k++ >= 400) return; b.grow(k * (10 << 20)); const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 4096) u[i] = 1; setTimeout(step, 10) }; step()',
    ],
    [
      'an Intl flood (ICU memory)',
      'const a = []; for (let i = 0; i < 1e6; i++) a.push(new Intl.DateTimeFormat("en", { timeZone: "UTC" }))',
    ],
  ])(
    '%s: the culprit gets memory, neighbours their own result once',
    async (_, code) => {
      const v = await withNeighbours(code, '{ memoryLimitMb: 64, timeoutMs: 60000 }', SMALL);
      const { ms: _ms, ...culprit } = v.culprit;
      expect(culprit).toEqual({ stdout: '', stderr: '', exitCode: null, termination: 'memory' });
      expect(v.shared).toBe(1);
      expect(v.neighbours).toEqual(NEIGHBOURS);
      expect(v.next).toEqual(NEXT);
    },
    180_000,
  );

  carrier.each([
    [
      '262000 one-millisecond intervals',
      'for (let i = 0; i < 262000; i++) setInterval(() => {}, 1)',
    ],
  ])(
    '%s: the culprit gets memory (solo rerun), neighbours exact',
    async (_, code) => {
      const v = await withNeighbours(code, '{ memoryLimitMb: 64, timeoutMs: 20000 }', SMALL);
      const { ms: _ms, ...culprit } = v.culprit;
      expect(culprit).toEqual({ stdout: '', stderr: '', exitCode: null, termination: 'memory' });
      expect(v.shared).toBe(1);
      expect(v.neighbours).toEqual(NEIGHBOURS);
      expect(v.next).toEqual(NEXT);
    },
    180_000,
  );

  carrier(
    'large code is read linearly: 8 MiB runs, 40 MiB ends on its own, a neighbour is untouched',
    async () => {
      const { value } = await consumer(`
      const neighbour = settle(runCode("setTimeout(() => console.log('n'), 1500)"));
      await sleep(200);
      const eight = await settle(runCode("console.log(1)//" + 'x'.repeat(8 << 20)));
      const forty = await settle(runCode("console.log(1)//" + 'x'.repeat(40 << 20)));
      out({ eight, forty: { exitCode: forty.exitCode, rejected: forty.rejected }, neighbour: await neighbour });`);
      expect(value).toEqual({
        eight: { stdout: '1\n', stderr: '', exitCode: 0 },
        // 40 MiB is the guest's own failure (V8 refuses to compile it), never a lost worker.
        forty: { exitCode: 1 },
        neighbour: { stdout: 'n\n', stderr: '', exitCode: 0 },
      });
    },
    120_000,
  );
});

describe('a guest that never ends and churns host timers (I2, I4)', () => {
  carrier(
    'intervals created and cleared in a loop: its own end (timeout as Node, or memory alone), neighbours exact',
    async () => {
      const v = await withNeighbours(
        'for (;;) { const t = []; for (let i = 0; i < 4096; i++) t.push(setInterval(() => {}, 1)); t.forEach(clearInterval) }',
        // Its memory grows slowly: lost late on the shared worker, its solo rerun needs
        // budget left (F1) to meet its own end.
        '{ memoryLimitMb: 64, timeoutMs: 60000 }',
        '{ memoryLimitMb: 64 }',
      );
      // Node runs it forever: `timeout` is faithful; `memory` is its own exhaustion, met alone.
      expect(v.culprit.exitCode).toBeNull();
      expect(['timeout', 'memory']).toContain(v.culprit.termination);
      expect(v.culprit).not.toHaveProperty('rejected');
      expect(v.shared).toBe(1);
      expect(v.neighbours).toEqual(NEIGHBOURS);
      expect(v.next).toEqual(NEXT);
    },
    180_000,
  );
});

describe('a mass loss costs at most a process per call (I5)', () => {
  carrier(
    '8 calls on 2 workers, both killed: at most 8 rerun processes, every call exact',
    async () => {
      const { value } = await consumer(`
      const calls = Array.from({ length: 8 }, (_, i) => settle(runCode("console.log('a" + i + "'); setTimeout(() => console.log('b'), 3000)", { timeoutMs: 20000 })));
      const pair = await waitFor(() => { const c = children(); return c.length === 2 ? c : undefined; }, 15000);
      await sleep(1000);
      const sampler = sampleChildren();
      for (const pid of pair) kill(pid);
      const results = await Promise.all(calls);
      out({ peak: sampler.stop(), results });`);
      const v = value as { peak: number; results: unknown[] };
      expect(v.results).toEqual(
        Array.from({ length: 8 }, (_, i) => ({ stdout: `a${i}\nb\n`, stderr: '', exitCode: 0 })),
      );
      expect(v.peak).toBeLessThanOrEqual(8);
    },
  );
});

describe('a failing spawn during a rerun never takes the consumer down (I5)', () => {
  carrier(
    'spawn throws synchronously for the rerun: the call rejects LOST, the consumer lives',
    async () => {
      const { value, exitCode } = await consumer(`
      const call = settle(runCode("setTimeout(() => console.log('y'), 3000)", { timeoutMs: 20000 }));
      const first = await waitFor(() => children()[0], 5000);
      await sleep(500);
      // A path with a NUL byte makes child_process.spawn throw synchronously (ERR_INVALID_ARG_VALUE).
      const execPath = process.execPath;
      process.execPath = execPath + '\\0';
      kill(first);
      const result = await call;
      process.execPath = execPath;
      out({ result, next: await settle(runCode('console.log(6 * 7)')) });`);
      expect(exitCode).toBe(0);
      const v = value as { result: { code?: string }; next: unknown };
      expect(v.result.code).toBe(LOST);
      expect(v.next).toEqual(NEXT);
    },
  );
});

describe('slots and ceilings of a shared worker (I1, I3)', () => {
  carrier(
    'a cancelled call still running keeps its slot: a 5th call starts another worker',
    async () => {
      const { value } = await consumer(`
      // 3 s: the array is built and the uninterruptible sort running at the deadline, even under load.
      const stuck = settle(runCode("const a = Array.from({ length: 3e6 }, Math.random); console.log('c'); for (;;) a.sort()", { timeoutMs: 3000 }));
      const three = [0, 1, 2].map(() => runCode("setTimeout(() => {}, 6000)", { timeoutMs: 20000 }));
      const culprit = await stuck;
      // Inside the 1 s grace: the stuck isolate is still on its worker.
      const before = children();
      const fifth = await runCode("console.log('5')");
      out({ culprit: culprit.stdout, before, during: children().length, fifth });
      await Promise.all(three);`);
      const v = value as { culprit: string; before: number[]; during: number; fifth: unknown };
      // Precondition: the sort had started, so its isolate is still running after the cancel.
      expect(v.culprit).toBe('c\n');
      expect(v.before).toHaveLength(1);
      expect(v.during).toBe(2);
      expect(v.fifth).toEqual({ stdout: '5\n', stderr: '', exitCode: 0 });
    },
  );

  carrier(
    'memory retained from finished calls never lands on the last call left on the worker',
    async () => {
      const { value } = await consumer(`
      // Three calls leave ~1.5 GiB of small-object heap resident when they end (macOS);
      // the fourth, at memoryLimitMb 64, is then alone on the worker with that RSS.
      const sampler = sampleChildren();
      const heavy = "const a = []; for (let i = 0; i < 8e6; i++) a.push({ i, s: 'k' + i }); console.log(a.length)";
      const calls = [0, 1, 2].map(() => settle(runCode(heavy, { memoryLimitMb: 1536, timeoutMs: 60000 })));
      calls.push(settle(runCode("setTimeout(() => console.log('light'), 6000)", { memoryLimitMb: 64, timeoutMs: 60000 })));
      const worker = await waitFor(() => children()[0], 5000);
      // Well after the heavy calls ended, before the light one does: still its first worker.
      await sleep(4500);
      const survived = children().includes(worker);
      const results = await Promise.all(calls);
      out({ results, peak: sampler.stop(), survived });`);
      expect(value).toEqual({
        results: [
          ...[0, 1, 2].map(() => ({ stdout: '8000000\n', stderr: '', exitCode: 0 })),
          { stdout: 'light\n', stderr: '', exitCode: 0 },
        ],
        peak: 1,
        survived: true,
      });
    },
    120_000,
  );

  carrier(
    'the RSS ceiling sums its calls: 4 calls each holding most of their own limit complete on their worker',
    async () => {
      const { value } = await consumer(`
      // 4 × 500 MiB resident at memoryLimitMb 600: over 256 + 3 × 600 (one call's
      // allowance), under 256 + 3 × 2400 (their sum). A ceiling of one call's
      // allowance would lose the worker and rerun all four alone.
      const sampler = sampleChildren();
      const code = "const b = new Uint8Array(500 << 20).fill(1); setTimeout(() => console.log(b[123]), 1500)";
      const results = await Promise.all([0, 1, 2, 3].map(() => settle(runCode(code, { memoryLimitMb: 600, timeoutMs: 30000 }))));
      out({ results, peak: sampler.stop() });`);
      expect(value).toEqual({
        results: [0, 1, 2, 3].map(() => ({ stdout: '1\n', stderr: '', exitCode: 0 })),
        peak: 1,
      });
    },
    120_000,
  );
});
