/**
 * Goal isolate-guest-embed I5: every bridge function a guest can call is
 * guest-controlled input. The export's wrapper accepts a value only when the
 * contract allows it, refuses with a guest-safe `TypeError` (no host frame),
 * never lets a hook failure through as a host error, stops all host timers at
 * `close()`, and `exitStatus` reads anything but an integer 0..255 as 1.
 */
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** The acceptance carrier (map item 1); RED was `it.fails` before the export landed. */
const carrier = it;

interface Functions {
  write(fd: unknown, bytes: unknown): void;
  timerStart(id: unknown, ms: unknown, repeat: unknown): void;
  timerClear(id: unknown): void;
  now(): number;
  random(n: unknown): Uint8Array;
}
interface Export {
  createHostBridge(hooks: { write(fd: 1 | 2, bytes: Uint8Array): void; fire(id: number): void }): {
    functions: Functions;
    timeOrigin: number;
    close(): void;
  };
  exitStatus(value: unknown): number;
}
// Loaded per test: before the export lands this import is the RED.
const load = async (): Promise<Export> => (await import('../src/index.ts')) as unknown as Export;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const GARBAGE: readonly unknown[] = [
  undefined,
  null,
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  2 ** 53,
  2 ** 52,
  2 ** 31,
  2 ** 31 - 1,
  65536,
  65537,
  '1',
  'pwn',
  {},
  { byteLength: 0, x: 1 },
  { byteLength: 5, buffer: 1 },
  [],
  [1, 2],
  () => 1,
  new Proxy({}, {}),
  'x'.repeat(1e5),
  new ArrayBuffer(4),
  new Uint16Array(2),
  new DataView(new ArrayBuffer(2)),
  Symbol('s'),
  10n,
  true,
];

