import { dirname } from '@riftydev/vfs';
import { ref as keepaliveRef, unref as keepaliveUnref } from '../internal/event-loop-keepalive.ts';
import { fileURLFromResolvedPath } from '../internal/posix-file-url.ts';
import { hasURLScheme } from '../internal/url-scheme.ts';
import { ModuleLoadError } from './errors.ts';
import { collectLinkedJobs } from './esm-job-linker.ts';
import {
  currentJob,
  failEvaluation,
  finishEvaluation,
  markJobSuspended,
  rebuildExports,
  requireAsyncModuleError,
  requireCycleError,
  withActiveEvaluation,
} from './esm-job-state.ts';
import {
  AMBIGUOUS_EXPORT,
  ESM_STACK_LINE_OFFSET,
  type EsmFactory,
  type EsmJob,
  type EsmLoaderDeps,
  type PreparedEsm,
} from './esm-job-types.ts';
import { createFunctionImportRouting } from './function-import-routing.ts';
import { withStackRemapping } from './source-maps.ts';

export function evaluateAsyncJob(
  job: EsmJob,
  deps: EsmLoaderDeps,
  stack: Set<EsmJob>,
): Promise<Record<string, unknown>> {
  if (job.phase === 'loaded') return Promise.resolve(job.record.exports);
  if (job.phase === 'errored') return Promise.reject(job.error);
  if (job.phase === 'evaluating') {
    if (stack.has(job)) return Promise.resolve(job.record.exports);
    return job.promise;
  }
  const prepared = job.prepared;
  if (!prepared || (!prepared.factory && !prepared.directFactory)) {
    return Promise.reject(
      new Error(`ESM job was not prepared for async evaluation: ${job.resolved.id}`),
    );
  }

  job.phase = 'evaluating';
  stack.add(job);
  const importNamespaces = job.importNamespaces ?? new Map<string, Record<string, unknown>>();
  job.importNamespaces = importNamespaces;
  try {
    const suspendedDependencies: Promise<void>[] = [];
    for (const dependency of prepared.dependencies) {
      if (dependency.resolved.kind === 'esm') {
        const record = deps.registry.get(dependency.resolved.id);
        const child = record ? currentJob(record, deps) : undefined;
        if (!child) throw new Error(`Linked ESM job disappeared: ${dependency.resolved.id}`);
        if (child.phase === 'evaluating' && stack.has(child)) {
          publishImportNamespace(job, dependency.specifier, child.record.exports);
          continue;
        }
        const pending = evaluateAsyncJob(child, deps, new Set(stack));
        if (child.phase === 'loaded') {
          publishImportNamespace(job, dependency.specifier, child.record.exports);
          continue;
        }
        if (child.phase === 'errored') {
          void pending.catch(() => undefined);
          throw child.error;
        }
        markJobSuspended(job);
        suspendedDependencies.push(
          pending.then((namespace) => {
            publishImportNamespace(job, dependency.specifier, namespace);
          }),
        );
      } else {
        const namespace = withActiveEvaluation(job, () =>
          deps.loadSyncForImport(dependency.resolved),
        );
        publishImportNamespace(job, dependency.specifier, namespace);
      }
    }

    const evaluateBody = (): Record<string, unknown> | Promise<Record<string, unknown>> => {
      resolveOpaqueStarExports(job, prepared, importNamespaces);
      const invocation = invokeAsyncFactory(job, prepared, deps, importNamespaces);
      if (invocation instanceof Promise) {
        markJobSuspended(job);
        return invocation.then(
          () => finishEvaluation(job),
          (error: unknown) => {
            failEvaluation(job, error);
            throw error;
          },
        );
      }
      return finishEvaluation(job);
    };

    if (suspendedDependencies.length > 0) {
      return Promise.all(suspendedDependencies)
        .then(evaluateBody)
        .catch((error: unknown) => {
          if (job.phase !== 'errored') failEvaluation(job, error);
          throw error;
        });
    }
    const result = evaluateBody();
    return result instanceof Promise ? result : Promise.resolve(result);
  } catch (error) {
    failEvaluation(job, error);
    return Promise.reject(error);
  } finally {
    stack.delete(job);
  }
}

