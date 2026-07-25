import { ClosedHandleError } from '../errors.ts';
import type {
  WorkbenchHealth,
  WorkbenchHealthIssue,
  WorkbenchHealthSnapshot,
  WorkbenchRecoveryScope,
} from '../health.ts';

type DegradedScope = Extract<WorkbenchHealthIssue, { readonly kind: 'degraded' }>['scope'];
type HealthListener = (snapshot: WorkbenchHealthSnapshot) => void;
type RecoveryHandler = () => Promise<void>;

interface GenerationState {
  readonly id: string;
  readonly listeners: Set<HealthListener>;
  closed: boolean;
}

interface IssueRecordBase {
  readonly recover: RecoveryHandler | undefined;
}

interface DegradedIssueRecord extends IssueRecordBase {
  readonly kind: 'degraded';
  readonly generation: GenerationState;
  readonly issue: Extract<WorkbenchHealthIssue, { readonly kind: 'degraded' }>;
}

interface OwnerIssueRecord extends IssueRecordBase {
  readonly kind: 'owner';
  readonly issue: Extract<WorkbenchHealthIssue, { readonly kind: 'unavailable' }>;
}

interface FatalIssueRecord extends IssueRecordBase {
  readonly kind: 'fatal';
  readonly issue: Extract<WorkbenchHealthIssue, { readonly kind: 'fatal' }>;
}

type RecoveryTarget = DegradedIssueRecord | OwnerIssueRecord | FatalIssueRecord;

interface RecoveryEntry {
  readonly target: RecoveryTarget;
  readonly promise: Promise<void>;
}

export interface WorkbenchHealthReporter {
  degraded(input: WorkbenchDegradedHealthInput): void;
  clear(scope: DegradedScope): void;
}

export interface WorkbenchDegradedHealthInput {
  readonly scope: DegradedScope;
  readonly summary: string;
  readonly recover?: RecoveryHandler;
}

export interface WorkbenchUnavailableHealthInput {
  readonly summary: string;
  readonly recover?: RecoveryHandler;
}

export interface WorkbenchFatalHealthInput {
  readonly summary: string;
  readonly recover?: RecoveryHandler;
}

export interface WorkbenchHealthGeneration {
  readonly health: WorkbenchHealth;
  readonly reporter: WorkbenchHealthReporter;
  close(): void;
}

export interface WorkbenchHealthAuthority {
  readonly health: WorkbenchHealth;
  readonly owner: {
    unavailable(input: WorkbenchUnavailableHealthInput): void;
    available(): void;
  };
  readonly invariant: {
    fatal(input: WorkbenchFatalHealthInput): void;
  };
  openGeneration(id: string): WorkbenchHealthGeneration;
  close(): void;
}

export interface WorkbenchHealthAuthorityOptions {
  readonly recover?: (scope: WorkbenchRecoveryScope) => Promise<void>;
}

const DEGRADED_SCOPE_ORDER = Object.freeze([
  'scm',
  'preview',
  'persistence',
] satisfies readonly DegradedScope[]);

function inspectSummary(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('Workbench health summary must be a non-empty string');
  }
  return value;
}

function inspectGenerationId(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Workbench health generation id must be a non-empty string');
  }
  return value;
}

function inspectRecoveryScope(value: WorkbenchRecoveryScope): WorkbenchRecoveryScope {
  if (value !== 'scm' && value !== 'preview' && value !== 'persistence' && value !== 'reload') {
    throw new TypeError('Invalid Workbench recovery scope');
  }
  return value;
}

function deliver(listener: HealthListener, snapshot: WorkbenchHealthSnapshot): void {
  try {
    listener(snapshot);
  } catch {
    // A host listener cannot suppress sibling state delivery.
  }
}

function rejected(error: unknown): Promise<never> {
  const promise = Promise.reject(error);
  void promise.catch(() => {});
  return promise;
}

