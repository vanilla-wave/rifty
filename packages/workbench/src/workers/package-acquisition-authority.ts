import type {
  InstallResult,
  ShadowAssetEnsureOptions,
  ShadowAssetInstallError,
  ShadowAssetInstaller,
  ShadowAssetPlan,
  ShadowAssetReadyReceipt,
} from '@riftydev/npm-client';
import type { CommandContext } from '@riftydev/shell';
import { normalizePath } from '@riftydev/vfs';
import type {
  InstallStampAuthority,
  InstallStampClaim,
  InstallStampPromotionResult,
  InstallStampTransitionOptions,
} from '../glue/install-stamp-authority.ts';
import type { PackageResetPreparation } from '../glue/package-mutation-executor.ts';
import type {
  ProjectAcquisitionPlan,
  ProjectAcquisitionProvenance,
  ProjectSnapshotFailure,
} from '../workbench/project-materialization.ts';
import { isPostTreePackageFinalizationFailure } from './package-install-finalizer.ts';

export type AcquisitionProvenance = ProjectAcquisitionProvenance;

export interface PackageAcquisitionProject {
  readonly projectId: string;
  readonly root: string;
  readonly slug: string;
  /** Exact install-artifact identity required for every trusted tree. */
  readonly identity: string;
}

export type PackageAcquisitionProjectSource =
  | PackageAcquisitionProject
  | (() => PackageAcquisitionProject);

export interface PackageSnapshotCandidate {
  readonly snapshotId: string;
  readonly identity: string;
  readonly packageJsonText: string;
  /** Adapter-owned verified bytes/tree plan. The authority never interprets it. */
  readonly payload?: unknown;
}

export type PackageSnapshotResolution =
  | { readonly status: 'candidate'; readonly snapshot: PackageSnapshotCandidate }
  | { readonly status: 'rejected'; readonly reason: string };

export interface PackageSnapshotSource {
  readonly snapshotId: string;
  /** Runs lazily after the trusted-tree check, inside the acquisition FIFO. */
  readonly resolve: () => Promise<PackageSnapshotResolution>;
}

export interface EnsurePackagesCommand {
  readonly type: 'ensure';
  readonly project: PackageAcquisitionProject;
  readonly packageJsonText: string;
  readonly snapshot?: PackageSnapshotCandidate;
  readonly snapshotSource?: PackageSnapshotSource;
  /** Playground instant materialization is restore-only; Workbench uses install. */
  readonly fallback?: 'install' | 'snapshot-only';
  /** Adapter-owned foreign-tree clear/reseed, after durable demotion. */
  readonly replaceTreeOnMiss?: boolean;
  /** Operation-scoped cancellation/progress for post-tree asset readiness. */
  readonly runtimeAssets?: ShadowAssetEnsureOptions;
  readonly onPromotion?: (result: InstallStampPromotionResult) => void;
}

export interface TerminalInstallCommand {
  readonly type: 'terminal-install';
  /** Resolves active project identity only when this command reaches the FIFO head. */
  readonly project: PackageAcquisitionProjectSource;
  /** Stamped ancestor trees whose node_modules contain this actual project.
   * Resolved only at the FIFO head; every distinct ancestor is durably demoted
   * before the actual-project claim or installer mutation. */
  readonly guardProjects?: () => readonly PackageAcquisitionProject[];
  readonly argv: readonly string[];
  /** Present for the real npm shell adapter; authority tests may omit it. */
  readonly context?: CommandContext;
  readonly onPromotion?: (result: InstallStampPromotionResult) => void;
  /** Operation-scoped cancellation/progress for post-tree asset readiness. */
  readonly runtimeAssets?: ShadowAssetEnsureOptions;
  /** Owner-local signal emitted only when deferred first materialization settles. */
  readonly onFirstMaterializationConsumed?: () => void;
  /** Authority-captured admission fact: a snapshot prepare was already ahead. */
  readonly reuseTrustedClaim?: boolean;
}

export interface PackageJsonEditCommand {
  readonly type: 'package-json-edit';
  /** A resolver samples owner state only when this command reaches the FIFO head. */
  readonly project: PackageAcquisitionProjectSource;
  /** Returns false for a validated no-op before any stamp transition. */
  readonly preflight?: () => Promise<boolean>;
  /** Runs only after durable demotion, inside the owner acquisition FIFO. */
  readonly mutate: () => Promise<void>;
}

export interface ResetPackagesCommand {
  readonly type: 'reset';
  readonly target: { readonly root: string };
  /** Preflight runs in the FIFO; a ready mutation runs only after durable revocation. */
  readonly prepare?: PackageResetPreparation;
  /** Resolves every claim touched by whole-root replacement at the FIFO head. */
  readonly resolveTransitions?: () => readonly PackageMutationTransition[];
  /** OwnerPackageState barrier after preflight/proof and before the first write. */
  readonly beginTreeMutation?: (acquisitionToken: object) => void;
}

export interface ProjectSwitchCommand {
  readonly type: 'project-switch';
  readonly from: PackageAcquisitionProject | null;
  readonly to: PackageAcquisitionProject;
  /** Revoke and replace dependency-owned state at the destination root. */
  readonly resetPackages?: boolean;
  readonly packageJsonText?: string;
}

export interface ActivateAndEnsurePackagesCommand {
  readonly type: 'activate-and-ensure';
  /** Bind adapter-owned config at the FIFO head before any active-project observation. */
  readonly register: () => void;
  /** Resolve at the FIFO head so back-to-back activations observe the actual predecessor. */
  readonly from: PackageAcquisitionProject | null | (() => PackageAcquisitionProject | null);
  readonly to: PackageAcquisitionProject;
  readonly packageJsonText: string;
  readonly replaceTreeOnMiss?: boolean;
  /** Operation-scoped cancellation/progress for post-tree asset readiness. */
  readonly runtimeAssets?: ShadowAssetEnsureOptions;
  readonly onPromotion?: (result: InstallStampPromotionResult) => void;
}

export interface PrepareFirstMaterializationPackagesCommand {
  readonly type: 'prepare-first-materialization';
  /** Bind adapter-owned config at the FIFO head before any active-project observation. */
  readonly register: () => void;
  readonly from: PackageAcquisitionProject | null | (() => PackageAcquisitionProject | null);
  readonly to: PackageAcquisitionProject;
  readonly packageJsonText: string;
  readonly materialization:
    | { readonly kind: 'install' }
    | { readonly kind: 'snapshot'; readonly source: PackageSnapshotSource };
  readonly replaceTreeOnMiss?: boolean;
  /** Operation-scoped cancellation/progress for post-tree asset readiness. */
  readonly runtimeAssets?: ShadowAssetEnsureOptions;
  readonly onPromotion?: (result: InstallStampPromotionResult) => void;
}

