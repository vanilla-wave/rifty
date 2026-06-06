/**
 * Structural Worker interface + test-only factory hook for `spawn-worker.ts`.
 *
 * Separate module to keep spawn under the ADR-0024 file-size budget. Not
 * re-exported via `src/index.ts`: callers outside the kernel treat the
 * Worker boundary as opaque.
 */

/**
 * Structural subset of DOM `Worker` that `spawnKernelWorker` touches.
 * Declared here so it's testable in Node (no `Worker` global) without a
 * `lib.dom`-wide dependency leak.
 */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: ReadonlyArray<Transferable>): void;
  terminate(): void;
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void;
  removeEventListener(type: string, listener: (ev: MessageEvent) => void): void;
}

/** Test-only factory: substitutes a stub for `new Worker(url, opts)`. */
export type WorkerFactory = (url: string | URL) => WorkerLike;

let workerFactoryForTests: WorkerFactory | null = null;

/** Test-only: install a stub factory used in place of `new Worker(...)`. */
export function setWorkerFactoryForTests(factory: WorkerFactory): void {
  workerFactoryForTests = factory;
}

/** Test-only: revert to the real `new Worker(...)` constructor. */
export function clearWorkerFactoryForTests(): void {
  workerFactoryForTests = null;
}

/**
 * Construct a {@link WorkerLike}: the test stub if installed via
 * {@link setWorkerFactoryForTests}, else a real DOM `Worker` (which must
 * exist in the runtime calling `spawnKernelWorker`).
 */
export function makeKernelWorker(url: string | URL): WorkerLike {
  if (workerFactoryForTests !== null) return workerFactoryForTests(url);
  return new Worker(url, { type: 'module' }) as unknown as WorkerLike;
}