export function createWorkbenchHealthAuthority(
  options: WorkbenchHealthAuthorityOptions = {},
): WorkbenchHealthAuthority {
  const degraded = new Map<DegradedScope, DegradedIssueRecord>();
  const globalListeners = new Set<HealthListener>();
  const recoveries = new Map<WorkbenchRecoveryScope, RecoveryEntry>();
  let ownerIssue: OwnerIssueRecord | null = null;
  let fatalIssue: FatalIssueRecord | null = null;
  let activeGeneration: GenerationState | null = null;
  let closed = false;

  const assertAuthorityOpen = (): void => {
    if (closed) throw new ClosedHandleError('Workbench health');
  };

  const assertGenerationOpen = (generation: GenerationState): void => {
    assertAuthorityOpen();
    if (generation.closed || activeGeneration !== generation) {
      throw new ClosedHandleError('Workbench health generation');
    }
  };

  const snapshotFor = (generation: GenerationState | null): WorkbenchHealthSnapshot => {
    const issues: WorkbenchHealthIssue[] = [];
    if (fatalIssue !== null) issues.push(fatalIssue.issue);
    if (ownerIssue !== null) issues.push(ownerIssue.issue);
    for (const scope of DEGRADED_SCOPE_ORDER) {
      const record = degraded.get(scope);
      if (record !== undefined && (generation === null || record.generation === generation)) {
        issues.push(record.issue);
      }
    }
    const disposition =
      fatalIssue !== null
        ? 'fatal'
        : ownerIssue !== null
          ? 'unavailable'
          : issues.length > 0
            ? 'degraded'
            : 'healthy';
    return Object.freeze({
      disposition,
      issues: Object.freeze(issues),
    });
  };

  const publish = (): void => {
    if (closed) return;
    const workbenchSnapshot = snapshotFor(null);
    for (const listener of [...globalListeners]) deliver(listener, workbenchSnapshot);
    const generation = activeGeneration;
    if (generation === null || generation.closed) return;
    const generationSnapshot = snapshotFor(generation);
    for (const listener of [...generation.listeners]) deliver(listener, generationSnapshot);
  };

  const subscribe = (
    listeners: Set<HealthListener>,
    generation: GenerationState | null,
    listener: HealthListener,
  ): (() => void) => {
    assertAuthorityOpen();
    if (generation !== null) assertGenerationOpen(generation);
    if (typeof listener !== 'function') {
      throw new TypeError('Workbench health listener must be a function');
    }
    listeners.add(listener);
    deliver(listener, snapshotFor(generation));
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      listeners.delete(listener);
    };
  };

  const recoveryTarget = (
    scope: WorkbenchRecoveryScope,
    generation: GenerationState | null,
  ): RecoveryTarget | null => {
    if (scope === 'reload') return fatalIssue ?? ownerIssue;
    const record = degraded.get(scope);
    if (record === undefined || (generation !== null && record.generation !== generation)) {
      return null;
    }
    return record;
  };

  const clearRecoveredTarget = (target: RecoveryTarget): void => {
    if (closed) return;
    let changed = false;
    if (target.kind === 'degraded') {
      if (degraded.get(target.issue.scope) === target) {
        degraded.delete(target.issue.scope);
        changed = true;
      }
    } else if (target.kind === 'owner' && ownerIssue === target) {
      ownerIssue = null;
      changed = true;
    }
    if (changed) publish();
  };

  const recover = (
    generation: GenerationState | null,
    candidateScope: WorkbenchRecoveryScope,
  ): Promise<void> => {
    try {
      assertAuthorityOpen();
      if (generation !== null) assertGenerationOpen(generation);
    } catch (error) {
      return rejected(error);
    }
    let scope: WorkbenchRecoveryScope;
    try {
      scope = inspectRecoveryScope(candidateScope);
    } catch (error) {
      return rejected(error);
    }
    const target = recoveryTarget(scope, generation);
    if (target === null) {
      return rejected(new Error(`Workbench recovery scope ${scope} is not active`));
    }
    const existing = recoveries.get(scope);
    if (existing?.target === target) return existing.promise;

    let resolve!: () => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    void promise.catch(() => {});
    const entry = Object.freeze({ target, promise });
    recoveries.set(scope, entry);

    const defaultRecovery = options.recover;
    const handler =
      target.recover ?? (defaultRecovery === undefined ? undefined : () => defaultRecovery(scope));
    if (handler === undefined) {
      if (recoveries.get(scope) === entry) recoveries.delete(scope);
      reject(new Error(`Workbench recovery scope ${scope} has no recovery operation`));
      return promise;
    }

    let operation: Promise<void>;
    try {
      operation = handler();
    } catch (error) {
      if (recoveries.get(scope) === entry) recoveries.delete(scope);
      reject(error);
      return promise;
    }
    void Promise.resolve(operation).then(
      () => {
        if (recoveries.get(scope) === entry) recoveries.delete(scope);
        clearRecoveredTarget(target);
        resolve();
      },
      (error: unknown) => {
        if (recoveries.get(scope) === entry) recoveries.delete(scope);
        reject(error);
      },
    );
    return promise;
  };

  const healthView = (generation: GenerationState | null): WorkbenchHealth =>
    Object.freeze({
      snapshot(): WorkbenchHealthSnapshot {
        assertAuthorityOpen();
        if (generation !== null) assertGenerationOpen(generation);
        return snapshotFor(generation);
      },
      subscribe(listener: HealthListener): () => void {
        return subscribe(generation?.listeners ?? globalListeners, generation, listener);
      },
      recover(scope: WorkbenchRecoveryScope): Promise<void> {
        return recover(generation, scope);
      },
    });

  const health = healthView(null);

  const openGeneration = (candidateId: string): WorkbenchHealthGeneration => {
    assertAuthorityOpen();
    const id = inspectGenerationId(candidateId);
    if (activeGeneration !== null) {
      throw new Error(`Workbench health generation ${activeGeneration.id} is still active`);
    }
    const generation: GenerationState = {
      id,
      listeners: new Set(),
      closed: false,
    };
    activeGeneration = generation;

    const assertReporterOpen = (): void => assertGenerationOpen(generation);
    const reporter: WorkbenchHealthReporter = Object.freeze({
      degraded(input: WorkbenchDegradedHealthInput): void {
        assertReporterOpen();
        const scope = input.scope;
        if (scope !== 'scm' && scope !== 'preview' && scope !== 'persistence') {
          throw new TypeError('Invalid degraded Workbench health scope');
        }
        const issue = Object.freeze({
          kind: 'degraded',
          scope,
          summary: inspectSummary(input.summary),
          recovery: scope,
        }) satisfies Extract<WorkbenchHealthIssue, { readonly kind: 'degraded' }>;
        degraded.set(
          scope,
          Object.freeze({
            kind: 'degraded',
            generation,
            issue,
            recover: input.recover,
          }),
        );
        publish();
      },
      clear(scope: DegradedScope): void {
        assertReporterOpen();
        const record = degraded.get(scope);
        if (record?.generation !== generation) return;
        degraded.delete(scope);
        publish();
      },
    });

    const close = (): void => {
      if (generation.closed) return;
      generation.closed = true;
      if (activeGeneration === generation) activeGeneration = null;
      let changed = false;
      for (const scope of DEGRADED_SCOPE_ORDER) {
        if (degraded.get(scope)?.generation !== generation) continue;
        degraded.delete(scope);
        changed = true;
      }
      generation.listeners.clear();
      if (changed) publish();
    };

    return Object.freeze({
      health: healthView(generation),
      reporter,
      close,
    });
  };

  return Object.freeze({
    health,
    owner: Object.freeze({
      unavailable(input: WorkbenchUnavailableHealthInput): void {
        assertAuthorityOpen();
        ownerIssue = Object.freeze({
          kind: 'owner',
          issue: Object.freeze({
            kind: 'unavailable',
            scope: 'owner',
            summary: inspectSummary(input.summary),
            recovery: 'reload',
          }),
          recover: input.recover,
        });
        publish();
      },
      available(): void {
        assertAuthorityOpen();
        if (ownerIssue === null) return;
        ownerIssue = null;
        publish();
      },
    }),
    invariant: Object.freeze({
      fatal(input: WorkbenchFatalHealthInput): void {
        assertAuthorityOpen();
        if (fatalIssue !== null) return;
        fatalIssue = Object.freeze({
          kind: 'fatal',
          issue: Object.freeze({
            kind: 'fatal',
            scope: 'invariant',
            summary: inspectSummary(input.summary),
            recovery: 'reload',
          }),
          recover: input.recover,
        });
        publish();
      },
    }),
    openGeneration,
    close(): void {
      if (closed) return;
      const generation = activeGeneration;
      if (generation !== null) {
        generation.closed = true;
        generation.listeners.clear();
        activeGeneration = null;
      }
      degraded.clear();
      ownerIssue = null;
      closed = true;
      globalListeners.clear();
    },
  });
}
