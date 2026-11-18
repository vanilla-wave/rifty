/**
 * The host bridge is reachable guest surface (ADR-0557 §6): every function takes
 * hostile arguments. The child validates each argument, throws only a guest-safe
 * error (no host frames or paths) and the consumer process never sees it (I3, I4).
 */
import { describe, expect, it } from 'vitest';
import { runCode } from '../src/index.ts';
import { childPids } from './support.ts';

const GARBAGE = `[
  undefined, null, 0, -1, 1.5, NaN, Infinity, 2 ** 53, '1', 'pwn', {}, { byteLength: 0, x: 1 },
  { byteLength: 5, buffer: 1 }, [], [1, 2], () => 1, new Proxy({}, {}), 'x'.repeat(1e5),
  new ArrayBuffer(4), new Uint16Array(2), new DataView(new ArrayBuffer(2)),
]`;

describe('host bridge under hostile arguments', () => {
  it('every bridge function rejects garbage with a guest-safe error; the run and the consumer survive', async () => {
    const result = await runCode(`
      const bridge = globalThis.__riftyIsolateHost;
      const garbage = ${GARBAGE};
      const calls = [];
      for (const g of garbage) {
        calls.push(['write(fd=g)', () => bridge.write(g, new Uint8Array([120]))]);
        calls.push(['write(bytes=g)', () => bridge.write(1, g)]);
        calls.push(['timerStart(id=g)', () => bridge.timerStart(g, 0, false)]);
        calls.push(['timerStart(ms=g)', () => bridge.timerStart(1e6, g, false)]);
        calls.push(['timerStart(repeat=g)', () => bridge.timerStart(1e6 + 1, 0, g)]);
        calls.push(['timerClear(g)', () => bridge.timerClear(g)]);
        calls.push(['random(g)', () => bridge.random(g)]);
        calls.push(['done(g)', () => bridge.done(g)]);
      }
      const bad = [];
      for (const [label, call] of calls) {
        try { call(); } catch (e) {
          const text = String(e && e.stack) + String(e && e.message);
          if (/file:|child\\.js|node:internal|\\/node_modules\\//.test(text)) bad.push(label + ' leaked: ' + text.slice(0, 200));
        }
      }
      // Valid calls still work after the abuse.
      const r = bridge.random(4);
      if (!(r instanceof Uint8Array) || r.length !== 4) bad.push('random(4) broken');
      if (typeof bridge.now() !== 'number') bad.push('now() broken');
      bridge.timerClear(1e6); bridge.timerClear(1e6 + 1);
      console.log(JSON.stringify({ calls: calls.length, bad }));
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout) as { calls: number; bad: string[] };
    expect(report.bad).toEqual([]);
    expect(report.calls).toBeGreaterThan(100);
    expect(childPids()).toEqual([]);
  });

  it('done() with a non-exit-code value is refused; the run keeps its real status', async () => {
    const result = await runCode(
      "try { __riftyIsolateHost.done('pwn') } catch (e) { console.log(e.name) }; process.exitCode = 3",
    );
    expect(result).toEqual({ stdout: 'TypeError\n', stderr: '', exitCode: 3 });
  });

  it('bridge writes of non-byte values never reach the consumer', async () => {
    const result = await runCode(
      "for (const g of [{ byteLength: 0, x: 1 }, null, [1], 'str']) { try { __riftyIsolateHost.write(1, g) } catch {} } console.log('ok')",
    );
    expect(result).toEqual({ stdout: 'ok\n', stderr: '', exitCode: 0 });
  });

  it('bridge return values carry no child state', async () => {
    const result = await runCode(`
      const b = globalThis.__riftyIsolateHost;
      const now = b.now();
      console.log(JSON.stringify({
        nowNear: Math.abs(now - performance.now()) < 1000,
        nowNotPid: now !== process.pid,
        random: Object.prototype.toString.call(b.random(3)),
        hostGlobals: Object.getOwnPropertyNames(globalThis).filter((n) => n.startsWith('__riftyHost_')),
      }));
    `);
    expect(JSON.parse(result.stdout)).toEqual({
      nowNear: true,
      nowNotPid: true,
      random: '[object Uint8Array]',
      hostGlobals: [],
    });
  });
});