/** The contract: the only values each argument may take. */
const VALID: Readonly<Record<string, (v: unknown) => boolean>> = {
  'write(fd)': (v) => v === 1 || v === 2,
  'write(bytes)': (v) => v instanceof Uint8Array,
  'timerStart(id)': (v) =>
    Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 2 ** 31 - 1,
  'timerStart(ms)': (v) => typeof v === 'number' && v >= 0 && v <= 2 ** 31 - 1,
  'timerStart(repeat)': (v) => typeof v === 'boolean',
  'timerClear(id)': (v) =>
    Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 2 ** 31 - 1,
  'random(n)': (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 65536,
};

/** Live host timers of this process. */
const timeouts = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

const HOST_PATH = /file:|node:internal|\/node_modules\/|\.ts:|\.js:/;

describe('createHostBridge argument validation (I5)', () => {
  carrier(
    'accepts a value only when the contract allows it, and refuses guest-safely',
    async () => {
      const { createHostBridge } = await load();
      const written: [number, Uint8Array][] = [];
      const { functions, close } = createHostBridge({
        write: (fd, bytes) => written.push([fd, bytes]),
        fire: () => {},
      });
      // Nothing guest-callable beyond the contract.
      expect(Object.keys(functions).sort()).toEqual([
        'now',
        'random',
        'timerClear',
        'timerStart',
        'write',
      ]);
      const calls: [string, (g: unknown) => unknown][] = [
        ['write(fd)', (g) => functions.write(g, Uint8Array.of(120))],
        ['write(bytes)', (g) => functions.write(1, g)],
        ['timerStart(id)', (g) => functions.timerStart(g, 0, false)],
        ['timerStart(ms)', (g) => functions.timerStart(7, g, false)],
        ['timerStart(repeat)', (g) => functions.timerStart(8, 0, g)],
        ['timerClear(id)', (g) => functions.timerClear(g)],
        ['random(n)', (g) => functions.random(g)],
      ];
      const bad: string[] = [];
      for (const g of GARBAGE) {
        for (const [label, call] of calls) {
          let refused: unknown;
          const armed = timeouts();
          try {
            call(g);
          } catch (error) {
            refused = error;
          }
          const allowed = (VALID[label] as (v: unknown) => boolean)(g);
          // A refused call has no effect: no host timer armed (or cleared).
          if (refused !== undefined && timeouts() !== armed)
            bad.push(`${label} armed on ${String(g).slice(0, 20)}`);
          if (refused === undefined) {
            if (!allowed) bad.push(`${label} accepted ${String(g).slice(0, 20)}`);
            continue;
          }
          if (allowed) bad.push(`${label} refused a valid ${String(g).slice(0, 20)}`);
          const error = refused as Error;
          if (!(error instanceof TypeError) || !error.message.startsWith('isolate-host bridge: ')) {
            bad.push(`${label} threw ${String(error).slice(0, 60)}`);
          }
          if (HOST_PATH.test(String(error.stack))) bad.push(`${label} leaked a host path`);
        }
      }
      expect(bad).toEqual([]);
      // Only valid calls reached the hook, and valid calls still work after the abuse.
      expect(written.every(([fd, b]) => (fd === 1 || fd === 2) && b instanceof Uint8Array)).toBe(
        true,
      );
      written.length = 0;
      expect(functions.random(4)).toHaveLength(4);
      functions.write(2, Uint8Array.of(65));
      expect(written).toEqual([[2, Uint8Array.of(65)]]);
      close();
    },
  );

  carrier(
    'a throwing embedder hook reaches the guest as a guest-safe refusal, never a host error',
    async () => {
      const { createHostBridge } = await load();
      const { functions, close } = createHostBridge({
        write: () => {
          throw new Error(`host secret at ${import.meta.url}`);
        },
        fire: () => {},
      });
      let caught: unknown;
      try {
        functions.write(1, Uint8Array.of(1));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TypeError);
      expect(String((caught as Error).message)).toBe('isolate-host bridge: write failed');
      expect(String((caught as Error).stack)).not.toMatch(HOST_PATH);
      close();
    },
  );

  carrier('the guest clock starts with the bridge, never at the host process start', async () => {
    const { createHostBridge } = await load();
    await sleep(30);
    const { functions, timeOrigin, close } = createHostBridge({ write: () => {}, fire: () => {} });
    const first = functions.now();
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(20);
    const until = Date.now() + 50;
    let spun = first;
    while (spun - first < 2 && Date.now() < until) spun = functions.now();
    expect(spun).toBeGreaterThan(first + 1);
    // timeOrigin + now() is the wall clock, so a constant `now()` or a host-uptime origin fails.
    expect(Math.abs(timeOrigin + functions.now() - Date.now())).toBeLessThan(50);
    expect(timeOrigin - performance.timeOrigin).toBeGreaterThan(25);
    close();
  });

  carrier('random() is random, not a fixed fill', async () => {
    const { createHostBridge } = await load();
    const { functions, close } = createHostBridge({ write: () => {}, fire: () => {} });
    const a = functions.random(32);
    const b = functions.random(32);
    expect(a).toHaveLength(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(new Set([...a, ...b]).size).toBeGreaterThan(16);
    close();
  });

  carrier("a hook's own bridge-looking TypeError is still a guest-safe refusal", async () => {
    const { createHostBridge } = await load();
    const { functions, close } = createHostBridge({
      write: () => {
        throw new TypeError(`isolate-host bridge: host detail ${import.meta.url}`);
      },
      fire: () => {},
    });
    let caught: unknown;
    try {
      functions.write(1, Uint8Array.of(1));
    } catch (error) {
      caught = error;
    }
    expect(String((caught as Error).message)).toBe('isolate-host bridge: write failed');
    expect(String((caught as Error).stack)).not.toMatch(HOST_PATH);
    close();
  });

  carrier('a fired one-shot timer leaves nothing behind in the bridge', async () => {
    const { createHostBridge } = await load();
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    let fired = 0;
    const { functions, close } = createHostBridge({ write: () => {}, fire: () => fired++ });
    const N = 100_000;
    gc();
    const base = process.memoryUsage().heapUsed;
    for (let id = 1; id <= N; id++) functions.timerStart(id, 0, false);
    const until = Date.now() + 5000;
    while (fired < N && Date.now() < until) await sleep(20);
    expect(fired).toBe(N);
    gc();
    const kept = process.memoryUsage().heapUsed - base;
    close();
    // Kept entries for 1e5 fired timers hold well over 8 MiB.
    expect(kept).toBeLessThan(4 * 1024 * 1024);
  });

  carrier('timers fire by id; close() stops every timer and arms no new one', async () => {
    const { createHostBridge } = await load();
    const fired: number[] = [];
    const { functions, close } = createHostBridge({
      write: () => {},
      fire: (id) => fired.push(id),
    });
    functions.timerStart(1, 1, false);
    functions.timerStart(2, 1, true);
    functions.timerStart(3, 1, false);
    functions.timerClear(3);
    await sleep(30);
    expect(fired.filter((id) => id === 1)).toEqual([1]);
    expect(fired.filter((id) => id === 2).length).toBeGreaterThan(1);
    expect(fired).not.toContain(3);
    functions.timerStart(4, 20, false);
    const before = timeouts();
    close();
    // Every host timer of the bridge is gone, and after close timerStart is a no-op.
    expect(timeouts()).toBe(before - 2);
    const seen = fired.length;
    functions.timerStart(5, 1, false);
    functions.timerStart(6, 1, true);
    expect(timeouts()).toBe(before - 2);
    await sleep(40);
    expect(fired.length).toBe(seen);
  });

  carrier('re-arming an id replaces its timer, and close() still clears it', async () => {
    const { createHostBridge } = await load();
    const { functions, close } = createHostBridge({ write: () => {}, fire: () => {} });
    const before = timeouts();
    functions.timerStart(9, 1000, true);
    functions.timerStart(9, 1000, true);
    functions.timerStart(9, 1000, false);
    expect(timeouts()).toBe(before + 1);
    close();
    expect(timeouts()).toBe(before);
  });

  carrier('a throwing fire hook stays inside the bridge and ends that timer', async () => {
    const { createHostBridge } = await load();
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.prependListener('uncaughtException', onUncaught);
    let calls = 0;
    const { functions, close } = createHostBridge({
      write: () => {},
      fire: () => {
        calls++;
        throw new Error('cannot deliver');
      },
    });
    try {
      functions.timerStart(1, 1, true);
      await sleep(30);
      expect(uncaught).toEqual([]);
      expect(calls).toBe(1);
    } finally {
      process.removeListener('uncaughtException', onUncaught);
      close();
    }
  });
});

describe('exitStatus (I5)', () => {
  carrier('passes an integer 0..255 through and reads anything else as 1', async () => {
    const { exitStatus } = await load();
    for (const v of [0, 1, 7, 255]) expect(exitStatus(v)).toBe(v);
    const wrong = [
      ...GARBAGE,
      256,
      -0.5,
      0.5,
      254.5,
      { valueOf: () => 0 },
      Promise.resolve(0),
    ].filter((v) => !(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 255));
    for (const v of wrong) expect(exitStatus(v), String(typeof v)).toBe(1);
  });
});
