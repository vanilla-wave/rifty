import { Worker, type WorkerOptions } from 'node:worker_threads';

const LIFECYCLE_TIMEOUT_MS = 30_000;
const CLEANUP_RESERVE_MS = 5_000;

export const REAL_WORKER_TEST_TIMEOUT_MS = LIFECYCLE_TIMEOUT_MS + CLEANUP_RESERVE_MS;

interface ExitOutcome {
  readonly code: number;
  readonly error?: Error;
}

interface WorkerRecord {
  readonly worker: Worker;
  readonly exited: Promise<ExitOutcome>;
  teardown: boolean;
}

export interface RealWorkerScope {
  spawn(filename: string | URL, options: WorkerOptions): Worker;
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function beforeDeadline<T>(operation: Promise<T>, deadline: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const remainingMs = Math.max(0, deadline - performance.now());
    const timer = setTimeout(() => reject(new Error(message)), remainingMs);
    void operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function runRealWorkerLifecycle<T>(
  execute: (scope: RealWorkerScope) => Promise<T>,
): Promise<T> {
  const lifecycleDeadline = performance.now() + LIFECYCLE_TIMEOUT_MS;
  const operationDeadline = lifecycleDeadline - CLEANUP_RESERVE_MS;
  const records: WorkerRecord[] = [];
  let admissionClosed = false;
  let rejectFatal: ((error: Error) => void) | undefined;
  const fatal = new Promise<never>((_, reject) => {
    rejectFatal = reject;
  });
  void fatal.catch(() => undefined);

  const scope: RealWorkerScope = {
    spawn(filename, options) {
      if (admissionClosed) throw new Error('real Worker lifecycle is closed to new spawns');
      const worker = new Worker(filename, options);
      let resolveExit: ((outcome: ExitOutcome) => void) | undefined;
      let firstError: Error | undefined;
      const exited = new Promise<ExitOutcome>((resolve) => {
        resolveExit = resolve;
      });
      const record: WorkerRecord = { worker, exited, teardown: false };
      records.push(record);
      worker.once('error', (error) => {
        firstError = error;
        if (!record.teardown) rejectFatal?.(error);
      });
      worker.once('exit', (code) => {
        resolveExit?.({ code, error: firstError });
        if (!record.teardown && (firstError !== undefined || code !== 0)) {
          rejectFatal?.(firstError ?? new Error(`real Worker exited with code ${code}`));
        }
      });
      return worker;
    },
  };

  const operation = (async () => {
    const value = await execute(scope);
    const outcomes = await Promise.all(records.map(({ exited }) => exited));
    const failed = outcomes.find(({ code, error }) => code !== 0 || error !== undefined);
    if (failed?.error !== undefined) throw failed.error;
    if (failed !== undefined) throw new Error(`real Worker exited with code ${failed.code}`);
    return value;
  })();
  void operation.catch(() => undefined);

  let value: T | undefined;
  let primaryError: Error | undefined;
  try {
    value = await beforeDeadline(
      Promise.race([operation, fatal]),
      operationDeadline,
      `real Worker operation exceeded its ${String(LIFECYCLE_TIMEOUT_MS)}ms lifecycle`,
    );
  } catch (error) {
    primaryError = asError(error);
  }

  admissionClosed = true;
  for (const record of records) {
    record.teardown = true;
    record.worker.unref();
  }
  const terminations = records.map(({ worker }) =>
    Promise.resolve().then(() => worker.terminate()),
  );
  let cleanupError: Error | undefined;
  try {
    const [terminationOutcomes] = await beforeDeadline(
      Promise.all([
        Promise.allSettled(terminations),
        Promise.all(records.map(({ exited }) => exited)),
      ]),
      lifecycleDeadline,
      `real Worker cleanup exceeded its ${String(LIFECYCLE_TIMEOUT_MS)}ms lifecycle`,
    );
    const failures = terminationOutcomes.flatMap((result) =>
      result.status === 'rejected' ? [asError(result.reason)] : [],
    );
    if (failures.length > 0)
      cleanupError = new AggregateError(failures, 'real Worker cleanup failed');
  } catch (error) {
    cleanupError = asError(error);
  }

  if (primaryError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [primaryError, cleanupError],
      'real Worker lifecycle and cleanup failed',
    );
  }
  if (primaryError !== undefined) throw primaryError;
  if (cleanupError !== undefined) throw cleanupError;
  return value as T;
}
