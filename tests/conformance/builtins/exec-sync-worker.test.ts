/**
 * Conformance test for ADR-0011 phase 3 — `child_process.execSync` routed
 * through the in-Worker `__riftyKernelSyncCall` shim. Inside a kernel
 * Worker the call must `Atomics.wait` until the parent dispatcher's
 * recursive child finishes and returns its captured stdout.
 *
 * Skips outside a `crossOriginIsolated && getKernelWorkerUrl()`
 * environment — Vitest's plain Node runner satisfies neither (no COOP/COEP,
 * no Vite-bundled kernel-worker URL), so the suite is a no-op in CI but
 * documents the contract for the playground's e2e harness.
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
