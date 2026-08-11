import { ModuleLoadError } from './errors.ts';
import {
  evaluateAsyncJob,
  evaluateSyncJob,
  instantiateAsyncGraph,
  instantiateSyncGraph,
} from './esm-job-evaluation.ts';
import { linkPreparedGraph, predeclareLinkedExports } from './esm-job-linker.ts';
import {
  finishPreparation,
  prepareLocalAsync,
  prepareLocalSync,
  transformedLoaderForId,
  transformedSource,
} from './esm-job-preparation.ts';
import {
  createEsmJob,
  currentJob,
  isActivelyEvaluating,
  observeAsyncJob,
  rebuildExports,
  releaseAsyncGraph,
  requireAsyncModuleError,
  requireCycleError,
  requireRaceError,
  requireResult,
  rollbackAsyncGraph,
  rollbackJobs,
  settlePreparationSuccess,
  syncTransformCeiling,
  unionEvaluationGroups,
  withEvaluationGroupLock,
} from './esm-job-state.ts';
import type { AsyncGraph, EsmJob, EsmLoaderDeps, SyncGraph } from './esm-job-types.ts';
import type { ResolvedModule } from './resolver.ts';

export type { EsmLoaderDeps, TransformSourceHook } from './esm-job-types.ts';
export { rebuildExports } from './esm-job-state.ts';

function getOrCreateDependencyJob(
  resolved: ResolvedModule,
  deps: EsmLoaderDeps,
  mode: 'async' | 'sync',
): { readonly job: EsmJob; readonly created: boolean } {
  const existingRecord = deps.registry.get(resolved.id);
  if (existingRecord) {
    const job = currentJob(existingRecord, deps);
    if (job) return { job, created: false };
    if (existingRecord.kind !== 'esm' && existingRecord.state === 'loading') {
      throw requireCycleError(resolved.id);
    }
    return { job: createEsmJob(existingRecord, resolved, mode), created: false };
  }
  const record = deps.registry.getOrCreate(resolved.id, 'esm');
  return { job: createEsmJob(record, resolved, mode), created: true };
}

async function prepareAsyncGraph(
  job: EsmJob,
  deps: EsmLoaderDeps,
  graph: AsyncGraph,
): Promise<void> {
  if (job.phase === 'loaded' || job.phase === 'errored' || job.prepared) return;
  if (graph.visiting.has(job)) return;
  graph.visiting.add(job);
  try {
    const prepared = prepareLocalAsync(job.resolved, deps);
    job.prepared = prepared instanceof Promise ? await prepared : prepared;
    predeclareLinkedExports(job);
    rebuildExports(job.record);
    job.phase = 'prepared';
    settlePreparationSuccess(job);
    for (const dependency of job.prepared.dependencies) {
      if (dependency.resolved.kind !== 'esm') continue;
      const found = getOrCreateDependencyJob(dependency.resolved, deps, 'async');
      observeAsyncJob(graph, found.job);
      unionEvaluationGroups(job, found.job);
      if (
        found.created ||
        (found.job.phase === 'preparing' &&
          found.job.mode === 'async' &&
          found.job.asyncOwner === undefined)
      ) {
        found.job.asyncOwner = graph.token;
        graph.owned.add(found.job);
      }
      if (graph.owned.has(found.job)) {
        await prepareAsyncGraph(found.job, deps, graph);
      }
    }
  } finally {
    graph.visiting.delete(job);
  }
}

function prepareSyncGraph(job: EsmJob, deps: EsmLoaderDeps, graph: SyncGraph): void {
  if (job.phase === 'loaded' || job.phase === 'errored' || job.prepared) return;
  if (graph.visiting.has(job)) return;
  graph.visiting.add(job);
  try {
    job.prepared = prepareLocalSync(job.resolved, deps);
    predeclareLinkedExports(job);
    rebuildExports(job.record);
    job.phase = 'prepared';
    settlePreparationSuccess(job);
    for (const dependency of job.prepared.dependencies) {
      if (dependency.resolved.kind !== 'esm') continue;
      const found = getOrCreateDependencyJob(dependency.resolved, deps, 'sync');
      if (found.job.phase === 'preparing' && found.job.mode === 'async') {
        throw requireRaceError(found.job.resolved.id);
      }
      if (found.job.phase === 'evaluating') {
        throw found.job.mode === 'async'
          ? requireRaceError(found.job.resolved.id)
          : requireCycleError(found.job.resolved.id);
      }
      if (found.created) graph.owned.add(found.job);
      if (graph.owned.has(found.job)) prepareSyncGraph(found.job, deps, graph);
    }
  } finally {
    graph.visiting.delete(job);
  }
}

