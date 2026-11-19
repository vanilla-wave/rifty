/**
 * Goal isolate-host-worker-pool, acceptance rows 1–4 (I1 shared warm workers,
 * I2 freshness inside a worker, I6 lifecycle). Each scenario runs in its own
 * consumer process over the built package: its child pids are its workers.
 */
import { describe, expect, it } from 'vitest';
import { alive, consumer, waitFor } from './support.ts';

/** The acceptance carrier; RED was `it.fails` before the pool landed. */
const carrier = it;

const ok = (stdout: string) => ({ stdout, stderr: '', exitCode: 0 });

describe('shared warm workers (I1)', () => {
  carrier('a worker outlives its call and serves the next sequential calls', async () => {
    const { value } = await consumer(`
      await runCode('1');
      const warm = children();
      const results = [];
      for (let i = 0; i < 5; i++) results.push(await runCode('console.log(' + i + ')'));
      out({ warm, after: children(), results });`);
    const v = value as { warm: number[]; after: number[]; results: unknown[] };
    expect(v.warm).toHaveLength(1);
    expect(v.after).toEqual(v.warm);
    expect(v.results).toEqual([0, 1, 2, 3, 4].map((i) => ok(`${i}\n`)));
  });

  carrier.each([
    [4, 1],
    [5, 2],
    [8, 2],
  ])('%i concurrent calls from a cold consumer run in %i worker(s)', async (n, workers) => {
    const { value } = await consumer(`
      const sampler = sampleChildren();
      const results = await Promise.all(Array.from({ length: ${n} }, (_, i) =>
        runCode('setTimeout(() => console.log(' + i + '), 1000)')));
      const peak = sampler.stop();
      // One idle worker stays warm; a second idle one ends.
      const settled = await waitFor(() => (children().length === 1 ? true : undefined), 3000).catch(() => false);
      out({ peak, results, settled });`);
    const v = value as { peak: number; results: unknown[]; settled: boolean };
    expect(v.results).toEqual(Array.from({ length: n }, (_, i) => ok(`${i}\n`)));
    expect(v.peak).toBe(workers);
    expect(v.settled).toBe(true);
  });
});

describe('freshness inside a worker (I2)', () => {
  carrier(
    '4 concurrent calls on one worker see only their own files, globals, timers and output',
    async () => {
      const { value } = await consumer(`
      const sampler = sampleChildren();
      const code = (i) => [
        "const fs = require('fs');",
        "fs.writeFileSync('f', '" + i + "'); globalThis.mine = " + i + ";",
        "for (let k = 0; k < 200; k++) setTimeout(() => console.log('t" + i + "-' + k), k % 7);",
        "setTimeout(() => console.log('end', fs.readFileSync('f', 'utf8'), globalThis.mine, fs.readdirSync('.').join()), 300);",
      ].join('\\n');
      const results = await Promise.all([0, 1, 2, 3].map((i) => runCode(code(i))));
      out({ peak: sampler.stop(), results });`);
      const v = value as {
        peak: number;
        results: { stdout: string; stderr: string; exitCode: number }[];
      };
      expect(v.peak).toBe(1);
      v.results.forEach((r, i) => {
        const lines = r.stdout.trimEnd().split('\n');
        expect(lines.at(-1)).toBe(`end ${i} ${i} f`);
        expect(lines.slice(0, -1).sort()).toEqual(
          Array.from({ length: 200 }, (_, k) => `t${i}-${k}`).sort(),
        );
        expect(r.stderr).toBe('');
        expect(r.exitCode).toBe(0);
      });
    },
  );

  carrier(
    "a call's pending timer and unsettled promise neither act in nor show to the next call on the same worker",
    async () => {
      const { value } = await consumer(`
      const first = await runCode([
        "require('fs').writeFileSync('state.txt', 'x'); globalThis.leaked = 1;",
        "setTimeout(() => console.log('LATE-T'), 150);",
        "new Promise((r) => setTimeout(r, 200)).then(() => console.log('LATE-P'));",
        "console.log('first'); process.exit(0)",
      ].join('\\n'));
      const pid = children();
      const second = await runCode(
        "setTimeout(() => console.log(require('fs').existsSync('state.txt'), typeof globalThis.leaked), 600)");
      out({ first, second, pid, after: children() });`);
      const v = value as { first: unknown; second: unknown; pid: number[]; after: number[] };
      expect(v.first).toEqual(ok('first\n'));
      expect(v.second).toEqual(ok('false undefined\n'));
      // The same worker served both calls: the property is about a shared process.
      expect(v.pid).toHaveLength(1);
      expect(v.after).toEqual(v.pid);
    },
  );
});

describe('worker lifecycle (I6)', () => {
  carrier('an idle worker does not keep the consumer alive, and does not outlive it', async () => {
    const { value, exitCode, signal, ms } = await consumer(
      `await runCode('console.log(1)'); out({ workers: children() });`,
      { naturalExit: true, timeoutMs: 20_000 },
    );
    const { workers } = value as { workers: number[] };
    expect(workers).toHaveLength(1);
    expect({ exitCode, signal }).toEqual({ exitCode: 0, signal: null });
    expect(ms).toBeLessThan(5000);
    await waitFor(() => (alive(workers[0] as number) ? undefined : true), 3000);
  });

  carrier('a consumer SIGKILLed with an idle worker leaves no worker behind', async () => {
    const running = consumer(
      `await runCode('console.log(1)'); await new Promise((r) => process.stdout.write('\\n' + JSON.stringify({ value: children() }) + '\\n', r)); kill(process.pid); await sleep(60000);`,
    );
    const { value, signal } = await running;
    const workers = value as number[];
    expect(signal).toBe('SIGKILL');
    expect(workers).toHaveLength(1);
    await waitFor(() => (alive(workers[0] as number) ? undefined : true), 3000);
  });

  carrier(
    'a consumer SIGKILLed while its worker is stuck in a builtin that ignores termination leaves no worker behind',
    async () => {
      const { value, signal } = await consumer(
        `runCode("const a = Array.from({ length: 3e6 }, Math.random); for (;;) a.sort()", { timeoutMs: 1000 }).catch(() => {});
       // A neighbour keeps the retiring worker alive with its stuck isolate.
       runCode("setTimeout(() => {}, 20000)", { timeoutMs: 30000 }).catch(() => {});
       await sleep(2500);
       await new Promise((r) => process.stdout.write('\\n' + JSON.stringify({ value: children() }) + '\\n', r));
       kill(process.pid); await sleep(60000);`,
      );
      const workers = value as number[];
      expect(signal).toBe('SIGKILL');
      expect(workers.length).toBeGreaterThan(0);
      for (const pid of workers) await waitFor(() => (alive(pid) ? undefined : true), 3000);
    },
  );
});