export type PackageMutationTransition =
  | { readonly mode: 'demote'; readonly project: PackageAcquisitionProject }
  | { readonly mode: 'revoke'; readonly root: string };

export interface GuardedPackageMutationCommand {
  readonly type: 'guarded-mutation';
  /** Runs at the FIFO head before target discovery or any trust transition. */
  readonly preflight?: () => Promise<boolean>;
  /** Discovers every touched claim from current owner/disk state at the FIFO head. */
  readonly resolveTransitions: () => readonly PackageMutationTransition[];
  /** Present only when the exact resolved intent set can touch the installed tree. */
  readonly beginTreeMutation?: (acquisitionToken: object) => void;
  /** Runs only after every distinct transition is durably established. */
  readonly mutate: () => Promise<void>;
}

export type PackageAcquisitionCommand =
  | EnsurePackagesCommand
  | TerminalInstallCommand
  | PackageJsonEditCommand
  | ResetPackagesCommand
  | GuardedPackageMutationCommand
  | ProjectSwitchCommand
  | ActivateAndEnsurePackagesCommand
  | PrepareFirstMaterializationPackagesCommand;

export type PackageInstallRequest =
  | Pick<EnsurePackagesCommand, 'type' | 'project' | 'packageJsonText' | 'runtimeAssets'>
  | (Omit<TerminalInstallCommand, 'project'> & {
      readonly project: PackageAcquisitionProject;
    });

export type PackageInstallAdapterResult =
  | { readonly status: 'not-required' }
  | {
      readonly status: 'post-tree-failure';
      readonly treeResult: InstallResult;
      readonly packageJsonText: string;
      readonly error: ShadowAssetInstallError;
    }
  | {
      readonly status?: 'installed';
      readonly result: InstallResult;
      /** Exact manifest bytes after the installer has finished mutating the tree.
       * `null` keeps a successful install successful but makes it unstampable. */
      readonly packageJsonText: string | null;
    };

export interface PackageInstallExecution {
  /** This owner already attempted a terminal install on the same tree. */
  readonly sessionInstallActivity: boolean;
  /** Exact project identity of that attempt; boolean activity alone cannot
   * distinguish a same-root project switch from a same-project retry. */
  readonly priorSessionSlug?: string;
  /** Exact pre-demote trusted state for this project/artifact identity. */
  readonly priorTrustedTree: boolean;
  /** Prior on-disk claim owner; a different slug makes the lock/tree foreign. */
  readonly priorSlug?: string;
  /** Idempotent owner epoch barrier immediately before this install first mutates its tree. */
  readonly beginTreeMutation?: () => void;
}

export type SnapshotRestorePlan =
  | {
      readonly status: 'ready';
      readonly packages: number;
      /** Applies only the already-validated immutable restore plan. */
      readonly apply: () => Promise<void>;
    }
  | { readonly status: 'rejected'; readonly reason: string };

/** Internal seam. Production composition and fault adapters share this shape. */
export interface PackageAcquisitionAdapter {
  prepareEnsure?(
    command: EnsurePackagesCommand,
    execution: {
      readonly claim: InstallStampClaim;
      readonly phase: 'initial' | 'snapshot-rejected';
      readonly beginTreeMutation: () => void;
    },
  ): Promise<void>;
  /** Parse/decode/validate the complete snapshot before any claim or tree mutation. */
  planSnapshotRestore(input: {
    readonly project: PackageAcquisitionProject;
    readonly packageJsonText: string;
    readonly snapshot: PackageSnapshotCandidate;
    readonly beginTreeMutation: () => void;
  }): Promise<SnapshotRestorePlan>;
  install(
    request: PackageInstallRequest,
    execution: PackageInstallExecution,
  ): Promise<PackageInstallAdapterResult>;
  reset(command: ResetPackagesCommand): Promise<void>;
  switchProject(
    command: ProjectSwitchCommand,
    execution: { readonly beginTreeMutation: () => void },
  ): Promise<void>;
}

export type PackageRuntimeAssetFactsInput =
  | Readonly<{
      kind: 'lockfile';
      outcome: 'trusted' | 'snapshot';
      project: PackageAcquisitionProject;
      lockfileBytes: Uint8Array;
    }>
  | Readonly<{
      kind: 'install';
      project: PackageAcquisitionProject;
      result: InstallResult;
    }>;

export interface PackageRuntimeAssetFacts {
  readonly plan: ShadowAssetPlan;
  readonly receipt?: ShadowAssetReadyReceipt;
  /** Exact root-visible package versions projected from the same attested tree facts. */
  readonly rootPackageVersionsByInstallPath: Readonly<Record<string, string>>;
}

export type PackageTreeRuntimeAssetReadiness =
  | Readonly<{ kind: 'not-required' }>
  | Readonly<{ kind: 'pending'; plan: ShadowAssetPlan }>
  | Readonly<{
      kind: 'ready';
      plan: ShadowAssetPlan;
      receipt: ShadowAssetReadyReceipt;
    }>;

/** Package-private producer/installer join; no Workbench protocol crosses it. */
export interface PackageRuntimeAssetPort {
  readonly installer: ShadowAssetInstaller;
  produce(input: PackageRuntimeAssetFactsInput): Promise<PackageRuntimeAssetFacts>;
}

type PostTreeRuntimeAssetInput =
  | Omit<Extract<PackageRuntimeAssetFactsInput, { kind: 'lockfile' }>, 'lockfileBytes'>
  | Extract<PackageRuntimeAssetFactsInput, { kind: 'install' }>;

export type SnapshotFailure = ProjectSnapshotFailure;

export type AcquisitionObservation =
  | {
      readonly type: 'snapshot-rejected';
      readonly projectId: string;
      readonly snapshotId: string;
      readonly reason: string;
    }
  | {
      readonly type: 'promotion-refused';
      readonly projectId: string;
      readonly operation: 'ensure' | 'terminal-install';
      readonly reason: string;
    };

export interface DeferredTerminalConsumption {
  /** Check a prior successful first attempt before repeating physical installation. */
  readonly reuseTrustedClaim: true;
  /** Authority calls exactly once, after the complete FIFO operation settles. */
  settle(outcome: 'success' | 'failure'): void;
}

export interface DeferredTerminalConsumptionCapture {
  /** Resolve terminal cwd/project only at the FIFO head; mismatch declines consumption. */
  resolve(project: PackageAcquisitionProject): DeferredTerminalConsumption | null;
}

