/**
 * Conformance test for ADR-0011 phase 3 — `child_process.execSync` routed
 * through the in-Worker `__riftyKernelSyncCall` shim. Inside a kernel
 * Worker the call must `Atomics.wait` until the parent dispatcher's
 * recursive child finishes and returns its captured stdout.
 *
 * The non-SAB branch (no `crossOriginIsolated`, no kernel-worker URL, or
 * call from the main realm) is asserted separately at the bottom of this
 * file: per the 2026-05-27 audit (item #2 in
 * `docs/follow-ups-architecture-review-2026-05-27.md`), the previous
 * in-realm `new Function(...)` fallback is replaced by a loud
 * `NotImplementedError` so callers can't mistake a silent stub for a
 * working child.
 */
import { describe, expect, it } from 'vitest';
import { getKernelWorkerUrl, isSabIpcSupported } from '../../../packages/kernel/src/index.ts';
import { execSync } from '../../../packages/runtime-js/src/builtins/child_process.ts';
import { resetSyncMirror } from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import { writeFileSync } from '../../../packages/runtime-js/src/builtins/fs.ts';

const sabReady = isSabIpcSupported() && getKernelWorkerUrl() !== null;

describe.skipIf(!sabReady)('execSync — Worker-blocking via Atomics.wait (ADR-0011 phase 3)', () => {
  it('blocks the calling Worker and returns the child stdout as a Buffer', () => {
    resetSyncMirror();
    writeFileSync('/sync-worker.js', "globalThis.process.stdout.write('blocked-result');");
    const buf = execSync('node /sync-worker.js');
    expect(new TextDecoder().decode(buf)).toBe('blocked-result');
  });

  it('propagates child failure as an Error with code ECHILDFAILED', () => {
    resetSyncMirror();
    writeFileSync('/sync-bad.js', "throw new Error('boom-from-execsync');");
    expect(() => execSync('node /sync-bad.js')).toThrowError(
      expect.objectContaining({ code: 'ECHILDFAILED' }) as unknown as Error,
    );
  });
});

describe.skipIf(sabReady)('execSync — non-SAB realm refuses with NotImplementedError', () => {
  it('throws NotImplementedError naming the missing capability', () => {
    resetSyncMirror();
    writeFileSync('/sync-no-sab.js', "globalThis.process.stdout.write('should-not-run');");
    expect(() => execSync('node /sync-no-sab.js')).toThrowError(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'child_process.execSync',
      }) as unknown as Error,
    );
  });
});