function graphHasTopLevelAwait(job: EsmJob, deps: EsmLoaderDeps, seen: Set<EsmJob>): boolean {
  if (seen.has(job)) return false;
  seen.add(job);
  if (job.prepared?.transformed.hasTopLevelAwait) return true;
  for (const dependency of job.prepared?.dependencies ?? []) {
    if (dependency.resolved.kind !== 'esm') continue;
    const record = deps.registry.get(dependency.resolved.id);
    const child = record ? currentJob(record, deps) : undefined;
    if (child && graphHasTopLevelAwait(child, deps, seen)) return true;
  }
  return false;
}

function graphHasTransformCeiling(
  job: EsmJob,
  deps: EsmLoaderDeps,
  seen: Set<EsmJob>,
): string | null {
  if (seen.has(job)) return null;
  seen.add(job);
  if (transformedLoaderForId(job.resolved.id)) return job.resolved.id;
  for (const dependency of job.prepared?.dependencies ?? []) {
    if (dependency.resolved.kind !== 'esm') continue;
    const record = deps.registry.get(dependency.resolved.id);
    const child = record ? currentJob(record, deps) : undefined;
    if (!child) continue;
    const ceiling = graphHasTransformCeiling(child, deps, seen);
    if (ceiling) return ceiling;
  }
  return null;
}

async function evaluatePreparedAsyncGraph(
  root: EsmJob,
  deps: EsmLoaderDeps,
  graph: AsyncGraph,
): Promise<void> {
  try {
    await evaluateAsyncJob(root, deps, new Set());
  } catch (error) {
    rollbackAsyncGraph(graph, deps, error);
  }
}

async function awaitPreparedClosure(
  job: EsmJob,
  deps: EsmLoaderDeps,
  graph: AsyncGraph,
  seen: Set<EsmJob>,
): Promise<void> {
  if (seen.has(job)) return;
  seen.add(job);
  observeAsyncJob(graph, job);
  await job.preparedPromise;
  if (job.phase === 'errored') throw job.error;
  for (const dependency of job.prepared?.dependencies ?? []) {
    if (dependency.resolved.kind !== 'esm') continue;
    const record = deps.registry.get(dependency.resolved.id);
    const child = record ? currentJob(record, deps) : undefined;
    if (!child) {
      throw new ModuleLoadError(
        'MODULE_NOT_FOUND',
        dependency.specifier,
        `Linked ESM job disappeared during preparation: ${dependency.resolved.id}`,
        job.resolved.id,
      );
    }
    await awaitPreparedClosure(child, deps, graph, seen);
  }
}

async function runAsyncGraph(root: EsmJob, deps: EsmLoaderDeps): Promise<void> {
  const graph: AsyncGraph = {
    token: Symbol(root.resolved.id),
    owned: new Set([root]),
    observed: new Set(),
    visiting: new Set(),
  };
  root.asyncOwner = graph.token;
  observeAsyncJob(graph, root);
  let crossedAsyncBoundary = false;
  try {
    const sourceOrPromise = transformedSource(root.resolved, deps);
    crossedAsyncBoundary = typeof sourceOrPromise !== 'string';
    const source = typeof sourceOrPromise === 'string' ? sourceOrPromise : await sourceOrPromise;
    root.prepared = finishPreparation(root.resolved, deps, source, 'async');
    predeclareLinkedExports(root);
    rebuildExports(root.record);
    root.phase = 'prepared';
    settlePreparationSuccess(root);

    const childPreparations: Promise<void>[] = [];
    for (const dependency of root.prepared.dependencies) {
      if (dependency.resolved.kind !== 'esm') continue;
      const found = getOrCreateDependencyJob(dependency.resolved, deps, 'async');
      observeAsyncJob(graph, found.job);
      unionEvaluationGroups(root, found.job);
      if (
        found.created ||
        (found.job.phase === 'preparing' &&
          found.job.mode === 'async' &&
          found.job.asyncOwner === undefined)
      ) {
        found.job.asyncOwner = graph.token;
        graph.owned.add(found.job);
      }
      if (graph.owned.has(found.job)) {
        childPreparations.push(prepareAsyncGraph(found.job, deps, graph));
      }
    }
    if (childPreparations.length > 0) {
      crossedAsyncBoundary = true;
      await Promise.all(childPreparations);
    }

    const closureWaits: Promise<void>[] = [];
    const seen = new Set<EsmJob>([root]);
    for (const dependency of root.prepared.dependencies) {
      if (dependency.resolved.kind !== 'esm') continue;
      const record = deps.registry.get(dependency.resolved.id);
      const child = record ? currentJob(record, deps) : undefined;
      if (!child) {
        throw new ModuleLoadError(
          'MODULE_NOT_FOUND',
          dependency.specifier,
          `Linked ESM job disappeared during preparation: ${dependency.resolved.id}`,
          root.resolved.id,
        );
      }
      closureWaits.push(awaitPreparedClosure(child, deps, graph, seen));
    }
    if (closureWaits.length > 0) {
      crossedAsyncBoundary = true;
      await Promise.all(closureWaits);
    }
    linkPreparedGraph(root, deps);
    instantiateAsyncGraph(root, deps);
  } catch (error) {
    rollbackAsyncGraph(graph, deps, error);
    return;
  }
  try {
    if (!crossedAsyncBoundary) await Promise.resolve();
    await withEvaluationGroupLock(root, () => evaluatePreparedAsyncGraph(root, deps, graph));
  } finally {
    releaseAsyncGraph(graph);
  }
}