export interface PackageAcquisitionAuthorityOptions {
  readonly stamps: InstallStampAuthority;
  /** The owner durability barrier forwarded to every stamp state transition. */
  readonly stampTransition?: InstallStampTransitionOptions;
  readonly adapter: PackageAcquisitionAdapter;
  /** Exact producer evidence and owner storage-backed readiness installer. */
  readonly runtimeAssets?: PackageRuntimeAssetPort;
  /** OwnerPackageState-owned epoch barrier; the FIFO supplies its operation token. */
  readonly beginTreeMutation?: (
    project: PackageAcquisitionProject,
    acquisitionToken: object,
  ) => void;
  /** Publish only producer/installer-proven readiness into OwnerPackageState. */
  readonly publishTreeReadiness?: (
    project: PackageAcquisitionProject,
    readiness: PackageTreeRuntimeAssetReadiness,
    rootPackageVersionsByInstallPath: Readonly<Record<string, string>>,
  ) => void;
  /** FIFO-head ancestor/descendant claims affected by replacing `<root>/node_modules`. */
  readonly resolveTreeGuards?: (
    root: string,
    knownProjects: readonly PackageAcquisitionProject[],
  ) => readonly PackageMutationTransition[];
  /** Diagnostic sink only. A throwing observer cannot change acquisition. */
  readonly observe?: (event: AcquisitionObservation) => void;
  /** Captures owner first-materialization state when terminal work enters the FIFO. */
  readonly captureDeferredTerminalConsumption?: (
    command: TerminalInstallCommand,
  ) => DeferredTerminalConsumptionCapture | null;
}

export class PackageAcquisitionError extends Error {
  readonly code = 'PACKAGE_ACQUISITION_FAILED' as const;
  readonly operation: 'ensure' | 'terminal-install';
  readonly failure: PackageAcquisitionFailure;
  readonly snapshotFailures: readonly SnapshotFailure[];

  constructor(
    operation: 'ensure' | 'terminal-install',
    message: string,
    options: {
      readonly failure: PackageAcquisitionFailure;
      readonly cause: unknown;
      readonly snapshotFailures: readonly SnapshotFailure[];
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'PackageAcquisitionError';
    this.operation = operation;
    this.failure = options.failure;
    this.snapshotFailures = [...options.snapshotFailures];
  }
}

export type PackageAcquisitionFailure =
  | 'claim'
  | 'prepare'
  | 'snapshot-unavailable'
  | 'install'
  | 'invalid-noop';

export interface PackageAcquisitionAuthority {
  /** Immutable composition fact; terminal adapters attach waiter options only when supported. */
  readonly supportsRuntimeAssetReadiness?: boolean;
  /** Live projects observed by this owner; retained conservatively after revoke. */
  knownProjects?(): readonly PackageAcquisitionProject[];
  /** Wait for commands admitted before this call and their detached stamp settlements. */
  quiesce(): Promise<void>;
  /** Hold the package FIFO while a child synchronously crosses physical spawn. */
  reserveChildAdmission<T>(capture: () => T | Promise<T>): Promise<PackageFifoReservation<T>>;
  dispatch(command: EnsurePackagesCommand): Promise<AcquisitionProvenance>;
  dispatch(command: ActivateAndEnsurePackagesCommand): Promise<AcquisitionProvenance>;
  dispatch(command: PrepareFirstMaterializationPackagesCommand): Promise<ProjectAcquisitionPlan>;
  dispatch(command: TerminalInstallCommand): Promise<AcquisitionProvenance | undefined>;
  dispatch(command: PackageJsonEditCommand): Promise<void>;
  dispatch(command: ResetPackagesCommand): Promise<void>;
  dispatch(command: GuardedPackageMutationCommand): Promise<void>;
  dispatch(command: ProjectSwitchCommand): Promise<void>;
  dispatch(command: PackageAcquisitionCommand): Promise<PackageAcquisitionResult>;
}

export interface PackageFifoReservation<T> {
  readonly snapshot: T;
  commit(): void;
  abortBeforeSpawn(error: unknown): void;
  abortAfterChildSettlement(error: unknown, exited: Promise<unknown>): Promise<void>;
}

type PackageAcquisitionResult = AcquisitionProvenance | ProjectAcquisitionPlan | undefined;

interface QueueEntry {
  readonly kind: 'command';
  readonly admission: number;
  readonly acquisitionToken: object;
  readonly command: PackageAcquisitionCommand;
  readonly deferredTerminalConsumption?: DeferredTerminalConsumptionCapture;
  readonly resolve: (value: PackageAcquisitionResult) => void;
  readonly reject: (reason: unknown) => void;
}

interface ChildAdmissionQueueEntry {
  readonly kind: 'child-admission';
  readonly admission: number;
  readonly capture: () => unknown | Promise<unknown>;
  readonly resolve: (reservation: PackageFifoReservation<unknown>) => void;
  readonly reject: (reason: unknown) => void;
}

type FifoQueueEntry = QueueEntry | ChildAdmissionQueueEntry;

interface AdmissionWaiter {
  readonly through: number;
  readonly resolve: () => void;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function promotionReason(result: InstallStampPromotionResult): string {
  if (result.status === 'stale') return 'stamp-promotion-stale';
  if (result.status === 'refused') return `stamp-promotion-${result.reason}`;
  return 'stamp-identity-mismatch';
}

function installedProvenance(result: InstallResult): AcquisitionProvenance {
  const provenance = result.provenance;
  return {
    outcome: 'installed',
    resolution: provenance.resolution,
    packages: provenance.packages.map((entry) => ({
      name: entry.name,
      version: entry.version,
      transport: entry.transport,
    })),
    ...(provenance.eddyFallback
      ? { eddyFallback: { reason: provenance.eddyFallback.reason } }
      : {}),
  };
}

function unreachable(value: never): never {
  throw new Error(`unknown package acquisition command: ${String(value)}`);
}

class FifoPackageAcquisitionAuthority implements PackageAcquisitionAuthority {
  readonly supportsRuntimeAssetReadiness: boolean;
  readonly #stamps: InstallStampAuthority;
  readonly #stampTransition: InstallStampTransitionOptions | undefined;
  readonly #adapter: PackageAcquisitionAdapter;
  readonly #runtimeAssets?: PackageRuntimeAssetPort;
  readonly #beginTreeMutation?: PackageAcquisitionAuthorityOptions['beginTreeMutation'];
  readonly #publishTreeReadiness?: PackageAcquisitionAuthorityOptions['publishTreeReadiness'];
  readonly #resolveTreeGuards?: PackageAcquisitionAuthorityOptions['resolveTreeGuards'];
  readonly #observe?: (event: AcquisitionObservation) => void;
  readonly #captureDeferredTerminalConsumption?: PackageAcquisitionAuthorityOptions['captureDeferredTerminalConsumption'];
  readonly #queue: FifoQueueEntry[] = [];
  readonly #terminalActivity = new Map<string, string>();
  readonly #knownProjects = new Map<string, PackageAcquisitionProject>();
  readonly #detachedSettlements = new Map<Promise<void>, number>();
  readonly #admissionWaiters = new Set<AdmissionWaiter>();
  #draining = false;
  #lastAdmission = 0;
  #completedAdmission = 0;
  #executingAdmission: number | null = null;

