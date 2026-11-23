/**
 * I5 as a table (ADR-0568 §5, review round 3): after `destroy()` returns, no
 * isolate of the sandbox is left running — on every end of its run and at
 * every moment the destroy can land, the microtasks around the run's result
 * included. Observed on the workers themselves: none of this process's
 * workers burns CPU after the return (a worker that dies inside the window
 * keeps its last reading, never a free zero).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.ts';
import { type CallHandle, type CallSpec, sharedPool } from '../src/pool.ts';
import { childPids } from './support.ts';

interface Sandbox {
  writeFile(path: string, data: string): Promise<void>;
  exec(path: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  destroy(): Promise<void>;
}
const createSandbox = (options?: Record<string, unknown>): Promise<Sandbox> =>
  (pkg as unknown as { createSandbox: (o?: unknown) => Promise<Sandbox> }).createSandbox(options);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** CPU seconds of a live process; `undefined` once it is gone. */
function cpu(pid: number): number | undefined {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return (Number(f[11]) + Number(f[12])) / 100;
    }
    const t = execFileSync('ps', ['-o', 'time=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return t.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
  } catch {
    return undefined;
  }
}

/** The most CPU any worker of this process burns over `ms` from now. */
async function burnedAfter(ms: number): Promise<number> {
  const first = new Map<number, number>();
  const last = new Map<number, number>();
  for (const pid of childPids()) {
    const c = cpu(pid);
    if (c === undefined) continue;
    first.set(pid, c);
    last.set(pid, c);
  }
  for (const end = Date.now() + ms; Date.now() < end; ) {
    await sleep(25);
    for (const pid of first.keys()) {
      const c = cpu(pid);
      if (c !== undefined) last.set(pid, c);
    }
  }
  return Math.max(0, ...[...first].map(([pid, c]) => (last.get(pid) ?? c) - c));
}

/** A first sort of 3e6 doubles runs seconds and ignores termination (ADR-0563 §4). */
const SORT = 'const a = Array.from({ length: 3e6 }, () => Math.random()); a.sort();';
interface End {
  readonly code: string;
  readonly options: Record<string, unknown>;
  /** Kill each worker the run lands on, this many times (a lost worker, then its rerun). */
  readonly kills?: number;
}
const ENDS: Readonly<Record<string, End>> = {
  exit: { code: 'setTimeout(() => {}, 200)', options: {} },
  timeout: { code: SORT, options: { timeoutMs: 800 } },
  // Its heap limit disposes the isolate inside the sort: reported while it still runs.
  memory: { code: SORT, options: { memoryLimitMb: 64 } },
  catastrophic: { code: 'new Array(2 ** 28).fill(0)', options: { memoryLimitMb: 64 } },
  'refused state': {
    code: "require('fs').writeFileSync('big', Buffer.alloc(200 << 10))",
    options: {},
  },
  'worker lost': { code: SORT, options: { timeoutMs: 20_000 }, kills: 2 },
};
/** Microtasks after the pool's result (0: in its first reaction), or after `await exec`. */
const MOMENTS = [0, 1, 2, 3, 'after await'] as const;

/** Kill whichever worker is computing, `times` times (each kill loses the run's worker). */
async function killRunning(times: number): Promise<void> {
  let before = new Map(childPids().map((p) => [p, cpu(p) ?? 0]));
  for (let killed = 0; killed < times; ) {
    await sleep(50);
    const now = new Map(childPids().map((p) => [p, cpu(p) ?? 0]));
    for (const [pid, c] of now) {
      if (c - (before.get(pid) ?? c) > 0.02 && killed < times) {
        process.kill(pid, 'SIGKILL');
        killed++;
      }
    }
    before = now;
  }
}

async function destroyAt(
  end: End,
  moment: (typeof MOMENTS)[number] | 'before start' | 'in flight',
) {
  const sb = await createSandbox({ maxFsBytes: 128 << 10 });
  await sb.writeFile('r.js', end.code);
  const pool = sharedPool();
  const run = pool.run;
  let destroying: Promise<void> | undefined;
  if (typeof moment === 'number') {
    const at = () => {
      if (moment === 0) {
        destroying = sb.destroy();
        return;
      }
      let p = Promise.resolve();
      for (let i = 1; i < moment; i++) p = p.then(() => {});
      void p.then(() => {
        destroying = sb.destroy();
      });
    };
    pool.run = (spec: CallSpec, onStart?: (h: CallHandle) => void) => {
      const result = run.call(pool, spec, onStart);
      result.then(at, at);
      return result;
    };
  }
  try {
    const exec = sb.exec('r.js', end.options).then(
      (r) => r,
      (e: { code?: string }) => ({ rejected: e.code }),
    );
    if (moment === 'before start') destroying = sb.destroy();
    if (moment === 'in flight') {
      await sleep(300);
      destroying = sb.destroy();
    }
    if (end.kills !== undefined) await killRunning(end.kills);
    const outcome = await exec;
    if (moment === 'after await') destroying = sb.destroy();
    await destroying;
    const burned = await burnedAfter(500);
    return { outcome, burned };
  } finally {
    pool.run = run;
  }
}

describe('after destroy() no isolate of the sandbox runs: every end × every moment (I5)', () => {
  it('before the run starts: it never runs', async () => {
    const { outcome, burned } = await destroyAt(ENDS.timeout as End, 'before start');
    expect(outcome).toEqual({ rejected: 'ERR_ISOLATE_HOST_SANDBOX_DESTROYED' });
    expect(burned).toBeLessThan(0.1);
  });
  it('in flight: the run is cancelled and stopped', async () => {
    const { outcome, burned } = await destroyAt(ENDS.timeout as End, 'in flight');
    expect(outcome).toEqual({ rejected: 'ERR_ISOLATE_HOST_SANDBOX_DESTROYED' });
    expect(burned).toBeLessThan(0.1);
  });
  for (const [name, end] of Object.entries(ENDS))
    for (const moment of MOMENTS)
      it(`${name} × destroy ${typeof moment === 'number' ? `${moment} microtask(s) after the result` : moment}`, async () => {
        const { outcome, burned } = await destroyAt(end, moment);
        expect(burned, JSON.stringify(outcome)).toBeLessThan(0.1);
      });
});