/** Import-side entry: one promise and one evaluation authority per ESM record. */
export function executeEsm(
  resolved: ResolvedModule,
  deps: EsmLoaderDeps,
): Promise<Record<string, unknown>> {
  const existing = deps.registry.get(resolved.id);
  if (existing) {
    const job = currentJob(existing, deps);
    if (job) return job.promise;
    if (existing.state === 'loaded') return Promise.resolve(existing.exports);
    if (existing.state === 'errored') return Promise.reject(existing.error);
  }
  const record = existing ?? deps.registry.getOrCreate(resolved.id, 'esm');
  const job = createEsmJob(record, resolved, 'async');
  void runAsyncGraph(job, deps);
  return job.promise;
}

/** Node 24 synchronous require(ESM) entry. */
export function requireEsm(resolved: ResolvedModule, deps: EsmLoaderDeps): unknown {
  if (transformedLoaderForId(resolved.id)) throw syncTransformCeiling(resolved.id);
  const existing = deps.registry.get(resolved.id);
  if (existing) {
    const job = currentJob(existing, deps);
    if (job) {
      if (job.phase === 'loaded') {
        const ceiling = graphHasTransformCeiling(job, deps, new Set());
        if (ceiling) throw syncTransformCeiling(ceiling);
        if (graphHasTopLevelAwait(job, deps, new Set())) throw requireAsyncModuleError(resolved.id);
        return requireResult(job);
      }
      if (job.phase === 'errored') {
        if (graphHasTopLevelAwait(job, deps, new Set())) throw requireAsyncModuleError(resolved.id);
        throw job.error;
      }
      if (graphHasTopLevelAwait(job, deps, new Set())) throw requireAsyncModuleError(resolved.id);
      if (isActivelyEvaluating(job) || job.mode === 'sync') throw requireCycleError(resolved.id);
      throw requireRaceError(resolved.id);
    }
    if (existing.kind !== 'esm' && existing.state === 'loading') {
      throw requireCycleError(resolved.id);
    }
    if (existing.state === 'loaded') return existing.exports;
    if (existing.state === 'errored') throw existing.error;
  }

  const record = existing ?? deps.registry.getOrCreate(resolved.id, 'esm');
  const root = createEsmJob(record, resolved, 'sync');
  const graph: SyncGraph = { owned: new Set([root]), visiting: new Set() };
  try {
    prepareSyncGraph(root, deps, graph);
    linkPreparedGraph(root, deps);
  } catch (error) {
    rollbackJobs(graph.owned, deps, error);
    throw error;
  }
  const ceiling = graphHasTransformCeiling(root, deps, new Set());
  if (ceiling) {
    const error = syncTransformCeiling(ceiling);
    rollbackJobs(graph.owned, deps, error);
    throw error;
  }
  if (graphHasTopLevelAwait(root, deps, new Set())) {
    const error = requireAsyncModuleError(resolved.id);
    rollbackJobs(graph.owned, deps, error);
    throw error;
  }
  instantiateSyncGraph(root, deps);
  evaluateSyncJob(root, deps, new Set());
  return requireResult(root);
}
