/**
 * The host bridge (ADR-0557 §6). Two halves:
 *  - it is unreachable from guest code (captured in a closure, removed from the
 *    realm), so no guest can call the host directly (I3);
 *  - it still treats every argument as hostile, in case a later change exposes
 *    it: each refusal is a guest-safe `TypeError` with no host frame.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { IMPORT_GAP, OutputBudget, createBridge, importGapError } from '../src/child/bridge.ts';
import { runCode } from '../src/index.ts';
import { childPids } from './support.ts';

const GARBAGE: readonly unknown[] = [
  undefined,
  null,
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  2 ** 53,
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

/** The bridge's own contract: the only values each entry may accept. */
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

describe('host bridge argument validation', () => {
  it('accepts a value only when its contract allows it, and refuses guest-safely', () => {
    const output = new OutputBudget(1 << 20);
    const bridge = createBridge({
      output,
      outputPending: () => {},
      fire: () => {},
    });
    const calls: [string, (g: unknown) => unknown][] = [
      ['write(fd)', (g) => bridge.write(g, Uint8Array.of(120))],
      ['write(bytes)', (g) => bridge.write(1, g)],
      ['timerStart(id)', (g) => bridge.timerStart(g, 0, false)],
      ['timerStart(ms)', (g) => bridge.timerStart(7, g, false)],
      ['timerStart(repeat)', (g) => bridge.timerStart(8, 0, g)],
      ['timerClear(id)', (g) => bridge.timerClear(g)],
      ['random(n)', (g) => bridge.random(g)],
    ];
    const bad: string[] = [];
    for (const g of GARBAGE) {
      for (const [label, call] of calls) {
        let refused: unknown;
        try {
          call(g);
        } catch (error) {
          refused = error;
        }
        const allowed = (VALID[label] as (v: unknown) => boolean)(g);
        if (refused === undefined) {
          if (!allowed) bad.push(`${label} accepted ${String(g).slice(0, 20)}`);
          continue;
        }
        if (allowed) bad.push(`${label} refused a valid ${String(g).slice(0, 20)}`);
        const error = refused as Error;
        if (!(error instanceof TypeError) || !error.message.startsWith('isolate-host bridge: ')) {
          bad.push(`${label} threw ${String(error).slice(0, 60)}`);
        }
        // A refusal crosses into the guest: no host frame or path may ride along.
        if (/file:|child\.js|node:internal|\/node_modules\//.test(String(error.stack))) {
          bad.push(`${label} leaked a host path`);
        }
      }
    }
    expect(bad).toEqual([]);
    // Valid calls still work after the abuse, and only valid ones took effect.
    expect(bridge.random(4)).toHaveLength(4);
    bridge.write(1, Uint8Array.of(65));
    expect(output.drain()).toEqual([[1, Uint8Array.of(65)]]);
    for (const id of [7, 8]) bridge.timerClear(id);
  });

  it('now() is the child clock, not a constant and not child state', () => {
    const bridge = createBridge({
      output: new OutputBudget(16),
      outputPending: () => {},
      fire: () => {},
    });
    const first = bridge.now();
    // Bounded by the wall clock, so a constant `now()` fails here instead of spinning.
    const until = Date.now() + 50;
    let spun = first;
    while (spun - first < 2 && Date.now() < until) spun = bridge.now();
    expect(spun).toBeGreaterThan(first + 1);
    // Tracks the wall clock, so a constant or a pid cannot pass.
    expect(Math.abs(performance.timeOrigin + spun - Date.now())).toBeLessThan(200);
  });
});

describe('host bridge reachability from the guest (I3)', () => {
  it('no bridge object or host function is reachable in the guest realm', async () => {
    const result = await runCode(`
      const names = Object.getOwnPropertyNames(globalThis);
      const seen = new Set();
      const bad = [];
      const walk = (v, path, depth) => {
        if (v === null || (typeof v !== 'object' && typeof v !== 'function') || seen.has(v) || depth > 6) return;
        seen.add(v);
        // An ivm.Callback is a native function; intrinsics (Math.random) are too,
        // so a hit counts only when the object carries the bridge's own shape.
        const bridgeish = ['write', 'timerStart', 'timerClear', 'random'].every(
          (k) => { try { return typeof v[k] === 'function' } catch { return false } },
        );
        if (bridgeish) bad.push(path);
        let keys = [];
        try { keys = Reflect.ownKeys(v); } catch {}
        for (const k of keys) {
          let d;
          try { d = Reflect.getOwnPropertyDescriptor(v, k); } catch { continue; }
          if (d && 'value' in d) walk(d.value, path + '.' + String(k), depth + 1);
        }
      };
      walk(globalThis, 'globalThis', 0);
      console.log(JSON.stringify({
        bridge: typeof globalThis.__riftyIsolateHost,
        extras: names.filter((n) => n.startsWith('__rifty')),
        bad,
      }));
    `);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      bridge: 'undefined',
      // `__rifty` is rifty's own runtime table: breaking its own rifty is the
      // guest's business (goal.md Decisions, manager 2026-11-18), and it holds no host function.
      extras: ['__rifty'],
      bad: [],
    });
    expect(childPids()).toEqual([]);
  });
});

describe('the import() rejection a guest sees (I3)', () => {
  // End to end it cannot be read: the child reports exit 1 when the import is
  // requested, before the guest's own `.catch` runs. So this drives a real
  // isolated-vm isolate whose `import()` rejects with the child's error, and
  // reads `e.stack` as the guest sees it.
  it('names no host frame, path or module', () => {
    const error = importGapError();
    const ivmPath = createRequire(import.meta.url).resolve('isolated-vm');
    const script = `
      const ivm = require(${JSON.stringify(ivmPath)});
      const thrown = ${JSON.stringify({ message: error.message, stack: error.stack })};
      const isolate = new ivm.Isolate({
        memoryLimit: 16,
        importModuleDynamically: () => { throw Object.assign(new Error(thrown.message), { stack: thrown.stack }) },
      });
      const context = isolate.createContextSync();
      context.eval("import('node:fs').then(() => 'resolved', (e) => String(e.stack))", { promise: true, copy: true })
        .then((seen) => { process.stdout.write(JSON.stringify(seen)); isolate.dispose() });`;
    const seen = JSON.parse(
      execFileSync(process.execPath, ['--no-node-snapshot', '-e', script], { encoding: 'utf8' }),
    );
    // isolated-vm appends its boundary and the guest's own frame; nothing of the host's.
    expect(seen.startsWith(`Error: ${IMPORT_GAP}\n    at (<isolated-vm boundary>)`)).toBe(true);
    expect(seen).not.toMatch(/file:|child|dist\/|\.ts:|\.js:/);
  });
});
