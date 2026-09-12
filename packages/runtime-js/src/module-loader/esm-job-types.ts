import type { TransformResult } from './esm-ast.ts';
import type { ModuleRecord, ModuleRegistry } from './registry.ts';
import type { ResolvedModule, Resolver } from './resolver.ts';
import type { SourceMapRegistry } from './source-maps.ts';

/**
 * Per-file TS/TSX/JSX transform executed before the ESM AST rewrite. The
 * request shape is the public injection contract (ADR-0052/0316).
 */
export type TransformSourceHook = (req: {
  readonly source: string;
  readonly id: string;
  readonly loader: 'ts' | 'tsx' | 'jsx';
  readonly workspace: string;
}) => Promise<string>;

export interface EsmLoaderDeps {
  readonly registry: ModuleRegistry;
  readonly resolver: Resolver;
  loadAsync(id: string): Promise<Record<string, unknown>>;
  loadAsyncResolved(resolved: ResolvedModule): Promise<Record<string, unknown>>;
  staticImportNames(resolved: ResolvedModule): ReadonlySet<string> | null;
  primeSyncImport(resolved: ResolvedModule): Record<string, unknown>;
  loadSyncForImport(resolved: ResolvedModule): Record<string, unknown>;
  resolve(specifier: string, fromFile: string, esm: boolean): ResolvedModule;
  readonly workspace: string;
  readonly sourceMaps?: SourceMapRegistry;
  readonly transformSource?: TransformSourceHook;
  readonly transformEsm?: (source: string, id: string) => TransformResult;
  readonly WebAssembly: typeof WebAssembly;
}

export interface EsmEvaluationIterator {
  next(): IteratorResult<unknown> | Promise<IteratorResult<unknown>>;
}

export type EsmFactory = (
  importer: (s: unknown) => Promise<Record<string, unknown>>,
  importStatic: (s: string) => Record<string, unknown>,
  slots: Record<string, unknown>,
  resolveStatic: (s: string) => Record<string, unknown>,
  rebuild: () => void,
  importMetaUrl: string,
  metaDirname: string,
  metaFilename: string,
  assetPath: (s: string) => string,
  metaResolve: (s: string) => string,
  Function: FunctionConstructor,
  webAssembly: typeof WebAssembly,
) => EsmEvaluationIterator;

export type EsmDirectFactory = (...args: Parameters<EsmFactory>) => Promise<void>;

export interface PreparedDependency {
  readonly specifier: string;
  readonly resolved: ResolvedModule;
}

export interface PreparedEsm {
  readonly resolved: ResolvedModule;
  readonly transformed: TransformResult;
  readonly dependencies: readonly PreparedDependency[];
  readonly factory?: EsmFactory;
  readonly directFactory?: EsmDirectFactory;
}

export type EsmJobPhase = 'preparing' | 'prepared' | 'evaluating' | 'loaded' | 'errored';

export interface AsyncEvaluationGroup {
  parent?: AsyncEvaluationGroup;
  tail: Promise<void>;
  pendingLocks: number;
}

export interface EsmJob {
  readonly record: ModuleRecord;
  readonly resolved: ResolvedModule;
  readonly mode: 'async' | 'sync';
  phase: EsmJobPhase;
  prepared?: PreparedEsm;
  error?: unknown;
  requireResult?: unknown;
  hasRequireResult: boolean;
  readonly promise: Promise<Record<string, unknown>>;
  readonly resolvePromise: (namespace: Record<string, unknown>) => void;
  readonly rejectPromise: (error: unknown) => void;
  settled: boolean;
  asyncOwner?: symbol;
  readonly preparedPromise: Promise<void>;
  readonly resolvePrepared: () => void;
  readonly rejectPrepared: (error: unknown) => void;
  preparationSettled: boolean;
  evaluationGroup?: AsyncEvaluationGroup;
  asyncObservers?: Set<symbol>;
  evaluationIterator?: EsmEvaluationIterator;
  importNamespaces?: Map<string, Record<string, unknown>>;
  suspended: boolean;
  generatorStepActive: boolean;
}

export interface AsyncGraph {
  readonly token: symbol;
  readonly owned: Set<EsmJob>;
  readonly observed: Set<EsmJob>;
  readonly visiting: Set<EsmJob>;
}

export interface SyncGraph {
  readonly owned: Set<EsmJob>;
  readonly visiting: Set<EsmJob>;
}

// V8's `new Function` wrapper puts the guest body four lines below its frame.
// TODO(backlog: runtime-js/worker-stack-remap-error-overlay)
export const ESM_STACK_LINE_OFFSET = 4;
export const UNINITIALIZED_EXPORT = Symbol('rifty.esm.uninitialized-export');
export const AMBIGUOUS_EXPORT = Symbol('rifty.esm.ambiguous-export');
