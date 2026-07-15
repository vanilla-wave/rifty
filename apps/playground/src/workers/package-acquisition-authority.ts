import type { InstallAcquisitionProvenance, InstallResult } from '@riftydev/npm-client';
import type { CommandContext } from '@riftydev/shell';
import { normalizePath } from '@riftydev/vfs';
import type {
  InstallStampAuthority,
  InstallStampClaim,
  InstallStampPromotionResult,
  InstallStampTransitionOptions,
} from '../glue/install-stamp-authority.ts';
import type { PackageResetPreparation } from '../glue/package-mutation-executor.ts';

export type AcquisitionProvenance =
  | { readonly outcome: 'existing'; readonly identity: string; readonly packages: number }
  | {
      readonly outcome: 'snapshot';
      readonly snapshotId: string;
      readonly identity: string;
      readonly packages: number;
    }
  | ({ readonly outcome: 'installed' } & InstallAcquisitionProvenance);

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
  | ActivateAndEnsurePackagesCommand;

export type PackageInstallRequest =
  | Pick<EnsurePackagesCommand, 'type' | 'project' | 'packageJsonText'>
  | (Omit<TerminalInstallCommand, 'project'> & {
      readonly project: PackageAcquisitionProject;
    });

export type PackageInstallAdapterResult =
  | { readonly status: 'noop' }
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
    },
  ): Promise<void>;
  /** Parse/decode/validate the complete snapshot before any claim or tree mutation. */
  planSnapshotRestore(input: {
    readonly project: PackageAcquisitionProject;
    readonly packageJsonText: string;
    readonly snapshot: PackageSnapshotCandidate;
  }): Promise<SnapshotRestorePlan>;
  install(
    request: PackageInstallRequest,
    execution: PackageInstallExecution,
  ): Promise<PackageInstallAdapterResult>;
  reset(command: ResetPackagesCommand): Promise<void>;
  switchProject(command: ProjectSwitchCommand): Promise<void>;
}

export interface SnapshotFailure {
  readonly snapshotId: string;
  readonly reason: string;
}

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

export interface PackageAcquisitionAuthorityOptions {
  readonly stamps: InstallStampAuthority;
  /** The owner durability barrier forwarded to every stamp state transition. */
  readonly stampTransition?: InstallStampTransitionOptions;
  readonly adapter: PackageAcquisitionAdapter;
  /** FIFO-head ancestor/descendant claims affected by replacing `<root>/node_modules`. */
  readonly resolveTreeGuards?: (
    root: string,
    knownProjects: readonly PackageAcquisitionProject[],
  ) => readonly PackageMutationTransition[];
  /** Diagnostic sink only. A throwing observer cannot change acquisition. */
  readonly observe?: (event: AcquisitionObservation) => void;
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
  /** Live projects observed by this owner; retained conservatively after revoke. */
  knownProjects?(): readonly PackageAcquisitionProject[];
  /** Wait for commands admitted before this call and their detached stamp settlements. */
  quiesce(): Promise<void>;
  dispatch(command: EnsurePackagesCommand): Promise<AcquisitionProvenance>;
  dispatch(command: ActivateAndEnsurePackagesCommand): Promise<AcquisitionProvenance>;
  dispatch(command: TerminalInstallCommand): Promise<AcquisitionProvenance | undefined>;
  dispatch(command: PackageJsonEditCommand): Promise<void>;
  dispatch(command: ResetPackagesCommand): Promise<void>;
  dispatch(command: GuardedPackageMutationCommand): Promise<void>;
  dispatch(command: ProjectSwitchCommand): Promise<void>;
  dispatch(command: PackageAcquisitionCommand): Promise<AcquisitionProvenance | undefined>;
}

