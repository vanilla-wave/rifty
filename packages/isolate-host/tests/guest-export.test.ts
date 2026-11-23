/**
 * ADR-0558 §4: `runCode` runs the export's guest bundle — the
 * file its child loads is byte-identical to `@riftydev/isolate-guest/guest.js`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runCode } from '../src/index.ts';

const carrier = it;

carrier("the host's guest bundle is the export's, byte for byte", () => {
  const exported = createRequire(import.meta.url).resolve('@riftydev/isolate-guest/guest.js');
  const hosted = fileURLToPath(new URL('../dist/guest.js', import.meta.url));
  expect(readFileSync(hosted).equals(readFileSync(exported))).toBe(true);
});

it("runCode's guest clock is the export's: timeOrigin + now() is the wall clock, from the call's start", async () => {
  // A warm worker: its process origin is before the call, so an origin taken from
  // the worker's start, not the call's, falls outside [t0, t1]. Each clock value is
  // bracketed by reads taken before and after it, so preemption between reads only
  // widens the bracket; 1 ms is Date.now()'s integer granularity.
  await runCode('');
  const t0 = Date.now();
  const result = await runCode(
    'const a = Date.now(); const p = performance.timeOrigin + performance.now(); const b = Date.now(); console.log(a - 1 <= p && p <= b + 1, performance.timeOrigin)',
  );
  const t1 = Date.now();
  const [wall, origin] = result.stdout.trim().split(' ');
  expect({ ...result, stdout: wall }).toEqual({ stdout: 'true', stderr: '', exitCode: 0 });
  expect(Number(origin)).toBeGreaterThanOrEqual(t0 - 1);
  expect(Number(origin)).toBeLessThanOrEqual(t1 + 1);
});
