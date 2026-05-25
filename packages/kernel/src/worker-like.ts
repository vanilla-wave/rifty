/**
 * Structural Worker interface + test-only factory hook used by
 * `spawn-worker.ts`.
 *
 * Lives in its own module so the spawn module stays under the ADR-0024
 * file-size budget. Reachable from `packages/kernel/tests/` via the
 * package-relative path; not re-exported through the public
 * `src/index.ts` because callers outside the kernel should treat the
 * Worker boundary as opaque.
 */

/**
 * Structural subset of the DOM `Worker` interface that `spawnKernelWorker`
 * actually touches. Declared here so the implementation is testable in
 * Node (which lacks `Worker` as a global) without a `lib.dom`-wide
 * dependency leak.
 */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: ReadonlyArray<Transferable>): void;
  terminate(): void;
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void;
  removeEventListener(type: string, listener: (ev: MessageEvent) => void): void;
}

/** Test-only factory: lets the unit tests substitute a stub for `new Worker(url, opts)`. */
export type WorkerFactory = (url: string | URL) => WorkerLike;

let workerFactoryForTests: WorkerFactory | null = null;

/**
 * Test-only: install a stub factory used in place of `new Worker(...)`.
 * Not exported from the package's public `src/index.ts`; reachable via
 * the package's deep import in `packages/kernel/tests/` only.
 */
export function setWorkerFactoryForTests(factory: WorkerFactory): void {
  workerFactoryForTests = factory;
}

/** Test-only: revert to the real `new Worker(...)` constructor. */
export function clearWorkerFactoryForTests(): void {
  workerFactoryForTests = null;
}

/**
 * Construct a {@link WorkerLike}. Returns the test stub when one is
 * installed via {@link setWorkerFactoryForTests}; otherwise instantiates
 * a real DOM `Worker` (which must exist in the runtime that calls
 * `spawnKernelWorker`).
 */
export function makeKernelWorker(url: string | URL): WorkerLike {
  if (workerFactoryForTests !== null) return workerFactoryForTests(url);
  return new Worker(url, { type: 'module' }) as unknown as WorkerLike;
}
