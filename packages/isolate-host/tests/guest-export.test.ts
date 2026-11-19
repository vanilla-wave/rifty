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

it("runCode's guest clock is the export's: timeOrigin + now() is the wall clock", async () => {
  // A fresh `node -e` reads ~0.5 ms here; a worker's process origin is its whole uptime off.
  // 50 ms: the two clock reads are separate host calls, and a loaded machine can preempt between them.
  const result = await runCode(
    'console.log(Math.abs(performance.timeOrigin + performance.now() - Date.now()) < 50, performance.now() < 1000)',
  );
  expect(result).toEqual({ stdout: 'true true\n', stderr: '', exitCode: 0 });
});
