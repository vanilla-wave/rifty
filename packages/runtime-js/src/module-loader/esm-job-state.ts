import { NotImplementedError } from '@riftydev/io';
import { ModuleLoadError } from './errors.ts';
import {
  type AsyncEvaluationGroup,
  type AsyncGraph,
  type EsmJob,
  type EsmLoaderDeps,
  UNINITIALIZED_EXPORT,
} from './esm-job-types.ts';
import type { ModuleRecord } from './registry.ts';
import type { ResolvedModule } from './resolver.ts';

const esmJobs = new WeakMap<ModuleRecord, EsmJob>();
const activeEsmEvaluations: EsmJob[] = [];

export function currentJob(record: ModuleRecord, deps: EsmLoaderDeps): EsmJob | undefined {
  if (deps.registry.get(record.id) !== record) return undefined;
  return esmJobs.get(record);
}

export function createEsmJob(
  record: ModuleRecord,
  resolved: ResolvedModule,
  mode: 'async' | 'sync',
): EsmJob {
  let resolvePromise!: (namespace: Record<string, unknown>) => void;
  let rejectPromise!: (error: unknown) => void;
  let resolvePrepared!: () => void;
  let rejectPrepared!: (error: unknown) => void;
  const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  void promise.catch(() => undefined);
  const preparedPromise = new Promise<void>((resolve, reject) => {
    resolvePrepared = resolve;
    rejectPrepared = reject;
  });
  void preparedPromise.catch(() => undefined);
  const phase =
    record.state === 'loaded' ? 'loaded' : record.state === 'errored' ? 'errored' : 'preparing';
  const job: EsmJob = {
    record,
    resolved,
    mode,
    phase,
    hasRequireResult: false,
    promise,
    resolvePromise,
    rejectPromise,
    settled: false,
    preparedPromise,
    resolvePrepared,
    rejectPrepared,
    preparationSettled: false,
    evaluationGroup: mode === 'async' ? { tail: Promise.resolve(), pendingLocks: 0 } : undefined,
    suspended: false,
    generatorStepActive: false,
  };
  if (phase === 'loaded') {
    settlePreparationSuccess(job);
    settleJobSuccess(job);
  } else if (phase === 'errored') {
    job.error = record.error;
    settlePreparationFailure(job, record.error);
    settleJobFailure(job, record.error);
  }
  esmJobs.set(record, job);
  return job;
}

export function observeAsyncJob(graph: AsyncGraph, job: EsmJob): void {
  graph.observed.add(job);
  const observers = job.asyncObservers ?? new Set<symbol>();
  observers.add(graph.token);
  job.asyncObservers = observers;
}

export function releaseAsyncGraph(graph: AsyncGraph): void {
  for (const job of graph.observed) {
    job.asyncObservers?.delete(graph.token);
    if (job.asyncObservers?.size === 0) job.asyncObservers = undefined;
  }
}

export function markJobSuspended(job: EsmJob): void {
  job.suspended = true;
}

export function settlePreparationSuccess(job: EsmJob): void {
  if (job.preparationSettled) return;
  job.preparationSettled = true;
  job.resolvePrepared();
}

export function settlePreparationFailure(job: EsmJob, error: unknown): void {
  if (job.preparationSettled) return;
  job.preparationSettled = true;
  job.rejectPrepared(error);
}

export function settleJobSuccess(job: EsmJob): void {
  if (job.settled) return;
  job.settled = true;
  job.resolvePromise(job.record.exports);
}

export function settleJobFailure(job: EsmJob, error: unknown): void {
  if (job.settled) return;
  job.settled = true;
  job.rejectPromise(error);
}

export function withActiveEvaluation<T>(job: EsmJob, fn: () => T): T {
  activeEsmEvaluations.push(job);
  try {
    return fn();
  } finally {
    activeEsmEvaluations.pop();
  }
}

export function isActivelyEvaluating(job: EsmJob): boolean {
  return job.generatorStepActive || activeEsmEvaluations.includes(job);
}

function evaluationGroupRoot(group: AsyncEvaluationGroup): AsyncEvaluationGroup {
  if (!group.parent) return group;
  group.parent = evaluationGroupRoot(group.parent);
  return group.parent;
}

export function unionEvaluationGroups(left: EsmJob, right: EsmJob): void {
  if (!left.evaluationGroup || !right.evaluationGroup) return;
  const leftRoot = evaluationGroupRoot(left.evaluationGroup);
  const rightRoot = evaluationGroupRoot(right.evaluationGroup);
  if (leftRoot === rightRoot) return;
  rightRoot.parent = leftRoot;
  leftRoot.tail = Promise.all([leftRoot.tail, rightRoot.tail]).then(() => undefined);
  leftRoot.pendingLocks += rightRoot.pendingLocks;
}