interface QueueEntry {
  readonly admission: number;
  readonly command: PackageAcquisitionCommand;
  readonly resolve: (value: AcquisitionProvenance | undefined) => void;
  readonly reject: (reason: unknown) => void;
}

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
  readonly #stamps: InstallStampAuthority;
  readonly #stampTransition: InstallStampTransitionOptions | undefined;
  readonly #adapter: PackageAcquisitionAdapter;
  readonly #resolveTreeGuards?: PackageAcquisitionAuthorityOptions['resolveTreeGuards'];
  readonly #observe?: (event: AcquisitionObservation) => void;
  readonly #queue: QueueEntry[] = [];
  readonly #terminalActivity = new Map<string, string>();
  readonly #knownProjects = new Map<string, PackageAcquisitionProject>();
  readonly #detachedSettlements = new Map<Promise<void>, number>();
  readonly #admissionWaiters = new Set<AdmissionWaiter>();
  #draining = false;
  #lastAdmission = 0;
  #completedAdmission = 0;
  #executingAdmission: number | null = null;

  constructor(options: PackageAcquisitionAuthorityOptions) {
    this.#stamps = options.stamps;
    this.#stampTransition = options.stampTransition;
    this.#adapter = options.adapter;
    this.#resolveTreeGuards = options.resolveTreeGuards;
    this.#observe = options.observe;
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

  dispatch(command: EnsurePackagesCommand): Promise<AcquisitionProvenance>;
  dispatch(command: ActivateAndEnsurePackagesCommand): Promise<AcquisitionProvenance>;
  dispatch(command: TerminalInstallCommand): Promise<AcquisitionProvenance | undefined>;
  dispatch(command: PackageJsonEditCommand): Promise<void>;
  dispatch(command: ResetPackagesCommand): Promise<void>;
  dispatch(command: GuardedPackageMutationCommand): Promise<void>;
  dispatch(command: ProjectSwitchCommand): Promise<void>;
  dispatch(command: PackageAcquisitionCommand): Promise<AcquisitionProvenance | undefined>;
  dispatch(command: PackageAcquisitionCommand): Promise<unknown> {
    const admission = ++this.#lastAdmission;
    const pending = new Promise<AcquisitionProvenance | undefined>((resolve, reject) => {
      this.#queue.push({
        admission,
        command,
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
        this.#executingAdmission = entry.admission;
        try {
          const value = await this.#execute(entry.command);
          entry.resolve(value);
        } catch (error) {
          entry.reject(error);
        } finally {
          this.#executingAdmission = null;
          this.#completeAdmission(entry.admission);
        }
      }
    } finally {
      this.#draining = false;
    }
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

  async #execute(command: PackageAcquisitionCommand): Promise<AcquisitionProvenance | undefined> {
    switch (command.type) {
      case 'ensure':
        this.#rememberProject(command.project);
        return this.#ensure(command);
      case 'terminal-install': {
        const project = typeof command.project === 'function' ? command.project() : command.project;
        this.#rememberProject(project);
        return this.#install({ ...command, project }, [], null);
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
        if (plan) await plan.mutate();
        else await this.#adapter.reset(command);
        return;
      }
      case 'guarded-mutation':
        if (command.preflight && !(await command.preflight())) return;
        await this.#applyMutationTransitions(command.resolveTransitions());
        await command.mutate();
        return;
      case 'project-switch':
        if (command.from) this.#rememberProject(command.from);
        this.#rememberProject(command.to);
        if (command.resetPackages) {
          await this.#applyMutationTransitions(this.#treeGuardsFor(command.to.root));
          await this.#stamps.revoke({ root: command.to.root }, this.#stampTransition);
        }
        await this.#adapter.switchProject(command);
        return;
      case 'activate-and-ensure': {
        command.register();
        const from = typeof command.from === 'function' ? command.from() : command.from;
        if (from) this.#rememberProject(from);
        this.#rememberProject(command.to);
        await this.#adapter.switchProject({ type: 'project-switch', from, to: command.to });
        return this.#ensure({
          type: 'ensure',
          project: command.to,
          packageJsonText: command.packageJsonText,
          fallback: 'install',
          ...(command.replaceTreeOnMiss ? { replaceTreeOnMiss: true } : {}),
          ...(command.onPromotion ? { onPromotion: command.onPromotion } : {}),
        });
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

  async #ensure(command: EnsurePackagesCommand): Promise<AcquisitionProvenance> {
    const existing = await this.#stamps.check({
      root: command.project.root,
      slug: command.project.slug,
      expectedPackageJsonText: command.packageJsonText,
    });
    if (
      existing.status === 'trusted' &&
      existing.stamp.installArtifactIdentity === command.project.identity
    ) {
      return {
        outcome: 'existing',
        identity: existing.stamp.installArtifactIdentity,
        packages: existing.stamp.packages,
      };
    }

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
      await this.#adapter.prepareEnsure?.(command, { claim, phase: 'initial' });
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
      },
      failures,
      claim,
      command.onPromotion,
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
  ): Promise<AcquisitionProvenance | undefined> {
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
      });
    } catch (cause) {
      throw new PackageAcquisitionError(
        request.type,
        `package install failed for ${request.project.projectId}`,
        { failure: 'install', cause, snapshotFailures },
      );
    }
    if (installed.status === 'noop') return;

    await this.#completePromotion(
      request.project,
      request.type,
      installed.packageJsonText,
      installed.result.packages.length,
      claim,
      onPromotion ?? (request.type === 'terminal-install' ? request.onPromotion : undefined),
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
    const settle = async (): Promise<void> => {
      let result: InstallStampPromotionResult;
      if (packageJsonText === null) {
        result = { status: 'refused', reason: 'identity-drift' };
      } else {
        try {
          result = await this.#stamps.promote(
            { ...project, packageJsonText },
            { epoch: claim.epoch, packages, ...this.#stampTransition },
          );
        } catch (error) {
          result = { status: 'refused', reason: 'write-failed', error: reasonOf(error) };
        }
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
