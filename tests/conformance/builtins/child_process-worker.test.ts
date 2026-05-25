/**
 * Conformance test for ADR-0011 phase 2 — `child_process.spawn` routed
 * through `kernel.spawnWorker` into a real Web Worker realm.
 *
 * These tests document the behaviour the playground (and any other
 * crossOriginIsolated host) gets. They `skip` in Vitest's plain Node
 * environment because `isSabIpcSupported()` returns `false` there
 * (`crossOriginIsolated === undefined`). The same suite executes for real
 * in the browser e2e harness once the playground spins up a child via
 * `spawn('node', […])`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isSabIpcSupported } from '../../../packages/kernel/src/index.ts';
import { spawn } from '../../../packages/runtime-js/src/builtins/child_process.ts';
import { resetSyncMirror } from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import { writeFileSync } from '../../../packages/runtime-js/src/builtins/fs.ts';

afterEach(() => resetSyncMirror());

const sabReady = isSabIpcSupported();

describe.skipIf(!sabReady)('child_process.spawn — Worker-backed (ADR-0011 phase 2)', () => {
  it('stdout from the worker arrives as bytes on child.stdout', async () => {
    writeFileSync('/hello-worker.js', "globalThis.process.stdout.write('hi from worker\\n');");
    const child = spawn('node', ['/hello-worker.js']);
    let out = '';
    child.stdout.on('data', (c) => {
      out += typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array);
    });
    const code = await new Promise<number | null>((resolve) =>
      child.on('close', (c) => resolve(c as number | null)),
    );
    expect(code).toBe(0);
    expect(out).toBe('hi from worker\n');
  });

  it('exit fires with code 1 when the script throws', async () => {
    writeFileSync('/bad-worker.js', "throw new Error('boom-worker');");
    const child = spawn('node', ['/bad-worker.js']);
    let err = '';
    child.stderr.on('data', (c) => {
      err += typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array);
    });
    const code = await new Promise<number | null>((resolve) =>
      child.on('exit', (c) => resolve(c as number | null)),
    );
    expect(code).toBe(1);
    // Stderr capture is best-effort across realms; assert a non-empty
    // payload rather than an exact substring (the worker-entry formats
    // the throw with the engine's stack trace).
    expect(err.length).toBeGreaterThan(0);
  });
});