export function evaluateSyncJob(
  job: EsmJob,
  deps: EsmLoaderDeps,
  stack: Set<EsmJob>,
): Record<string, unknown> {
  if (job.phase === 'loaded') return job.record.exports;
  if (job.phase === 'errored') throw job.error;
  if (job.phase === 'evaluating') return job.record.exports;
  const prepared = job.prepared;
  if (!prepared?.factory) throw requireAsyncModuleError(job.resolved.id);

  job.phase = 'evaluating';
  stack.add(job);
  const importNamespaces = job.importNamespaces ?? new Map<string, Record<string, unknown>>();
  job.importNamespaces = importNamespaces;
  try {
    for (const dependency of prepared.dependencies) {
      let namespace: Record<string, unknown>;
      if (dependency.resolved.kind === 'esm') {
        const record = deps.registry.get(dependency.resolved.id);
        const child = record ? currentJob(record, deps) : undefined;
        if (!child) throw new Error(`Linked ESM job disappeared: ${dependency.resolved.id}`);
        namespace = evaluateSyncJob(child, deps, stack);
      } else {
        const record = deps.registry.get(dependency.resolved.id);
        if (record?.state === 'loading' && record.kind !== 'esm') {
          throw requireCycleError(dependency.resolved.id);
        }
        namespace = withActiveEvaluation(job, () => deps.loadSyncForImport(dependency.resolved));
      }
      publishImportNamespace(job, dependency.specifier, namespace);
    }
    resolveOpaqueStarExports(job, prepared, importNamespaces);
    invokeSyncFactory(job, prepared);
    return finishEvaluation(job);
  } catch (error) {
    failEvaluation(job, error);
    throw error;
  } finally {
    stack.delete(job);
  }
}

function primeImportNamespaces(job: EsmJob, deps: EsmLoaderDeps): void {
  const namespaces = job.importNamespaces ?? new Map<string, Record<string, unknown>>();
  job.importNamespaces = namespaces;
  for (const dependency of job.prepared?.dependencies ?? []) {
    if (namespaces.has(dependency.specifier)) continue;
    if (dependency.resolved.kind === 'esm') {
      const record = deps.registry.get(dependency.resolved.id);
      if (record) namespaces.set(dependency.specifier, record.exports);
      continue;
    }
    namespaces.set(dependency.specifier, deps.primeSyncImport(dependency.resolved));
  }
}

function publishImportNamespace(
  job: EsmJob,
  specifier: string,
  namespace: Record<string, unknown>,
): void {
  job.importNamespaces?.set(specifier, namespace);
}

function resolveOpaqueStarExports(
  job: EsmJob,
  prepared: PreparedEsm,
  importNamespaces: ReadonlyMap<string, Record<string, unknown>>,
): void {
  const linked = prepared.transformed.linkedExports;
  const origins = new Map<string, Record<string, unknown> | null>();
  for (const specifier of linked.starSpecifiers) {
    const dependency = prepared.dependencies.find((candidate) => candidate.specifier === specifier);
    if (!dependency || dependency.resolved.kind === 'esm') continue;
    const namespace = importNamespaces.get(specifier);
    if (!namespace) continue;
    for (const name of Object.keys(namespace)) {
      if (name === 'default' || linked.explicitNames.has(name)) continue;
      if (origins.has(name)) {
        if (origins.get(name) === namespace) continue;
        origins.set(name, null);
        Reflect.deleteProperty(job.record.slots, name);
        Object.defineProperty(job.record.slots, name, {
          value: AMBIGUOUS_EXPORT,
          configurable: true,
        });
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(job.record.slots, name)) continue;
      origins.set(name, namespace);
      Object.defineProperty(job.record.slots, name, {
        configurable: true,
        enumerable: true,
        get: () => namespace[name],
      });
    }
  }
  if (origins.size > 0) rebuildExports(job.record);
}

