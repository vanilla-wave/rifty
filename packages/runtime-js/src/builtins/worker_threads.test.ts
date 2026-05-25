/**
 * Same-realm fallback contract for `worker_threads.Worker`.
 *
 * When the kernel.spawnWorker capability isn't wired (no SAB / no
 * `kernelWorkerUrl`), the fallback used to be silent — review found this
 * violates the "no silent stubs" rule. Now we emit one console.warn per
 * module import with a clear remediation hint. Functional behaviour
 * (workerData/parentPort propagation) is unchanged and stays covered by
 * `tests/conformance/builtins/worker_threads.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';
import { Worker, _resetFallbackWarnState } from './worker_threads.ts';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  _resetFallbackWarnState();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  resetSyncMirror();
});

describe('worker_threads same-realm fallback warning (no silent stubs)', () => {
  it('warns on the first Worker that hits the same-realm fallback', async () => {
    writeFileSync('/w-warn-1.js', 'parentPort.postMessage("ok");');
    const w = new Worker('/w-warn-1.js');
    await new Promise<void>((resolve) => w.on('exit', () => resolve()));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/\[rifty:worker_threads\]/);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/Falling back to same-realm/);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/setKernelWorkerUrl/);
  });

  it('does not warn again on subsequent Workers (one-shot guard)', async () => {
    writeFileSync('/w-warn-2.js', 'parentPort.postMessage("ok");');
    const w1 = new Worker('/w-warn-2.js');
    await new Promise<void>((resolve) => w1.on('exit', () => resolve()));
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const w2 = new Worker('/w-warn-2.js');
    await new Promise<void>((resolve) => w2.on('exit', () => resolve()));
    // Still 1 — the second worker must not re-warn.
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