export async function withEvaluationGroupLock<T>(job: EsmJob, fn: () => Promise<T>): Promise<T> {
  const initial = job.evaluationGroup;
  if (!initial) return fn();
  const group = evaluationGroupRoot(initial);
  const prior = group.tail;
  const canEnterImmediately = group.pendingLocks === 0;
  let release!: () => void;
  const ticket = new Promise<void>((resolve) => {
    release = resolve;
  });
  group.tail = prior.then(() => ticket);
  group.pendingLocks++;
  if (!canEnterImmediately) await prior;
  try {
    return await fn();
  } finally {
    evaluationGroupRoot(group).pendingLocks--;
    release();
  }
}

export function requireAsyncModuleError(id: string): ModuleLoadError {
  return new ModuleLoadError(
    'ERR_REQUIRE_ASYNC_MODULE',
    id,
    `require() cannot be used on an ESM graph with top-level await: ${id}`,
    id,
  );
}

export function requireCycleError(id: string): ModuleLoadError {
  return new ModuleLoadError(
    'ERR_REQUIRE_CYCLE_MODULE',
    id,
    `Cannot require() ES Module ${id} in a cycle.`,
    id,
  );
}

export function requireRaceError(id: string): ModuleLoadError {
  return new ModuleLoadError(
    'ERR_REQUIRE_ESM_RACE_CONDITION',
    id,
    `Cannot require() ES Module ${id} because it is not yet fully loaded.`,
    id,
  );
}

export function syncTransformCeiling(id: string): NotImplementedError {
  return new NotImplementedError(
    'module-loader.transformed-esm-via-require',
    `Synchronous require() cannot run transformed ESM ${id}; the configured TS/TSX/JSX transform is Promise-based (ADR-0052).`,
  );
}

export function rollbackJobs(jobs: Iterable<EsmJob>, deps: EsmLoaderDeps, error: unknown): void {
  for (const job of jobs) {
    settlePreparationFailure(job, error);
    settleJobFailure(job, error);
    esmJobs.delete(job.record);
    if (deps.registry.get(job.record.id) === job.record) deps.registry.invalidate(job.record.id);
  }
}

export function rollbackAsyncGraph(graph: AsyncGraph, deps: EsmLoaderDeps, error: unknown): void {
  for (const job of graph.observed) {
    job.asyncObservers?.delete(graph.token);
    const remainingOwner = job.asyncObservers?.values().next().value as symbol | undefined;
    if (job.asyncOwner === graph.token && remainingOwner) job.asyncOwner = remainingOwner;
    if (job.asyncObservers?.size === 0) job.asyncObservers = undefined;
    if (remainingOwner || job.asyncOwner !== graph.token) continue;
    if (job.phase !== 'preparing' && job.phase !== 'prepared') continue;
    settlePreparationFailure(job, error);
    settleJobFailure(job, error);
    esmJobs.delete(job.record);
    if (deps.registry.get(job.record.id) === job.record) deps.registry.invalidate(job.record.id);
  }
}

export function failEvaluation(job: EsmJob, error: unknown): void {
  job.phase = 'errored';
  job.error = error;
  Object.defineProperty(job.record, 'error', {
    value: error,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  job.record.state = 'errored';
  settleJobFailure(job, error);
}

export function finishEvaluation(job: EsmJob): Record<string, unknown> {
  rebuildExports(job.record);
  job.record.state = 'loaded';
  job.phase = 'loaded';
  settleJobSuccess(job);
  return job.record.exports;
}

export function requireResult(job: EsmJob): unknown {
  if (job.hasRequireResult) return job.requireResult;
  const namespace = job.record.exports;
  if (Object.prototype.hasOwnProperty.call(namespace, 'module.exports')) {
    job.requireResult = namespace['module.exports'];
  } else if (
    Object.prototype.hasOwnProperty.call(namespace, 'default') &&
    !Object.prototype.hasOwnProperty.call(namespace, '__esModule')
  ) {
    const facade = Object.create(null) as Record<string, unknown>;
    for (const key of [...Object.keys(namespace), '__esModule'].sort()) {
      if (key === '__esModule') {
        Object.defineProperty(facade, key, { enumerable: true, value: true });
      } else {
        Object.defineProperty(facade, key, {
          enumerable: true,
          get: () => namespace[key],
        });
      }
    }
    Object.defineProperty(facade, Symbol.toStringTag, { value: 'Module' });
    job.requireResult = facade;
  } else {
    job.requireResult = namespace;
  }
  job.hasRequireResult = true;
  return job.requireResult;
}

/** Mutate the live namespace in place from the record's export slots. */
export function rebuildExports(record: ModuleRecord): void {
  const namespace = record.exports ?? Object.create(null);
  for (const key of Object.keys(namespace)) delete namespace[key];
  for (const key of Object.keys(record.slots).sort()) {
    Object.defineProperty(namespace, key, {
      configurable: true,
      enumerable: true,
      get: () => {
        const value = record.slots[key];
        if (value === UNINITIALIZED_EXPORT) {
          throw new ReferenceError(`Cannot access '${key}' before initialization`);
        }
        return value;
      },
    });
  }
  if (!Object.getOwnPropertyDescriptor(namespace, Symbol.toStringTag)) {
    Object.defineProperty(namespace, Symbol.toStringTag, { value: 'Module' });
  }
  record.exports = namespace;
}