function factoryArguments(
  job: EsmJob,
  prepared: PreparedEsm,
  deps: EsmLoaderDeps,
  importNamespaces: ReadonlyMap<string, Record<string, unknown>>,
): Parameters<EsmFactory> {
  const resolved = prepared.resolved;
  const importStatic = (specifier: string): Record<string, unknown> => {
    const namespace = importNamespaces.get(specifier);
    if (!namespace) {
      throw new ModuleLoadError(
        'MODULE_NOT_FOUND',
        specifier,
        `Static import was not preloaded: ${specifier}`,
        resolved.id,
      );
    }
    return namespace;
  };
  const dynamicImport = async (specifier: unknown): Promise<Record<string, unknown>> => {
    keepaliveRef();
    try {
      const dependency = deps.resolve(toDynamicImportSpecifier(specifier), resolved.id, true);
      return await deps.loadAsyncResolved(dependency);
    } finally {
      keepaliveUnref();
    }
  };
  const assetPath = (specifier: string): string => deps.resolve(specifier, resolved.id, true).id;
  const metaResolve = (specifier: string): string => {
    if (hasURLScheme(specifier, 'node')) return specifier;
    const dependency = deps.resolve(specifier, resolved.id, true);
    return dependency.kind === 'builtin'
      ? dependency.id
      : fileURLFromResolvedPath(dependency.id).href;
  };
  const routedConstructors = createFunctionImportRouting(dynamicImport, resolved.id);
  return [
    dynamicImport,
    importStatic,
    job.record.slots,
    importStatic,
    () => rebuildExports(job.record),
    fileURLFromResolvedPath(resolved.id).href,
    dirname(resolved.id),
    resolved.id,
    assetPath,
    metaResolve,
    routedConstructors.Function,
  ];
}

function instantiateSyncJob(job: EsmJob, deps: EsmLoaderDeps): void {
  if (job.evaluationIterator || job.phase === 'loaded') return;
  const prepared = job.prepared;
  const factory = prepared?.factory;
  if (!prepared || !factory) throw requireAsyncModuleError(job.resolved.id);
  primeImportNamespaces(job, deps);
  const importNamespaces = job.importNamespaces;
  if (!importNamespaces) throw new Error(`Missing import namespaces: ${job.resolved.id}`);
  const iterator = factory(...factoryArguments(job, prepared, deps, importNamespaces));
  const first = iterator.next();
  if (first instanceof Promise) {
    throw new Error(`Internal: synchronous ESM instantiation suspended for ${job.resolved.id}`);
  }
  if (first.done) {
    throw new Error(`Internal: ESM instantiation did not yield for ${job.resolved.id}`);
  }
  job.evaluationIterator = iterator;
  rebuildExports(job.record);
}

function instantiateAsyncJob(job: EsmJob, deps: EsmLoaderDeps): void {
  if (job.evaluationIterator || job.phase === 'loaded') return;
  const prepared = job.prepared;
  const factory = prepared?.factory;
  if (!prepared || (!factory && !prepared.directFactory)) {
    throw new Error(`Missing async ESM factory: ${job.resolved.id}`);
  }
  primeImportNamespaces(job, deps);
  const importNamespaces = job.importNamespaces;
  if (!importNamespaces) throw new Error(`Missing import namespaces: ${job.resolved.id}`);
  if (!factory) {
    rebuildExports(job.record);
    return;
  }
  const iterator = factory(...factoryArguments(job, prepared, deps, importNamespaces));
  const firstOrPromise = iterator.next();
  if (firstOrPromise instanceof Promise) {
    void firstOrPromise
      .then((first) => {
        if (first.done) {
          throw new Error(`Internal: ESM instantiation did not yield for ${job.resolved.id}`);
        }
      })
      .catch(() => undefined);
  } else if (firstOrPromise.done) {
    throw new Error(`Internal: ESM instantiation did not yield for ${job.resolved.id}`);
  }
  job.evaluationIterator = iterator;
  rebuildExports(job.record);
}

