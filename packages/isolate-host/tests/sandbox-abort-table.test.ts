/**
 * Cancelling a run with an `AbortSignal` as a table, like destroy's
 * (`sandbox-destroy-table.test.ts`, ADR-0568 §5): every abort moment × every end
 * of the run — what the caller got (exactly one outcome), the files after it
 * (the killed-run rule for an abort: those of before the run), the sandbox still
 * usable, and no isolate of it left running, observed on the workers' CPU.
 */
import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.ts';
import { type CallHandle, type CallSpec, sharedPool } from '../src/pool.ts';
import { burnedAfter, childPids, cpu, killRunning } from './support.ts';

interface Sandbox {
  writeFile(path: string, data: string | Uint8Array, options?: object): Promise<void>;
  readFile(path: string, options?: object): Promise<Uint8Array>;
  list(path?: string, options?: object): Promise<{ name: string }[]>;
  remove(path: string, options?: object): Promise<void>;
  snapshot(options?: object): Promise<Uint8Array>;
  exec(path: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  destroy(): Promise<void>;
}
const createSandbox = (options?: Record<string, unknown>): Promise<Sandbox> =>
  (pkg as unknown as { createSandbox: (o?: unknown) => Promise<Sandbox> }).createSandbox(options);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const names = async (sb: Sandbox) => (await sb.list()).map((e) => e.name);
const outcomeOf = (op: Promise<unknown>): Promise<{ value?: unknown; rejected?: string }> =>
  op.then(
    (value) => ({ value }),
    (e: { code?: string }) => ({ rejected: e.code }),
  );
const ABORTED = 'ABORT_ERR';
const DESTROYED = 'ERR_ISOLATE_HOST_SANDBOX_DESTROYED';
/** The sandbox's files before every run of the table. */
const BEFORE = ['keep.txt', 'ok.js', 'r.js'];

/**
 * Exactly one outcome per operation: `settledFirst` = the op's promise had settled
 * before `abort()` was called (its reaction, registered at the call, ran before a
 * microtask queued at the abort) → its own outcome; else `AbortError`.
 */
function referee(controller: AbortController) {
  let called = false;
  let marked = false;
  let settledFirst: boolean | undefined;
  return {
    watch(op: Promise<unknown>): void {
      const done = () => {
        settledFirst = !called || !marked;
      };
      op.then(done, done);
    },
    abort(reason?: unknown): void {
      called = true;
      queueMicrotask(() => {
        marked = true;
      });
      controller.abort(reason);
    },
    get settledFirst(): boolean | undefined {
      return settledFirst;
    },
  };
}

/** After a run: the sandbox takes the next one, then nothing of it runs once destroyed. */
async function usableThenGone(sb: Sandbox): Promise<void> {
  expect(await sb.exec('ok.js')).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  await sb.destroy();
  expect(await burnedAfter(500)).toBeLessThan(0.1);
}

async function sandboxWith(code: string, extra?: Uint8Array): Promise<Sandbox> {
  const sb = await createSandbox({ maxFsBytes: extra === undefined ? 128 << 10 : 64 << 20 });
  await sb.writeFile('keep.txt', extra ?? 'k');
  await sb.writeFile('ok.js', '');
  await sb.writeFile('r.js', code);
  return sb;
}

/** A first sort of 3e6 doubles runs seconds and ignores termination (ADR-0563 §4). */
const SORT = 'const a = Array.from({ length: 3e6 }, () => Math.random()); a.sort();';
const WRITE = "require('fs').writeFileSync('out', '1');";

describe('an abort before the run has a result: AbortError at once, files of before, the isolate stopped', () => {
  interface Before {
    readonly code: string;
    readonly options?: Record<string, unknown>;
    /** A state large enough that restoring it takes a while. */
    readonly state?: Uint8Array;
    /** Abort, given the exec just called, its pool call (once placed) and the signal's controller. */
    readonly abort: (abort: () => void, placed: Promise<void>) => Promise<void>;
    /** Its isolate ignores termination: the worker retires after the stuck grace instead. */
    readonly stuck?: true;
  }
  const ROWS: Readonly<Record<string, Before>> = {
    // Two kills: the first loses the run's worker, the second its rerun — aborted in between.
    'in its rerun after a lost worker': {
      code: `${WRITE} for (;;) {}`,
      options: { timeoutMs: 20_000 },
      abort: async (abort) => {
        await sleep(300);
        await killRunning(1);
        await sleep(300);
        abort();
      },
    },
    'during restore (aborted as the call is placed, a 24 MiB state)': {
      code: `${WRITE} for (;;) {}`,
      state: new Uint8Array(24 << 20).fill(7),
      abort: async (abort, placed) => {
        await placed;
        abort();
      },
    },
    'during the run (an endless loop)': {
      code: `${WRITE} for (;;) {}`,
      abort: async (abort) => {
        await sleep(300);
        abort();
      },
    },
    // The capture runs in the guest's realm (ADR-0568 §7): an intrinsic it uses spins forever.
    'during the capture (an endless replaced intrinsic)': {
      code: `${WRITE} DataView.prototype.setUint32 = function () { for (;;) {} };`,
      abort: async (abort) => {
        await sleep(300);
        abort();
      },
    },
    'during the run of a builtin that ignores termination': {
      code: `${WRITE} ${SORT}`,
      abort: async (abort) => {
        await sleep(300);
        abort();
      },
      stuck: true,
    },
  };
  for (const [name, row] of Object.entries(ROWS))
    it(name, async () => {
      const sb = await sandboxWith(row.code, row.state);
      const pool = sharedPool();
      const run = pool.run;
      let place: () => void = () => {};
      const placed = new Promise<void>((r) => {
        place = r;
      });
      pool.run = (spec: CallSpec, onStart?: (h: CallHandle) => void) => {
        const result = run.call(pool, spec, onStart);
        place();
        return result;
      };
      try {
        const controller = new AbortController();
        const reason = new Error('turn over');
        let at = 0;
        const exec = sb.exec('r.js', { ...row.options, signal: controller.signal }).then(
          (value) => ({ value, ms: performance.now() - at }),
          (error: { code?: string; cause?: unknown }) => ({ error, ms: performance.now() - at }),
        );
        await row.abort(() => {
          at = performance.now();
          controller.abort(reason);
        }, placed);
        const outcome = await exec;
        expect(outcome).toMatchObject({ error: { code: ABORTED, cause: reason } });
        expect(outcome.ms).toBeLessThan(50);
        // Cancelled, not left to the stuck grace (1 s): stopped well before it.
        if (!row.stuck) {
          await sleep(100);
          expect(await burnedAfter(400)).toBeLessThan(0.1);
        }
        expect(await names(sb)).toEqual(BEFORE);
        await usableThenGone(sb);
      } finally {
        pool.run = run;
      }
    });

  it('its worker lost, the rerun not yet placed: the rerun is never placed', async () => {
    const sb = await sandboxWith(`${WRITE} for (;;) {}`);
    const controller = new AbortController();
    const exec = outcomeOf(sb.exec('r.js', { timeoutMs: 20_000, signal: controller.signal }));
    await sleep(300);
    const before = new Map(childPids().map((p) => [p, cpu(p) ?? 0]));
    await sleep(100);
    const busy = [...before].find(([p, c]) => (cpu(p) ?? c) - c > 0.02)?.[0];
    expect(busy).toBeDefined();
    // The loss is judged at the worker's 'close', later: the abort comes first.
    process.kill(busy as number, 'SIGKILL');
    controller.abort();
    expect(await exec).toEqual({ rejected: ABORTED });
    await sleep(300);
    expect(childPids().filter((p) => !before.has(p))).toEqual([]);
    expect(await burnedAfter(400)).toBeLessThan(0.1);
    expect(await names(sb)).toEqual(BEFORE);
    await usableThenGone(sb);
  });

  it('queued behind another run: it never starts', async () => {
    const sb = await sandboxWith(`${WRITE} for (;;) {}`);
    await sb.writeFile('first.js', 'const t = Date.now(); while (Date.now() - t < 500) {}');
    const pool = sharedPool();
    const run = pool.run;
    let calls = 0;
    pool.run = (spec: CallSpec, onStart?: (h: CallHandle) => void) => {
      calls++;
      return run.call(pool, spec, onStart);
    };
    try {
      const first = sb.exec('first.js');
      const controller = new AbortController();
      const exec = outcomeOf(sb.exec('r.js', { signal: controller.signal }));
      await sleep(100);
      controller.abort();
      expect(await exec).toEqual({ rejected: ABORTED });
      expect(await first).toMatchObject({ exitCode: 0 });
      expect(calls).toBe(1);
      expect(await names(sb)).toEqual(['first.js', ...BEFORE]);
      await usableThenGone(sb);
    } finally {
      pool.run = run;
    }
  });

  it('before the call: no pool call', async () => {
    const sb = await sandboxWith(`${WRITE} for (;;) {}`);
    const pool = sharedPool();
    const run = pool.run;
    let calls = 0;
    pool.run = (spec: CallSpec, onStart?: (h: CallHandle) => void) => {
      calls++;
      return run.call(pool, spec, onStart);
    };
    try {
      expect(await outcomeOf(sb.exec('r.js', { signal: AbortSignal.abort() }))).toEqual({
        rejected: ABORTED,
      });
      expect(calls).toBe(0);
      expect(await names(sb)).toEqual(BEFORE);
      await usableThenGone(sb);
    } finally {
      pool.run = run;
    }
  });
});

interface End {
  readonly code: string;
  readonly options: Record<string, unknown>;
  /** Its own outcome, and the files after it. */
  readonly own: Record<string, unknown>;
  readonly files: readonly string[];
  /** Kill each worker the run lands on, this many times (a lost worker, then its rerun). */
  readonly kills?: number;
}
const ENDS: Readonly<Record<string, End>> = {
  exit: {
    code: `${WRITE} setTimeout(() => {}, 200)`,
    options: {},
    own: { value: { stdout: '', stderr: '', exitCode: 0 } },
    files: ['keep.txt', 'ok.js', 'out', 'r.js'],
  },
  timeout: {
    code: `${WRITE} ${SORT}`,
    options: { timeoutMs: 800 },
    own: { value: { exitCode: null, termination: 'timeout' } },
    files: BEFORE,
  },
  memory: {
    code: `${WRITE} ${SORT}`,
    options: { memoryLimitMb: 64 },
    own: { value: { exitCode: null, termination: 'memory' } },
    files: BEFORE,
  },
  'refused state': {
    code: `${WRITE} require('fs').writeFileSync('big', Buffer.alloc(200 << 10))`,
    options: {},
    own: { value: { exitCode: 0, stateRefused: 'ERR_FS_SNAPSHOT_TOO_LARGE' } },
    files: BEFORE,
  },
  'lost worker': {
    code: `${WRITE} ${SORT}`,
    options: { timeoutMs: 20_000 },
    own: { rejected: 'ERR_ISOLATE_HOST_WORKER_LOST' },
    files: BEFORE,
    kills: 2,
  },
};
/** Microtasks after the pool's result (0: in its first reaction), or after `await exec`. */
const MOMENTS = [0, 1, 2, 3, 'after await'] as const;

describe('an abort around the result: one outcome, files per the outcome reported', () => {
  for (const [name, end] of Object.entries(ENDS))
    for (const moment of MOMENTS)
      it(`${name} × abort ${typeof moment === 'number' ? `${moment} microtask(s) after the result` : moment}`, async () => {
        const sb = await sandboxWith(end.code);
        const pool = sharedPool();
        const run = pool.run;
        const controller = new AbortController();
        const ref = referee(controller);
        if (typeof moment === 'number') {
          const at = () => {
            let p = Promise.resolve();
            for (let i = 1; i < moment; i++) p = p.then(() => {});
            if (moment === 0) ref.abort();
            else void p.then(() => ref.abort());
          };
          pool.run = (spec: CallSpec, onStart?: (h: CallHandle) => void) => {
            const result = run.call(pool, spec, onStart);
            result.then(at, at);
            return result;
          };
        }
        try {
          const raw = sb.exec('r.js', { ...end.options, signal: controller.signal });
          ref.watch(raw);
          const exec = outcomeOf(raw);
          if (end.kills !== undefined) await killRunning(end.kills);
          const outcome = await exec;
          if (moment === 'after await') ref.abort();
          await sleep(0);
          const aborted = outcome.rejected === ABORTED;
          expect(aborted, JSON.stringify(outcome)).toBe(!ref.settledFirst);
          if (!aborted) expect(outcome).toMatchObject(end.own);
          expect(await names(sb), JSON.stringify(outcome)).toEqual(aborted ? BEFORE : end.files);
          await usableThenGone(sb);
        } finally {
          pool.run = run;
        }
      });
});

describe('abort × destroy, either order: every operation settles once, DESTROYED for those unsettled at destroy()', () => {
  it('abort, then destroy', async () => {
    const sb = await sandboxWith(`${WRITE} for (;;) {}`);
    const controller = new AbortController();
    const run = outcomeOf(sb.exec('r.js', { signal: controller.signal }));
    const write = outcomeOf(sb.writeFile('w', 'x'));
    const queued = outcomeOf(sb.exec('r.js', { signal: new AbortController().signal }));
    await sleep(300);
    controller.abort();
    const destroying = sb.destroy();
    expect(await Promise.all([run, write, queued])).toEqual([
      { rejected: ABORTED },
      { rejected: DESTROYED },
      { rejected: DESTROYED },
    ]);
    await destroying;
    expect(await burnedAfter(500)).toBeLessThan(0.1);
  });
  // Safety row: DESTROYED is what an operation unsettled at destroy() got before the signal existed.
  it('destroy, then abort', async () => {
    const sb = await sandboxWith(`${WRITE} for (;;) {}`);
    const controller = new AbortController();
    const run = outcomeOf(sb.exec('r.js', { signal: controller.signal }));
    const queued = outcomeOf(sb.writeFile('w', 'x', { signal: controller.signal }));
    await sleep(300);
    const destroying = sb.destroy();
    controller.abort();
    expect(await Promise.all([run, queued])).toEqual([
      { rejected: DESTROYED },
      { rejected: DESTROYED },
    ]);
    await destroying;
    expect(await burnedAfter(500)).toBeLessThan(0.1);
  });
});

/** A host op aborted k microtasks after its call: AbortError and no effect, or its own result with it. */
const HOST_OPS: Readonly<
  Record<string, { op: (sb: Sandbox, signal: AbortSignal) => Promise<unknown>; effect: string[] }>
> = {
  writeFile: { op: (sb, signal) => sb.writeFile('w', 'x', { signal }), effect: ['f', 'g', 'w'] },
  readFile: { op: (sb, signal) => sb.readFile('f', { signal }), effect: ['f', 'g'] },
  list: { op: (sb, signal) => sb.list(undefined, { signal }), effect: ['f', 'g'] },
  remove: { op: (sb, signal) => sb.remove('g', { signal }), effect: ['f'] },
  snapshot: { op: (sb, signal) => sb.snapshot({ signal }), effect: ['f', 'g'] },
};
describe('every host op × abort 0–5 microtasks after its call: AbortError unless it had started', () => {
  for (const [name, { op, effect }] of Object.entries(HOST_OPS))
    for (const k of [0, 1, 2, 3, 4, 5])
      it(`${name} × abort ${k} microtask(s) after the call`, async () => {
        const sb = await createSandbox();
        try {
          await sb.writeFile('f', 'data');
          await sb.writeFile('g', 'gone');
          const controller = new AbortController();
          const call = outcomeOf(op(sb, controller.signal));
          if (k === 0) controller.abort();
          else {
            let p = Promise.resolve();
            for (let i = 1; i < k; i++) p = p.then(() => {});
            void p.then(() => controller.abort());
          }
          const outcome = await call;
          // In the call's own tick it cannot have started (it waits its turn).
          if (k === 0) expect(outcome).toEqual({ rejected: ABORTED });
          const aborted = outcome.rejected === ABORTED;
          if (!aborted) expect(outcome.rejected, JSON.stringify(outcome)).toBeUndefined();
          expect(await names(sb), JSON.stringify(outcome)).toEqual(aborted ? ['f', 'g'] : effect);
        } finally {
          await sb.destroy();
        }
      });
});