  constructor(options: PackageAcquisitionAuthorityOptions) {
    this.supportsRuntimeAssetReadiness = options.runtimeAssets !== undefined;
    this.#stamps = options.stamps;
    this.#stampTransition = options.stampTransition;
    this.#adapter = options.adapter;
    this.#runtimeAssets = options.runtimeAssets;
    this.#beginTreeMutation = options.beginTreeMutation;
    this.#publishTreeReadiness = options.publishTreeReadiness;
    this.#resolveTreeGuards = options.resolveTreeGuards;
    this.#observe = options.observe;
    this.#captureDeferredTerminalConsumption = options.captureDeferredTerminalConsumption;
  }

  knownProjects(): readonly PackageAcquisitionProject[] {
    return [...this.#knownProjects.values()];
  }

  #rememberProject(project: PackageAcquisitionProject): void {
    const root = normalizePath(project.root);
    this.#knownProjects.set(root, { ...project, root });
  }

  async quiesce(): Promise<void> {
    const through = this.#lastAdmission;
    if (through === 0) return;
    await this.#waitForAdmission(through);
    while (true) {
      const pending = [...this.#detachedSettlements]
        .filter(([, admission]) => admission <= through)
        .map(([settlement]) => settlement);
      if (pending.length === 0) return;
      await Promise.allSettled(pending);
    }
  }

  reserveChildAdmission<T>(capture: () => T | Promise<T>): Promise<PackageFifoReservation<T>> {
    const admission = ++this.#lastAdmission;
    const pending = new Promise<PackageFifoReservation<unknown>>((resolve, reject) => {
      this.#queue.push({
        kind: 'child-admission',
        admission,
        capture,
        resolve,
        reject,
      });
    });
    this.#startDrain();
    return pending as Promise<PackageFifoReservation<T>>;
  }

