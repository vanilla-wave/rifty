/**
 * The host bridge (ADR-0557 §6). Two halves:
 *  - it is unreachable from guest code (captured in a closure, removed from the
 *    realm), so no guest can call the host directly (I3);
 *  - it still treats every argument as hostile, in case a later change exposes
 *    it: that validation is the export's `createHostBridge`, tested in
 *    `packages/isolate-guest/tests/host-bridge.test.ts` (relocated, ADR-0558).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { IMPORT_GAP } from '@riftydev/isolate-guest';
import { describe, expect, it } from 'vitest';
import { importGapError } from '../src/child/bridge.ts';
import { runCode } from '../src/index.ts';
import { childPids } from './support.ts';

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
