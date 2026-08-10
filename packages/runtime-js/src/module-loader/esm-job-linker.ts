import { NotImplementedError } from '@riftydev/io';
import { currentJob, rebuildExports } from './esm-job-state.ts';
import {
  AMBIGUOUS_EXPORT,
  type EsmJob,
  type EsmLoaderDeps,
  type PreparedDependency,
  UNINITIALIZED_EXPORT,
} from './esm-job-types.ts';

export function predeclareLinkedExports(job: EsmJob): void {
  const linked = job.prepared?.transformed.linkedExports;
  if (!linked) return;
  for (const name of linked.explicitNames) {
    if (Object.prototype.hasOwnProperty.call(job.record.slots, name)) continue;
    Object.defineProperty(job.record.slots, name, {
      value: UNINITIALIZED_EXPORT,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
}

function linkedDependencyJob(
  job: EsmJob,
  specifier: string,
  deps: EsmLoaderDeps,
): EsmJob | undefined {
  const dependency = job.prepared?.dependencies.find(
    (candidate) => candidate.specifier === specifier,
  );
  if (!dependency || dependency.resolved.kind !== 'esm') return undefined;
  const record = deps.registry.get(dependency.resolved.id);
  return record ? currentJob(record, deps) : undefined;
}

function preparedDependency(job: EsmJob, specifier: string): PreparedDependency | undefined {
  return job.prepared?.dependencies.find((candidate) => candidate.specifier === specifier);
}

function staticNamesCeiling(importer: EsmJob, dependency: PreparedDependency): NotImplementedError {
  return new NotImplementedError(
    'module-loader.cjs-static-named-exports',
    `Cannot determine the static named exports of ${dependency.resolved.id} imported by ${importer.resolved.id}`,
  );
}

export function collectLinkedJobs(
  job: EsmJob,
  deps: EsmLoaderDeps,
  seen: Set<EsmJob>,
  out: EsmJob[],
): void {
  if (seen.has(job)) return;
  seen.add(job);
  out.push(job);
  for (const dependency of job.prepared?.dependencies ?? []) {
    if (dependency.resolved.kind !== 'esm') continue;
    const record = deps.registry.get(dependency.resolved.id);
    const child = record ? currentJob(record, deps) : undefined;
    if (child) collectLinkedJobs(child, deps, seen, out);
  }
}

type LinkedExportResolution = string | typeof AMBIGUOUS_EXPORT | null;

function resolveNonEsmExport(
  job: EsmJob,
  specifier: string,
  name: string,
  deps: EsmLoaderDeps,
): LinkedExportResolution {
  const dependency = preparedDependency(job, specifier);
  if (!dependency || dependency.resolved.kind === 'esm') return null;
  if (name === '*') return `namespace:${dependency.resolved.id}`;
  if (name === 'default') return `non-esm:${dependency.resolved.id}:default`;
  const names = deps.staticImportNames(dependency.resolved);
  if (names === null) throw staticNamesCeiling(job, dependency);
  return names.has(name) ? `non-esm:${dependency.resolved.id}:${name}` : null;
}

function primeNonEsmNamespace(
  job: EsmJob,
  specifier: string,
  deps: EsmLoaderDeps,
): Record<string, unknown> | undefined {
  const dependency = preparedDependency(job, specifier);
  if (!dependency || dependency.resolved.kind === 'esm') return undefined;
  return deps.primeSyncImport(dependency.resolved);
}

function resolveLinkedExport(
  job: EsmJob,
  name: string,
  deps: EsmLoaderDeps,
  resolving: Set<string>,
): LinkedExportResolution {
  const key = `${job.record.id}\0${name}`;
  if (resolving.has(key)) return null;
  const nextResolving = new Set(resolving).add(key);
  const linked = job.prepared?.transformed.linkedExports;
  if (!linked) return null;

  const local = linked.localExports.find((candidate) => candidate.exported === name);
  if (local) {
    const imported = linked.importBindings.find((candidate) => candidate.local === local.local);
    if (!imported) return `local:${job.record.id}:${local.local}`;
    const child = linkedDependencyJob(job, imported.specifier, deps);
    if (!child) return resolveNonEsmExport(job, imported.specifier, imported.imported, deps);
    return imported.imported === '*'
      ? `namespace:${child.record.id}`
      : resolveLinkedExport(child, imported.imported, deps, nextResolving);
  }

  const named = linked.namedReexports.find((candidate) => candidate.exported === name);
  if (named) {
    const child = linkedDependencyJob(job, named.specifier, deps);
    return child
      ? resolveLinkedExport(child, named.imported, deps, nextResolving)
      : resolveNonEsmExport(job, named.specifier, named.imported, deps);
  }

  const namespace = linked.namespaceReexports.find((candidate) => candidate.exported === name);
  if (namespace) {
    const child = linkedDependencyJob(job, namespace.specifier, deps);
    return child
      ? `namespace:${child.record.id}`
      : resolveNonEsmExport(job, namespace.specifier, '*', deps);
  }

  if (linked.explicitNames.has(name) || name === 'default') return null;
  let starResolution: LinkedExportResolution = null;
  for (const specifier of linked.starSpecifiers) {
    const child = linkedDependencyJob(job, specifier, deps);
    const resolution = child
      ? resolveLinkedExport(child, name, deps, nextResolving)
      : resolveNonEsmExport(job, specifier, name, deps);
    if (resolution === AMBIGUOUS_EXPORT) return AMBIGUOUS_EXPORT;
    if (resolution === null) continue;
    if (starResolution === null) starResolution = resolution;
    else if (starResolution !== resolution) return AMBIGUOUS_EXPORT;
  }
  return starResolution;
}

function linkedExportSyntaxError(
  importer: EsmJob,
  imported: string,
  sourceId: string,
): SyntaxError {
  return new SyntaxError(
    `The requested module '${sourceId}' does not provide an export named '${imported}' (imported by ${importer.record.id})`,
  );
}

function linkedExportCandidates(jobs: readonly EsmJob[], deps: EsmLoaderDeps) {
  const candidates = new Map<EsmJob, Set<string>>();
  for (const job of jobs) {
    candidates.set(job, new Set(job.prepared?.transformed.linkedExports.explicitNames ?? []));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const job of jobs) {
      const own = candidates.get(job);
      const linked = job.prepared?.transformed.linkedExports;
      if (!own || !linked) continue;
      for (const specifier of linked.starSpecifiers) {
        const child = linkedDependencyJob(job, specifier, deps);
        let childNames: ReadonlySet<string> | undefined = child ? candidates.get(child) : undefined;
        if (!childNames) {
          const dependency = preparedDependency(job, specifier);
          if (!dependency || dependency.resolved.kind === 'esm') continue;
          const names = deps.staticImportNames(dependency.resolved);
          if (names === null) throw staticNamesCeiling(job, dependency);
          childNames = names;
        }
        if (!childNames) continue;
        for (const name of childNames) {
          if (name === 'default' || own.has(name)) continue;
          own.add(name);
          changed = true;
        }
      }
    }
  }
  return candidates;
}

/** Resolve and publish the complete export-name graph before any body executes. */
export function linkPreparedGraph(root: EsmJob, deps: EsmLoaderDeps): void {
  const jobs: EsmJob[] = [];
  collectLinkedJobs(root, deps, new Set(), jobs);
  const candidates = linkedExportCandidates(jobs, deps);

  for (const job of jobs) predeclareLinkedExports(job);

  for (const job of jobs) {
    const linked = job.prepared?.transformed.linkedExports;
    if (!linked) continue;

    for (const requirement of linked.importRequirements) {
      const child = linkedDependencyJob(job, requirement.specifier, deps);
      const dependency = preparedDependency(job, requirement.specifier);
      const resolution = child
        ? resolveLinkedExport(child, requirement.imported, deps, new Set())
        : resolveNonEsmExport(job, requirement.specifier, requirement.imported, deps);
      if (resolution === null || resolution === AMBIGUOUS_EXPORT) {
        throw linkedExportSyntaxError(
          job,
          requirement.imported,
          child?.record.id ?? dependency?.resolved.id ?? requirement.specifier,
        );
      }
    }

    for (const local of linked.localExports) {
      const imported = linked.importBindings.find((candidate) => candidate.local === local.local);
      if (!imported) continue;
      const child = linkedDependencyJob(job, imported.specifier, deps);
      const nonEsmNamespace = child
        ? undefined
        : primeNonEsmNamespace(job, imported.specifier, deps);
      if (!child && !nonEsmNamespace) continue;
      Object.defineProperty(job.record.slots, local.exported, {
        configurable: true,
        enumerable: true,
        get: () =>
          imported.imported === '*'
            ? (child?.record.exports ?? nonEsmNamespace)
            : (child?.record.exports ?? nonEsmNamespace)?.[imported.imported],
      });
    }

    for (const reexport of linked.namedReexports) {
      const child = linkedDependencyJob(job, reexport.specifier, deps);
      const dependency = preparedDependency(job, reexport.specifier);
      const resolution = child
        ? resolveLinkedExport(child, reexport.imported, deps, new Set())
        : resolveNonEsmExport(job, reexport.specifier, reexport.imported, deps);
      if (resolution === null || resolution === AMBIGUOUS_EXPORT) {
        throw linkedExportSyntaxError(
          job,
          reexport.imported,
          child?.record.id ?? dependency?.resolved.id ?? reexport.specifier,
        );
      }
      const nonEsmNamespace = child
        ? undefined
        : primeNonEsmNamespace(job, reexport.specifier, deps);
      if (!child && !nonEsmNamespace) continue;
      Object.defineProperty(job.record.slots, reexport.exported, {
        configurable: true,
        enumerable: true,
        get: () => (child?.record.exports ?? nonEsmNamespace)?.[reexport.imported],
      });
    }

    for (const reexport of linked.namespaceReexports) {
      const child = linkedDependencyJob(job, reexport.specifier, deps);
      const nonEsmNamespace = child
        ? undefined
        : primeNonEsmNamespace(job, reexport.specifier, deps);
      if (!child && !nonEsmNamespace) continue;
      Object.defineProperty(job.record.slots, reexport.exported, {
        configurable: true,
        enumerable: true,
        get: () => child?.record.exports ?? nonEsmNamespace,
      });
    }

    for (const name of candidates.get(job) ?? []) {
      if (linked.explicitNames.has(name)) continue;
      const resolution = resolveLinkedExport(job, name, deps, new Set());
      if (resolution === null) continue;
      Reflect.deleteProperty(job.record.slots, name);
      if (resolution === AMBIGUOUS_EXPORT) {
        Object.defineProperty(job.record.slots, name, {
          value: AMBIGUOUS_EXPORT,
          configurable: true,
        });
        continue;
      }
      const source = linked.starSpecifiers
        .map((specifier) => linkedDependencyJob(job, specifier, deps))
        .find((child) => child && resolveLinkedExport(child, name, deps, new Set()) === resolution);
      if (source) {
        Object.defineProperty(job.record.slots, name, {
          configurable: true,
          enumerable: true,
          get: () => source.record.exports[name],
        });
        continue;
      }
      const nonEsmSpecifier = linked.starSpecifiers.find(
        (specifier) => resolveNonEsmExport(job, specifier, name, deps) === resolution,
      );
      if (!nonEsmSpecifier) continue;
      const namespace = primeNonEsmNamespace(job, nonEsmSpecifier, deps);
      if (!namespace) continue;
      Object.defineProperty(job.record.slots, name, {
        configurable: true,
        enumerable: true,
        get: () => namespace[name],
      });
    }
    rebuildExports(job.record);
  }
}