  dispatch(command: EnsurePackagesCommand): Promise<AcquisitionProvenance>;
  dispatch(command: ActivateAndEnsurePackagesCommand): Promise<AcquisitionProvenance>;
  dispatch(command: PrepareFirstMaterializationPackagesCommand): Promise<ProjectAcquisitionPlan>;
  dispatch(command: TerminalInstallCommand): Promise<AcquisitionProvenance | undefined>;
  dispatch(command: PackageJsonEditCommand): Promise<void>;
  dispatch(command: ResetPackagesCommand): Promise<void>;
  dispatch(command: GuardedPackageMutationCommand): Promise<void>;
  dispatch(command: ProjectSwitchCommand): Promise<void>;
  dispatch(command: PackageAcquisitionCommand): Promise<PackageAcquisitionResult>;
  dispatch(command: PackageAcquisitionCommand): Promise<unknown> {
    const admission = ++this.#lastAdmission;
    const deferredTerminalConsumption =
      command.type === 'terminal-install'
        ? this.#captureDeferredTerminalConsumption?.(command)
        : undefined;
    const pending = new Promise<PackageAcquisitionResult>((resolve, reject) => {
      this.#queue.push({
        kind: 'command',
        admission,
        acquisitionToken: Object.freeze({ admission }),
        command,
        ...(deferredTerminalConsumption ? { deferredTerminalConsumption } : {}),
        resolve: (value) => resolve(value),
        reject,
      });
    });
    this.#startDrain();
    return pending;
  }

  #startDrain(): void {
    if (this.#draining) return;
    this.#draining = true;
    void this.#drain();
  }

  async #drain(): Promise<void> {
    try {
      while (this.#queue.length > 0) {
        const entry = this.#queue.shift();
        if (!entry) break;
        if (entry.kind === 'child-admission') {
          this.#executingAdmission = entry.admission;
          try {
            await this.#holdChildAdmission(entry);
          } catch (error) {
            entry.reject(error);
          } finally {
            this.#executingAdmission = null;
            this.#completeAdmission(entry.admission);
          }
          continue;
        }
        this.#executingAdmission = entry.admission;
        let deferredTerminalConsumption: DeferredTerminalConsumption | null = null;
        try {
          let command = entry.command;
          if (command.type === 'terminal-install') {
            const project =
              typeof command.project === 'function' ? command.project() : command.project;
            deferredTerminalConsumption =
              entry.deferredTerminalConsumption?.resolve(project) ?? null;
            command =
              deferredTerminalConsumption?.reuseTrustedClaim === true
                ? { ...command, project, reuseTrustedClaim: true }
                : { ...command, project };
          }
          if (
            command.type === 'prepare-first-materialization' ||
            (command.type === 'terminal-install' && command.reuseTrustedClaim === true)
          ) {
            await this.#waitForDetachedSettlementsBefore(entry.admission);
          }
          const value = await this.#execute(command, entry.acquisitionToken);
          try {
            deferredTerminalConsumption?.settle('success');
            entry.resolve(value);
          } catch (settlementError) {
            entry.reject(settlementError);
          }
        } catch (error) {
          try {
            deferredTerminalConsumption?.settle('failure');
            entry.reject(error);
          } catch (settlementError) {
            entry.reject(
              new AggregateError(
                [error, settlementError],
                'package acquisition and deferred terminal settlement both failed',
              ),
            );
          }
        } finally {
          this.#executingAdmission = null;
          this.#completeAdmission(entry.admission);
        }
      }
    } finally {
      this.#draining = false;
    }
  }

  async #holdChildAdmission(entry: ChildAdmissionQueueEntry): Promise<void> {
    const snapshot = await entry.capture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settlement: 'pending' | 'commit' | 'abort-before-spawn' | 'abort-after-spawn' = 'pending';
    const claim = (next: Exclude<typeof settlement, 'pending'>): void => {
      if (settlement !== 'pending') {
        throw new Error(`child admission reservation already settled by ${settlement}`);
      }
      settlement = next;
    };
    entry.resolve(
      Object.freeze({
        snapshot,
        commit: (): void => {
          claim('commit');
          release();
        },
        abortBeforeSpawn: (_error: unknown): void => {
          claim('abort-before-spawn');
          release();
        },
        abortAfterChildSettlement: async (
          _error: unknown,
          exited: Promise<unknown>,
        ): Promise<void> => {
          claim('abort-after-spawn');
          try {
            await exited;
          } finally {
            release();
          }
        },
      }),
    );
    await held;
  }

  #waitForAdmission(through: number): Promise<void> {
    if (this.#completedAdmission >= through) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#admissionWaiters.add({ through, resolve });
    });
  }

  #completeAdmission(admission: number): void {
    this.#completedAdmission = admission;
    for (const waiter of this.#admissionWaiters) {
      if (waiter.through > admission) continue;
      this.#admissionWaiters.delete(waiter);
      waiter.resolve();
    }
  }

  #trackDetachedSettlement(settlement: Promise<void>): void {
    const admission = this.#executingAdmission;
    if (admission === null) {
      throw new Error('detached package settlement has no FIFO admission');
    }
    this.#detachedSettlements.set(settlement, admission);
    const forget = (): void => {
      this.#detachedSettlements.delete(settlement);
    };
    void settlement.then(forget, forget);
  }

  async #waitForDetachedSettlementsBefore(admission: number): Promise<void> {
    for (;;) {
      const pending = [...this.#detachedSettlements]
        .filter(([, ownerAdmission]) => ownerAdmission < admission)
        .map(([settlement]) => settlement);
      if (pending.length === 0) return;
      await Promise.allSettled(pending);
    }
  }

  async #execute(
    command: PackageAcquisitionCommand,
    acquisitionToken: object,
  ): Promise<PackageAcquisitionResult> {
    switch (command.type) {
      case 'ensure':
        this.#rememberProject(command.project);
        return this.#ensure(command, acquisitionToken);
      case 'terminal-install': {
        const project = typeof command.project === 'function' ? command.project() : command.project;
        this.#rememberProject(project);
        return this.#install({ ...command, project }, [], null, undefined, acquisitionToken);
      }
      case 'package-json-edit': {
        if (command.preflight && !(await command.preflight())) return;
        const project = typeof command.project === 'function' ? command.project() : command.project;
        this.#rememberProject(project);
        await this.#stamps.demote(project, this.#stampTransition);
        await command.mutate();
        return;
      }
      case 'reset': {
        const plan = command.prepare ? await command.prepare() : null;
        if (plan?.status === 'noop') return;
        const transitions =
          command.resolveTransitions?.() ?? this.#treeGuardsFor(command.target.root);
        await this.#applyMutationTransitions([
          ...transitions,
          { mode: 'revoke', root: command.target.root },
        ]);
        command.beginTreeMutation?.(acquisitionToken);
        if (plan) {
          if (plan.resetDependencyTree) {
            await plan.mutate(() => this.#adapter.reset(command));
          } else await plan.mutate();
        } else await this.#adapter.reset(command);
        return;
      }
      case 'guarded-mutation':
        if (command.preflight && !(await command.preflight())) return;
        await this.#applyMutationTransitions(command.resolveTransitions());
        command.beginTreeMutation?.(acquisitionToken);
        await command.mutate();
        return;
      case 'project-switch':
        if (command.from) this.#rememberProject(command.from);
        this.#rememberProject(command.to);
        if (command.resetPackages) {
          await this.#applyMutationTransitions(this.#treeGuardsFor(command.to.root));
          await this.#stamps.revoke({ root: command.to.root }, this.#stampTransition);
        }
        await this.#adapter.switchProject(command, {
          beginTreeMutation: () => this.#beginTreeMutation?.(command.to, acquisitionToken),
        });
        return;
      case 'activate-and-ensure': {
        command.register();
        const from = typeof command.from === 'function' ? command.from() : command.from;
        if (from) this.#rememberProject(from);
        this.#rememberProject(command.to);
        await this.#adapter.switchProject(
          { type: 'project-switch', from, to: command.to },
          {
            beginTreeMutation: () => this.#beginTreeMutation?.(command.to, acquisitionToken),
          },
        );
        return this.#ensure(
          {
            type: 'ensure',
            project: command.to,
            packageJsonText: command.packageJsonText,
            fallback: 'install',
            ...(command.replaceTreeOnMiss ? { replaceTreeOnMiss: true } : {}),
            ...(command.runtimeAssets ? { runtimeAssets: command.runtimeAssets } : {}),
            ...(command.onPromotion ? { onPromotion: command.onPromotion } : {}),
          },
          acquisitionToken,
        );
      }
      case 'prepare-first-materialization': {
        command.register();
        const from = typeof command.from === 'function' ? command.from() : command.from;
        if (from) this.#rememberProject(from);
        this.#rememberProject(command.to);
        await this.#adapter.switchProject(
          { type: 'project-switch', from, to: command.to },
          {
            beginTreeMutation: () => this.#beginTreeMutation?.(command.to, acquisitionToken),
          },
        );

        const existing = await this.#readyTrustedProvenance(
          command.to,
          command.packageJsonText,
          command.runtimeAssets,
        );
        if (existing !== null) {
          return Object.freeze({ kind: 'ready', provenance: Object.freeze(existing) });
        }
        if (command.materialization.kind === 'install') {
          return Object.freeze({
            kind: 'install',
            snapshotFailures: Object.freeze([]),
          });
        }
        try {
          const provenance = await this.#ensure(
            {
              type: 'ensure',
              project: command.to,
              packageJsonText: command.packageJsonText,
              snapshotSource: command.materialization.source,
              fallback: 'snapshot-only',
              ...(command.replaceTreeOnMiss ? { replaceTreeOnMiss: true } : {}),
              ...(command.runtimeAssets ? { runtimeAssets: command.runtimeAssets } : {}),
              ...(command.onPromotion ? { onPromotion: command.onPromotion } : {}),
            },
            acquisitionToken,
          );
          return Object.freeze({ kind: 'ready', provenance: Object.freeze(provenance) });
        } catch (error) {
          if (
            !(error instanceof PackageAcquisitionError) ||
            error.failure !== 'snapshot-unavailable'
          ) {
            throw error;
          }
          return Object.freeze({
            kind: 'install',
            snapshotFailures: Object.freeze(
              error.snapshotFailures.map((failure) => Object.freeze({ ...failure })),
            ),
          });
        }
      }
      default:
        return unreachable(command);
    }
  }

  #treeGuardsFor(root: string): readonly PackageMutationTransition[] {
    return this.#resolveTreeGuards?.(normalizePath(root), this.knownProjects()) ?? [];
  }

  async #applyMutationTransitions(
    rawTransitions: readonly PackageMutationTransition[],
  ): Promise<void> {
    const byRoot = new Map<string, PackageMutationTransition>();
    for (const raw of rawTransitions) {
      const root = normalizePath(raw.mode === 'revoke' ? raw.root : raw.project.root);
      const transition: PackageMutationTransition =
        raw.mode === 'revoke'
          ? { mode: 'revoke', root }
          : { mode: 'demote', project: { ...raw.project, root } };
      if (transition.mode === 'demote') this.#rememberProject(transition.project);
      const existing = byRoot.get(root);
      if (!existing) {
        byRoot.set(root, transition);
        continue;
      }
      if (existing.mode === 'revoke' || transition.mode === 'revoke') {
        byRoot.set(root, { mode: 'revoke', root });
        continue;
      }
      if (existing.project.slug !== transition.project.slug) {
        byRoot.set(root, { mode: 'revoke', root });
      }
    }
    const transitions = [...byRoot.values()].sort((left, right) => {
      const leftRoot = left.mode === 'revoke' ? left.root : left.project.root;
      const rightRoot = right.mode === 'revoke' ? right.root : right.project.root;
      if (leftRoot.length !== rightRoot.length) return leftRoot.length - rightRoot.length;
      return leftRoot < rightRoot ? -1 : leftRoot > rightRoot ? 1 : 0;
    });
    for (const transition of transitions) {
      if (transition.mode === 'revoke') {
        await this.#stamps.revoke({ root: transition.root }, this.#stampTransition);
      } else {
        await this.#stamps.demote(transition.project, this.#stampTransition);
      }
    }
  }

  async #trustedProvenance(
    project: PackageAcquisitionProject,
    packageJsonText: string,
  ): Promise<Extract<AcquisitionProvenance, { readonly outcome: 'existing' }> | null> {
    const existing = await this.#stamps.check({
      root: project.root,
      slug: project.slug,
      expectedPackageJsonText: packageJsonText,
    });
    if (
      existing.status === 'trusted' &&
      existing.stamp.installArtifactIdentity === project.identity
    ) {
      return {
        outcome: 'existing',
        identity: existing.stamp.installArtifactIdentity,
        packages: existing.stamp.packages,
      };
    }
    return null;
  }

  async #readyTrustedProvenance(
    project: PackageAcquisitionProject,
    packageJsonText: string,
    options?: ShadowAssetEnsureOptions,
  ): Promise<Extract<AcquisitionProvenance, { readonly outcome: 'existing' }> | null> {
    const provenance = await this.#trustedProvenance(project, packageJsonText);
    if (provenance === null) return null;
    await this.#postTreeRuntimeAssetReadiness(
      {
        kind: 'lockfile',
        outcome: 'trusted',
        project,
      },
      options,
    );
    return provenance;
  }

  async #postTreeRuntimeAssetReadiness(
    input: PostTreeRuntimeAssetInput,
    options?: ShadowAssetEnsureOptions,
  ): Promise<PackageRuntimeAssetFacts | null> {
    const runtimeAssets = this.#runtimeAssets;
    if (!runtimeAssets) {
      if (options !== undefined) {
        throw new Error('package acquisition has no runtime-asset readiness port');
      }
      return null;
    }
    let evidence: PackageRuntimeAssetFactsInput;
    if (input.kind === 'lockfile') {
      const read = this.#stamps.readLockfileBytes;
      if (!read) {
        throw new Error(
          `package acquisition cannot produce exact runtime-asset facts for ${input.project.projectId}`,
        );
      }
      evidence = {
        ...input,
        lockfileBytes: await read.call(this.#stamps, input.project.root),
      };
    } else {
      evidence = input;
    }
    const facts = await runtimeAssets.produce(evidence);
    const { plan, receipt, rootPackageVersionsByInstallPath } = facts;
    if (plan.assets.length === 0) {
      this.#publishTreeReadiness?.(
        input.project,
        Object.freeze({ kind: 'not-required' }),
        rootPackageVersionsByInstallPath,
      );
      return facts;
    }
    if (receipt?.requiredSetDigest === plan.requiredSetDigest) {
      this.#publishTreeReadiness?.(
        input.project,
        Object.freeze({ kind: 'ready', plan, receipt }),
        rootPackageVersionsByInstallPath,
      );
      return facts;
    }
    this.#publishTreeReadiness?.(
      input.project,
      Object.freeze({ kind: 'pending', plan }),
      rootPackageVersionsByInstallPath,
    );

    let warned = false;
    const onProgress = options?.onProgress;
    const isolatedOptions =
      onProgress === undefined
        ? options
        : {
            ...options,
            onProgress: (progress: Parameters<NonNullable<typeof onProgress>>[0]): void => {
              try {
                onProgress(progress);
              } catch (error) {
                if (warned) return;
                warned = true;
                try {
                  console.warn(
                    `[package-acquisition] runtime-asset progress observer failed for ${input.project.projectId}`,
                    error,
                  );
                } catch {
                  // Presentation cannot become a package-state owner.
                }
              }
            },
          };
    const ensured = await runtimeAssets.installer.ensure(plan, isolatedOptions);
    if (ensured.plan.requiredSetDigest !== plan.requiredSetDigest) {
      throw new Error('runtime-asset readiness returned a different required set');
    }
    if (ensured.kind !== 'ready') {
      throw new Error('runtime-asset readiness omitted a receipt for a non-empty plan');
    }
    this.#publishTreeReadiness?.(
      input.project,
      Object.freeze({ kind: 'ready', plan, receipt: ensured.receipt }),
      rootPackageVersionsByInstallPath,
    );
    return { plan, receipt: ensured.receipt, rootPackageVersionsByInstallPath };
  }

  async #ensure(
    command: EnsurePackagesCommand,
    acquisitionToken: object,
  ): Promise<AcquisitionProvenance> {
    const beginTreeMutation = (): void => {
      this.#beginTreeMutation?.(command.project, acquisitionToken);
    };
    const existing = await this.#readyTrustedProvenance(
      command.project,
      command.packageJsonText,
      command.runtimeAssets,
    );
    if (existing !== null) return existing;

    const failures: SnapshotFailure[] = [];
    let snapshot = command.snapshot;
    if (!snapshot && command.snapshotSource) {
      let resolved: PackageSnapshotResolution;
      try {
        resolved = await command.snapshotSource.resolve();
      } catch (error) {
        resolved = {
          status: 'rejected',
          reason: `snapshot-fetch-failed: ${reasonOf(error)}`,
        };
      }
      if (resolved.status === 'candidate') {
        snapshot = resolved.snapshot;
      } else {
        this.#recordSnapshotFailureById(
          command.project,
          command.snapshotSource.snapshotId,
          failures,
          resolved.reason,
        );
      }
    }

    let snapshotPlan: SnapshotRestorePlan | null = null;
    if (snapshot) {
      const mismatch =
        snapshot.packageJsonText !== command.packageJsonText
          ? 'package-json-mismatch'
          : snapshot.identity !== command.project.identity
            ? 'install-artifact-identity-mismatch'
            : null;
      if (mismatch) {
        this.#recordSnapshotFailure(command.project, snapshot, failures, mismatch);
      } else {
        try {
          snapshotPlan = await this.#adapter.planSnapshotRestore({
            project: command.project,
            packageJsonText: command.packageJsonText,
            snapshot,
            beginTreeMutation,
          });
        } catch (error) {
          snapshotPlan = {
            status: 'rejected',
            reason: `snapshot-restore-plan-failed: ${reasonOf(error)}`,
          };
        }
        if (snapshotPlan.status === 'rejected') {
          this.#recordSnapshotFailure(command.project, snapshot, failures, snapshotPlan.reason);
          snapshotPlan = null;
        }
      }
    }

    const throwSnapshotUnavailable = (): never => {
      if (!snapshot && failures.length === 0) {
        this.#recordSnapshotFailureById(
          command.project,
          command.snapshotSource?.snapshotId ?? '<none>',
          failures,
          'snapshot-not-configured',
        );
      }
      throw new PackageAcquisitionError(
        'ensure',
        `verified snapshot unavailable for ${command.project.projectId}`,
        {
          failure: 'snapshot-unavailable',
          cause: new Error('snapshot-only acquisition has no verified snapshot'),
          snapshotFailures: failures,
        },
      );
    };

    // Validation rejection is pre-mutation: a snapshot-only arrival keeps the
    // existing destination and claim byte-identical.
    if (!snapshotPlan && command.fallback === 'snapshot-only') throwSnapshotUnavailable();

    let claim: InstallStampClaim;
    try {
      await this.#applyMutationTransitions(this.#treeGuardsFor(command.project.root));
      claim = await this.#stamps.demote(command.project, this.#stampTransition);
      await this.#stamps.prepareTreeMutation(claim);
    } catch (cause) {
      throw new PackageAcquisitionError(
        'ensure',
        `package acquisition could not establish an untrusted install claim for ${command.project.projectId}`,
        { failure: 'claim', cause, snapshotFailures: failures },
      );
    }
    try {
      await this.#adapter.prepareEnsure?.(command, {
        claim,
        phase: 'initial',
        beginTreeMutation,
      });
    } catch (cause) {
      throw new PackageAcquisitionError(
        'ensure',
        `package acquisition could not prepare ${command.project.projectId}`,
        { failure: 'prepare', cause, snapshotFailures: failures },
      );
    }

    let restoreRejected = false;
    if (snapshot && snapshotPlan?.status === 'ready') {
      try {
        await snapshotPlan.apply();
      } catch (error) {
        restoreRejected = true;
        this.#recordSnapshotFailure(
          command.project,
          snapshot,
          failures,
          `snapshot-restore-failed: ${reasonOf(error)}`,
        );
      }
      if (!restoreRejected) {
        await this.#completePromotion(
          command.project,
          'ensure',
          command.packageJsonText,
          snapshotPlan.packages,
          claim,
          command.onPromotion,
        );
        await this.#postTreeRuntimeAssetReadiness(
          {
            kind: 'lockfile',
            outcome: 'snapshot',
            project: command.project,
          },
          command.runtimeAssets,
        );
        return {
          outcome: 'snapshot',
          snapshotId: snapshot.snapshotId,
          identity: snapshot.identity,
          packages: snapshotPlan.packages,
        };
      }
    }

    if (restoreRejected) {
      try {
        await this.#adapter.prepareEnsure?.(command, {
          claim,
          phase: 'snapshot-rejected',
          beginTreeMutation,
        });
      } catch (cause) {
        throw new PackageAcquisitionError(
          'ensure',
          `package acquisition could not re-prepare ${command.project.projectId} after snapshot rejection`,
          { failure: 'prepare', cause, snapshotFailures: failures },
        );
      }
    }

    if (command.fallback === 'snapshot-only') throwSnapshotUnavailable();

    const installed = await this.#install(
      {
        type: 'ensure',
        project: command.project,
        packageJsonText: command.packageJsonText,
        ...(command.runtimeAssets ? { runtimeAssets: command.runtimeAssets } : {}),
      },
      failures,
      claim,
      command.onPromotion,
      acquisitionToken,
    );
    if (!installed) {
      throw new PackageAcquisitionError(
        'ensure',
        `package installer returned noop while ensuring ${command.project.projectId}`,
        {
          cause: new Error('ensure install adapter returned noop'),
          failure: 'invalid-noop',
          snapshotFailures: failures,
        },
      );
    }
    return installed;
  }

  #recordSnapshotFailure(
    project: PackageAcquisitionProject,
    snapshot: PackageSnapshotCandidate,
    failures: SnapshotFailure[],
    reason: string,
  ): void {
    this.#recordSnapshotFailureById(project, snapshot.snapshotId, failures, reason);
  }

  #recordSnapshotFailureById(
    project: PackageAcquisitionProject,
    snapshotId: string,
    failures: SnapshotFailure[],
    reason: string,
  ): void {
    const failure = { snapshotId, reason };
    failures.push(failure);
    try {
      this.#observe?.({
        type: 'snapshot-rejected',
        projectId: project.projectId,
        ...failure,
      });
    } catch {
      // Observability cannot become a second package-state owner.
    }
  }

  async #install(
    request: PackageInstallRequest,
    snapshotFailures: readonly SnapshotFailure[],
    priorClaim: InstallStampClaim | null,
    onPromotion?: (result: InstallStampPromotionResult) => void,
    acquisitionToken?: object,
  ): Promise<AcquisitionProvenance | undefined> {
    const beginTreeMutation = (): void => {
      if (acquisitionToken === undefined) {
        throw new Error('package install tree mutation has no FIFO acquisition token');
      }
      this.#beginTreeMutation?.(request.project, acquisitionToken);
    };
    if (request.type === 'terminal-install' && request.reuseTrustedClaim === true) {
      const current = await this.#stamps.check({
        root: request.project.root,
        slug: request.project.slug,
      });
      if (
        current.status === 'trusted' &&
        current.stamp.installArtifactIdentity === request.project.identity
      ) {
        await this.#postTreeRuntimeAssetReadiness(
          {
            kind: 'lockfile',
            outcome: 'trusted',
            project: request.project,
          },
          request.runtimeAssets,
        );
        return {
          outcome: 'existing',
          identity: current.stamp.installArtifactIdentity,
          packages: current.stamp.packages,
        };
      }
    }

    let priorTrustedTree = false;
    let claim: InstallStampClaim;
    try {
      const guards: PackageMutationTransition[] = [...this.#treeGuardsFor(request.project.root)];
      if (request.type === 'terminal-install' && request.guardProjects) {
        const actualRoot = normalizePath(request.project.root);
        guards.push(
          ...request
            .guardProjects()
            .filter((guard) => normalizePath(guard.root) !== actualRoot)
            .map((project) => ({ mode: 'demote' as const, project })),
        );
      }
      await this.#applyMutationTransitions(guards);
      if (priorClaim === null) {
        const prior = await this.#stamps.check({
          root: request.project.root,
          slug: request.project.slug,
        });
        priorTrustedTree =
          prior.status === 'trusted' &&
          prior.stamp.installArtifactIdentity === request.project.identity;
      }
      claim = priorClaim ?? (await this.#stamps.demote(request.project, this.#stampTransition));
      if (priorClaim === null) await this.#stamps.prepareTreeMutation(claim);
    } catch (cause) {
      throw new PackageAcquisitionError(
        request.type,
        `package acquisition could not establish an untrusted install claim for ${request.project.projectId}`,
        { failure: 'claim', cause, snapshotFailures },
      );
    }

    let installed: PackageInstallAdapterResult;
    const rootKey = normalizePath(request.project.root);
    const priorSessionSlug =
      request.type === 'terminal-install' ? this.#terminalActivity.get(rootKey) : undefined;
    const sessionInstallActivity = priorSessionSlug !== undefined;
    if (request.type === 'terminal-install') {
      this.#terminalActivity.set(rootKey, request.project.slug);
    }
    try {
      installed = await this.#adapter.install(request, {
        sessionInstallActivity,
        ...(priorSessionSlug !== undefined ? { priorSessionSlug } : {}),
        priorTrustedTree,
        ...(claim.priorSlug ? { priorSlug: claim.priorSlug } : {}),
        beginTreeMutation,
      });
    } catch (cause) {
      if (isPostTreePackageFinalizationFailure(cause)) throw cause;
      throw new PackageAcquisitionError(
        request.type,
        `package install failed for ${request.project.projectId}`,
        { failure: 'install', cause, snapshotFailures },
      );
    }
    if (installed.status === 'not-required') {
      this.#publishTreeReadiness?.(
        request.project,
        Object.freeze({ kind: 'not-required' }),
        Object.freeze({}),
      );
      return;
    }
    if (installed.status === 'post-tree-failure') {
      const runtimeAssets = this.#runtimeAssets;
      if (runtimeAssets === undefined) {
        throw new AggregateError(
          [installed.error, new Error('post-tree runtime-asset failure has no facts producer')],
          'package tree finalized without runtime-asset facts',
        );
      }
      let facts: PackageRuntimeAssetFacts;
      try {
        facts = await runtimeAssets.produce({
          kind: 'install',
          project: request.project,
          result: installed.treeResult,
        });
      } catch (error) {
        throw new AggregateError(
          [installed.error, error],
          'package tree finalized but runtime-asset facts projection failed',
        );
      }
      if (facts.plan.requiredSetDigest !== installed.error.plan.requiredSetDigest) {
        throw new AggregateError(
          [
            installed.error,
            new Error('post-tree runtime-asset facts do not match the failed exact plan'),
          ],
          'package tree finalized with mismatched runtime-asset facts',
        );
      }
      await this.#completePromotion(
        request.project,
        request.type,
        installed.packageJsonText,
        installed.treeResult.packages.length,
        claim,
        onPromotion ?? (request.type === 'terminal-install' ? request.onPromotion : undefined),
      );
      this.#publishTreeReadiness?.(
        request.project,
        Object.freeze({ kind: 'pending', plan: installed.error.plan }),
        facts.rootPackageVersionsByInstallPath,
      );
      throw installed.error;
    }

    await this.#completePromotion(
      request.project,
      request.type,
      installed.packageJsonText,
      installed.result.packages.length,
      claim,
      onPromotion ?? (request.type === 'terminal-install' ? request.onPromotion : undefined),
    );
    await this.#postTreeRuntimeAssetReadiness(
      { kind: 'install', project: request.project, result: installed.result },
      request.runtimeAssets,
    );
    return installedProvenance(installed.result);
  }

  async #completePromotion(
    project: PackageAcquisitionProject,
    operation: 'ensure' | 'terminal-install',
    packageJsonText: string | null,
    packages: number,
    claim: InstallStampClaim,
    onPromotion?: (result: InstallStampPromotionResult) => void,
  ): Promise<void> {
    let settlement: Promise<InstallStampPromotionResult>;
    if (packageJsonText === null) {
      settlement = Promise.resolve({ status: 'refused', reason: 'identity-drift' });
    } else {
      try {
        const admission = await this.#stamps.admitPromotion(
          { ...project, packageJsonText },
          { epoch: claim.epoch, packages, ...this.#stampTransition },
        );
        settlement = admission.settlement;
      } catch (error) {
        settlement = Promise.resolve({
          status: 'refused',
          reason: 'write-failed',
          error: reasonOf(error),
        });
      }
    }

    const settle = async (): Promise<void> => {
      let result: InstallStampPromotionResult;
      try {
        result = await settlement;
      } catch (error) {
        result = { status: 'refused', reason: 'write-failed', error: reasonOf(error) };
      }
      try {
        onPromotion?.(result);
      } catch {
        // Presentation cannot become a package-state owner.
      }
      if (
        result.status === 'trusted' &&
        result.stamp.installArtifactIdentity === project.identity
      ) {
        return;
      }
      try {
        this.#observe?.({
          type: 'promotion-refused',
          projectId: project.projectId,
          operation,
          reason: promotionReason(result),
        });
      } catch {
        // Observability cannot become a second package-state owner.
      }
    };

    if (this.#stampTransition?.flush) {
      this.#trackDetachedSettlement(settle());
      return;
    }
    await settle();
  }
}

export function createPackageAcquisitionAuthority(
  options: PackageAcquisitionAuthorityOptions,
): PackageAcquisitionAuthority {
  return new FifoPackageAcquisitionAuthority(options);
}