export function instantiateSyncGraph(root: EsmJob, deps: EsmLoaderDeps): void {
  const jobs: EsmJob[] = [];
  collectLinkedJobs(root, deps, new Set(), jobs);
  for (const job of jobs) instantiateSyncJob(job, deps);
}

export function instantiateAsyncGraph(root: EsmJob, deps: EsmLoaderDeps): void {
  const jobs: EsmJob[] = [];
  collectLinkedJobs(root, deps, new Set(), jobs);
  for (const job of jobs) instantiateAsyncJob(job, deps);
}

function invokeAsyncFactory(
  job: EsmJob,
  prepared: PreparedEsm,
  deps: EsmLoaderDeps,
  importNamespaces: ReadonlyMap<string, Record<string, unknown>>,
): void | Promise<void> {
  const directFactory = prepared.directFactory;
  if (directFactory) {
    job.generatorStepActive = true;
    return withStackRemapping(
      deps.sourceMaps,
      prepared.resolved.id,
      ESM_STACK_LINE_OFFSET,
      async () => {
        await directFactory(...factoryArguments(job, prepared, deps, importNamespaces));
      },
    ).finally(() => {
      job.generatorStepActive = false;
    });
  }
  const iterator = job.evaluationIterator;
  if (!iterator) throw new Error(`Missing async ESM iterator: ${prepared.resolved.id}`);
  job.generatorStepActive = true;
  if (prepared.transformed.hasTopLevelAwait) {
    return withStackRemapping(
      deps.sourceMaps,
      prepared.resolved.id,
      ESM_STACK_LINE_OFFSET,
      async () => {
        const result = await iterator.next();
        if (!result.done) throw new Error(`Unexpected extra ESM yield: ${prepared.resolved.id}`);
      },
    ).finally(() => {
      job.generatorStepActive = false;
    });
  }
  let threw = false;
  let thrown: unknown;
  try {
    const remapping = withStackRemapping(
      deps.sourceMaps,
      prepared.resolved.id,
      ESM_STACK_LINE_OFFSET,
      async () => {
        try {
          const result = withActiveEvaluation(job, () => iterator.next());
          if (result instanceof Promise) {
            throw new Error(`Unexpected async ESM iterator: ${prepared.resolved.id}`);
          }
          if (!result.done) throw new Error(`Unexpected extra ESM yield: ${prepared.resolved.id}`);
        } catch (error) {
          threw = true;
          thrown = error;
          throw error;
        }
      },
    );
    void remapping.catch(() => undefined);
    if (threw) {
      if (thrown instanceof Error && thrown.stack && deps.sourceMaps?.has(prepared.resolved.id)) {
        thrown.stack = deps.sourceMaps.remapStack(
          thrown.stack,
          prepared.resolved.id,
          ESM_STACK_LINE_OFFSET,
        );
      }
      throw thrown;
    }
  } finally {
    job.generatorStepActive = false;
  }
}

function invokeSyncFactory(job: EsmJob, prepared: PreparedEsm): void {
  const iterator = job.evaluationIterator;
  if (!iterator) throw new Error(`Missing synchronous ESM iterator: ${prepared.resolved.id}`);
  const result = withActiveEvaluation(job, () => iterator.next());
  if (result instanceof Promise) {
    throw new Error(`Internal: synchronous ESM iterator suspended for ${prepared.resolved.id}`);
  }
  if (!result.done) throw new Error(`Unexpected extra ESM yield: ${prepared.resolved.id}`);
}

function toDynamicImportSpecifier(specifier: unknown): string {
  if (typeof specifier === 'symbol') {
    throw new TypeError('Cannot convert a Symbol value to a string');
  }
  return String(specifier);
}
