import { NotImplementedError } from '@riftydev/io';
import type { InstallResult } from '@riftydev/npm-client';
import {
  type PackageTreeShadowAssetBoundary,
  type ShadowAssetPlan,
  type ShadowAssetReadySet,
  planAppliedShadowSubstitutions,
  planShadowSubstitutionsFromLockfile,
} from '@riftydev/npm-client/internal';
import type { CommandContext } from '@riftydev/shell';
import { isAbsolute, normalizePath } from '@riftydev/vfs';
import type {
  InstallStampAuthority,
  InstallStampClaim,
  InstallStampPromotionResult,
  InstallStampTransitionOptions,
  ProjectSaveIdentity,
  ProjectSaveRebindResult,
} from '../glue/install-stamp-authority.ts';
import type { PackageResetPreparation } from '../glue/package-mutation-executor.ts';
import type {
  ProjectAcquisitionPlan,
  ProjectAcquisitionProvenance,
  ProjectSnapshotFailure,
} from '../workbench/project-materialization.ts';

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
  /** A prior config at this exact registration slot named different manifest bytes. */
  readonly replaceTrustedTree?: boolean;
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
  /** Invocation-local reflection of the generated Starter Git baseline outcome. */
  readonly onGeneratedBaseline?: (clean: boolean) => void;
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
  /** Samples exact post-mutation bytes for a strict empty-tree publication. */
  readonly readCurrentPackageJsonText?: () => string | null;
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
  readonly register: () => { readonly manifestChanged: boolean };
  /** Resolve at the FIFO head so back-to-back activations observe the actual predecessor. */
  readonly from: PackageAcquisitionProject | null | (() => PackageAcquisitionProject | null);
  readonly to: PackageAcquisitionProject;
  readonly packageJsonText: string;
  readonly replaceTreeOnMiss?: boolean;
  readonly onPromotion?: (result: InstallStampPromotionResult) => void;
}

export interface PrepareFirstMaterializationPackagesCommand {
  readonly type: 'prepare-first-materialization';
  /** Bind adapter-owned config at the FIFO head before any active-project observation. */
  readonly register: () => { readonly manifestChanged: boolean };
  readonly from: PackageAcquisitionProject | null | (() => PackageAcquisitionProject | null);
  readonly to: PackageAcquisitionProject;
  readonly packageJsonText: string;
  readonly materialization:
    | { readonly kind: 'install' }
    | { readonly kind: 'snapshot'; readonly source: PackageSnapshotSource };
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
  /** Samples exact post-mutation manifest bytes by canonical project root. */
  readonly readCurrentPackageJsonText?: (root: string) => string | null;
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
  | Pick<EnsurePackagesCommand, 'type' | 'project' | 'packageJsonText'>
  | (Omit<TerminalInstallCommand, 'project'> & {
      readonly project: PackageAcquisitionProject;
    });

export type PackageInstallAdapterResult =
  | {
      readonly status: 'noop';
      /** Exact manifest bytes whose empty dependency graph was inspected. */
      readonly packageJsonText: string | null;
      /** Canonical empty plan produced by the package adapter. */
      readonly shadowPlan: ShadowAssetPlan;
    }
  | {
      readonly status?: 'installed';
      readonly result: InstallResult;
      /** Installer-owned, frozen decode of this exact result. Never reparse its lockfile. */
      readonly shadowPlan: ShadowAssetPlan;
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
      /** Strictly decoded before any claim/tree mutation; reused without re-decoding. */
      readonly shadowPlan: ShadowAssetPlan;
      /** Applies only the already-validated immutable restore plan. */
      readonly apply: () => Promise<void>;
    }
  | { readonly status: 'rejected'; readonly reason: string };

/** Internal seam. Production composition and fault adapters share this shape. */
export interface PackageAcquisitionAdapter {
  /** Exact lockfile for a stamp-trusted tree, decoded once at trusted admission. */
  readTrustedPackageLock?(project: PackageAcquisitionProject): Promise<unknown>;
  /** Prove the exact manifest still names a physically absent package tree.
   * Sampled at the FIFO head both before publication and before child spawn. */
  attestEmptyPackageTree?(input: {
    readonly project: PackageAcquisitionProject;
    readonly packageJsonText: string;
  }): Promise<boolean>;
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

export interface PackageAcquisitionAuthorityOptions {
  readonly stamps: InstallStampAuthority;
  /** The owner durability barrier forwarded to every stamp state transition. */
  readonly stampTransition?: InstallStampTransitionOptions;
  readonly adapter: PackageAcquisitionAdapter;
  /** Real ready-asset boundary; runtime-bearing trees fail loudly when absent. */
  readonly shadowAssets?: PackageTreeShadowAssetBoundary;
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
  /** Wait for commands admitted before this call. Promotion and publication stay inside FIFO. */
  quiesce(): Promise<void>;
  /** Hold the existing package FIFO across claim-free Save and target trust publication. */
  projectSave<T>(
    input: {
      readonly source: ProjectSaveIdentity;
      readonly target: ProjectSaveIdentity;
    },
    operation: (rebind: () => Promise<ProjectSaveRebindResult>) => Promise<T>,
  ): Promise<T>;
  /** Hold trusted package-tree ancestry across readiness capture and physical child spawn. */
  reserveChildAdmission(root: string): Promise<PackageFifoReservation<PackageTreeAdmission>>;
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

export interface PackageTreeAdmission {
  readonly root: string;
  readonly project: PackageAcquisitionProject;
  readonly plan: ShadowAssetPlan;
  /** Null means the attested substitutions require zero runtime assets. */
  readonly ready: ShadowAssetReadySet | null;
}

type PackageAcquisitionResult = AcquisitionProvenance | ProjectAcquisitionPlan | undefined;

interface CommandQueueEntry {
  readonly kind: 'command';
  readonly admission: number;
  readonly command: PackageAcquisitionCommand;
  readonly resolve: (value: PackageAcquisitionResult) => void;
  readonly reject: (reason: unknown) => void;
  state: 'queued' | 'active' | 'cancelled';
  queuedAbortCleanup: (() => void) | null;
}

interface ChildAdmissionQueueEntry {
  readonly kind: 'child-admission';
  readonly admission: number;
  readonly root: string;
  readonly resolve: (value: PackageFifoReservation<PackageTreeAdmission>) => void;
  readonly reject: (reason: unknown) => void;
}

type QueueEntry = CommandQueueEntry | ChildAdmissionQueueEntry;

interface AdmissionWaiter {
  readonly through: number;
  readonly resolve: () => void;
}

const EMPTY_SHADOW_PLAN = planShadowSubstitutionsFromLockfile({
  lockfileVersion: 3,
  packages: {},
});

type PublishedPackageTree =
  | Readonly<{
      kind: 'installed';
      project: PackageAcquisitionProject;
      packageJsonText: string;
      plan: ShadowAssetPlan;
      ready: ShadowAssetReadySet | null;
      /** A manifest-only edit preserves the live tree, not its durable install claim. */
      proof: 'claim' | 'owner-runtime';
    }>
  | Readonly<{
      kind: 'empty';
      project: PackageAcquisitionProject;
      packageJsonText: string;
      plan: ShadowAssetPlan;
      ready: null;
    }>;

type PublishedPackageTreeEntry = readonly [root: string, tree: PublishedPackageTree];

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

function pathContains(container: string, candidate: string): boolean {
  return container === '/' || container === candidate || candidate.startsWith(`${container}/`);
}

function normalizeSchedulingRoot(root: string): string {
  if (!isAbsolute(root)) {
    throw new Error(`package acquisition scheduling root must be absolute; got: '${root}'`);
  }
  return normalizePath(root);
}

function resolveScheduledProject(
  command: TerminalInstallCommand | PackageJsonEditCommand,
): PackageAcquisitionProject {
  const project = typeof command.project === 'function' ? command.project() : command.project;
  return { ...project, root: normalizeSchedulingRoot(project.root) };
}

class FifoPackageAcquisitionAuthority implements PackageAcquisitionAuthority {
  readonly #stamps: InstallStampAuthority;
  readonly #stampTransition: InstallStampTransitionOptions | undefined;
  readonly #adapter: PackageAcquisitionAdapter;
  readonly #shadowAssets?: PackageTreeShadowAssetBoundary;
  readonly #resolveTreeGuards?: PackageAcquisitionAuthorityOptions['resolveTreeGuards'];
  readonly #observe?: (event: AcquisitionObservation) => void;
  readonly #queue: QueueEntry[] = [];
  readonly #terminalActivity = new Map<string, string>();
  readonly #knownProjects = new Map<string, PackageAcquisitionProject>();
  readonly #packageTrees = new Map<string, PublishedPackageTree>();
  readonly #admissionWaiters = new Set<AdmissionWaiter>();
  #draining = false;
  #lastAdmission = 0;
  #completedAdmission = 0;

  constructor(options: PackageAcquisitionAuthorityOptions) {
    this.#stamps = options.stamps;
    this.#stampTransition = options.stampTransition;
    this.#adapter = options.adapter;
    this.#shadowAssets = options.shadowAssets;
    this.#resolveTreeGuards = options.resolveTreeGuards;
    this.#observe = options.observe;
  }

  knownProjects(): readonly PackageAcquisitionProject[] {
    return [...this.#knownProjects.values()];
  }

  #rememberProject(project: PackageAcquisitionProject): void {
    const root = normalizeSchedulingRoot(project.root);
    this.#knownProjects.set(root, { ...project, root });
  }

  #invalidatePackageTrees(root: string): void {
    const canonicalRoot = normalizeSchedulingRoot(root);
    this.#packageTrees.delete(canonicalRoot);
  }

  async #publishEmptyPackageTree(
    project: PackageAcquisitionProject,
    packageJsonText: string,
  ): Promise<void> {
    const attest = this.#adapter.attestEmptyPackageTree;
    if (attest === undefined) return;
    const root = normalizeSchedulingRoot(project.root);
    const canonicalProject = Object.freeze({ ...project, root });
    if (!(await attest({ project: canonicalProject, packageJsonText }))) return;
    this.#packageTrees.set(
      root,
      Object.freeze({
        kind: 'empty',
        project: canonicalProject,
        packageJsonText,
        plan: EMPTY_SHADOW_PLAN,
        ready: null,
      }),
    );
  }

  async #deferredInstallPlan(
    project: PackageAcquisitionProject,
    packageJsonText: string,
    snapshotFailures: readonly SnapshotFailure[],
  ): Promise<ProjectAcquisitionPlan> {
    this.#invalidatePackageTrees(project.root);
    await this.#publishEmptyPackageTree(project, packageJsonText);
    return Object.freeze({
      kind: 'install',
      snapshotFailures: Object.freeze(
        snapshotFailures.map((failure) => Object.freeze({ ...failure })),
      ),
    });
  }

  async #publishPackageTree(
    project: PackageAcquisitionProject,
    packageJsonText: string,
    plan: ShadowAssetPlan,
  ): Promise<void> {
    const root = normalizeSchedulingRoot(project.root);
    const runtimeAssetsRequired = plan.assets.length > 0 || plan.bindings.length > 0;
    let ready: ShadowAssetReadySet | null = null;
    if (runtimeAssetsRequired) {
      const boundary = this.#shadowAssets;
      if (boundary === undefined) {
        throw new NotImplementedError('npm-client.packageTree.shadowAssets');
      }
      ready = await this.#publishShadowAssets(boundary, plan);
    }
    this.#packageTrees.set(
      root,
      Object.freeze({
        kind: 'installed',
        project: Object.freeze({ ...project, root }),
        packageJsonText,
        plan,
        ready,
        proof: 'claim',
      }),
    );
  }

  async #publishShadowAssets(
    boundary: PackageTreeShadowAssetBoundary,
    plan: ShadowAssetPlan,
  ): Promise<ShadowAssetReadySet> {
    return boundary.ensure(plan);
  }

  async #publishPackageLockfile(
    project: PackageAcquisitionProject,
    packageJsonText: string,
    lockfile: unknown,
  ): Promise<void> {
    await this.#publishPackageTree(
      project,
      packageJsonText,
      planShadowSubstitutionsFromLockfile(lockfile),
    );
  }

  async #assertPackageTreeAdmission(
    canonicalRoot: string,
    published: PublishedPackageTree,
  ): Promise<void> {
    if (published.kind === 'empty') {
      const attest = this.#adapter.attestEmptyPackageTree;
      const trusted =
        attest !== undefined &&
        (await attest({
          project: published.project,
          packageJsonText: published.packageJsonText,
        }));
      if (trusted) return;
      this.#packageTrees.delete(canonicalRoot);
      throw new Error(`package tree readiness is not trusted for ${canonicalRoot}`);
    }
    if (published.proof === 'owner-runtime') return;

    const trusted = await this.#stamps.check({
      root: canonicalRoot,
      slug: published.project.slug,
      expectedPackageJsonText: published.packageJsonText,
    });
    if (
      trusted.status === 'trusted' &&
      trusted.stamp.installArtifactIdentity === published.project.identity
    ) {
      return;
    }
    this.#packageTrees.delete(canonicalRoot);
    throw new Error(`package tree readiness is not trusted for ${canonicalRoot}`);
  }

  async #composePackageTreeAncestry(
    ancestry: readonly PublishedPackageTreeEntry[],
  ): Promise<Readonly<{ plan: ShadowAssetPlan; ready: ShadowAssetReadySet | null }>> {
    const substitutions: ShadowAssetPlan['substitutions'][number][] = [];
    const claimedInstallPaths = new Set<string>();
    for (const [, published] of ancestry) {
      for (const substitution of published.plan.substitutions) {
        const installPath = substitution.materialization.installPath;
        if (claimedInstallPaths.has(installPath)) continue;
        claimedInstallPaths.add(installPath);
        substitutions.push(substitution);
      }
    }

    const nearest = ancestry[0];
    if (nearest === undefined) throw new Error('package tree ancestry is empty');
    const composed =
      substitutions.length === 0 ? nearest[1].plan : planAppliedShadowSubstitutions(substitutions);
    const exactPublished = ancestry.find(
      ([, published]) => published.plan.requiredSetDigest === composed.requiredSetDigest,
    )?.[1];
    const plan = exactPublished?.plan ?? composed;
    const runtimeAssetsRequired = plan.assets.length > 0 || plan.bindings.length > 0;
    if (!runtimeAssetsRequired) return Object.freeze({ plan, ready: null });

    const reusable = ancestry
      .map(([, published]) => published.ready)
      .find(
        (ready) =>
          ready !== null &&
          ready.plan.requiredSetDigest === plan.requiredSetDigest &&
          ready.receipt.requiredSetDigest === plan.requiredSetDigest,
      );
    if (reusable) return Object.freeze({ plan, ready: reusable });

    const boundary = this.#shadowAssets;
    if (boundary === undefined) {
      throw new NotImplementedError('npm-client.packageTree.shadowAssets');
    }
    return Object.freeze({ plan, ready: await this.#publishShadowAssets(boundary, plan) });
  }

  async quiesce(): Promise<void> {
    const through = this.#lastAdmission;
    if (through === 0) return;
    await this.#waitForAdmission(through);
  }

  async projectSave<T>(
    input: {
      readonly source: ProjectSaveIdentity;
      readonly target: ProjectSaveIdentity;
    },
    operation: (rebind: () => Promise<ProjectSaveRebindResult>) => Promise<T>,
  ): Promise<T> {
    const source = Object.freeze({
      ...input.source,
      root: normalizeSchedulingRoot(input.source.root),
    });
    const target = Object.freeze({
      ...input.target,
      root: normalizeSchedulingRoot(input.target.root),
    });
    const results: T[] = [];
    let completed = false;
    try {
      await this.dispatch({
        type: 'guarded-mutation',
        resolveTransitions: () => [],
        mutate: async () => {
          let rebindAvailable = true;
          let rebindAttempted = false;
          let rebindCompleted = false;
          try {
            results.push(
              await operation(async () => {
                if (!rebindAvailable) {
                  throw new Error('project Save rebind is outside its FIFO operation');
                }
                if (rebindAttempted) throw new Error('project Save rebind was already attempted');
                rebindAttempted = true;
                const result = await this.#stamps.rebindProjectSave(
                  { source, target },
                  this.#stampTransition,
                );
                rebindCompleted = true;
                return result;
              }),
            );
            if (!rebindCompleted) throw new Error('project Save completed without trust rebind');
            completed = true;
          } finally {
            rebindAvailable = false;
          }
        },
      });
    } finally {
      this.#invalidatePackageTrees(target.root);
      this.#knownProjects.delete(target.root);
      if (completed) {
        this.#invalidatePackageTrees(source.root);
        this.#knownProjects.delete(source.root);
      }
    }
    if (!completed || results.length !== 1) {
      throw new Error('project Save completed without one result');
    }
    return results[0] as T;
  }

  reserveChildAdmission(root: string): Promise<PackageFifoReservation<PackageTreeAdmission>> {
    const canonicalRoot = normalizeSchedulingRoot(root);
    const admission = ++this.#lastAdmission;
    const pending = new Promise<PackageFifoReservation<PackageTreeAdmission>>((resolve, reject) => {
      this.#queue.push({
        kind: 'child-admission',
        admission,
        root: canonicalRoot,
        resolve,
        reject,
      });
    });
    this.#startDrain();
    return pending;
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
    const pending = new Promise<PackageAcquisitionResult>((resolve, reject) => {
      const entry: CommandQueueEntry = {
        kind: 'command',
        admission,
        command,
        resolve,
        reject,
        state: 'queued',
        queuedAbortCleanup: null,
      };
      this.#queue.push(entry);
      if (command.type === 'terminal-install' && command.context?.signal) {
        const signal = command.context.signal;
        const abortQueuedWaiter = (): void => {
          if (entry.state !== 'queued') return;
          entry.state = 'cancelled';
          entry.reject(signal.reason);
        };
        signal.addEventListener('abort', abortQueuedWaiter, { once: true });
        entry.queuedAbortCleanup = () => signal.removeEventListener('abort', abortQueuedWaiter);
        if (signal.aborted) abortQueuedWaiter();
      }
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
        try {
          if (entry.kind === 'child-admission') {
            await this.#runChildAdmission(entry);
          } else {
            entry.queuedAbortCleanup?.();
            entry.queuedAbortCleanup = null;
            if (entry.state !== 'cancelled') {
              entry.state = 'active';
              await this.#runCommand(entry);
            }
          }
        } finally {
          this.#completeAdmission(entry.admission);
        }
      }
    } finally {
      this.#draining = false;
    }
  }

  async #runCommand(entry: CommandQueueEntry): Promise<void> {
    if (entry.command.type !== 'terminal-install') {
      try {
        entry.resolve(await this.#execute(entry.command));
      } catch (error) {
        entry.reject(error);
      }
      return;
    }

    let presented = false;
    let presentedProjectId = '<unknown>';
    const present = (
      project: PackageAcquisitionProject,
      result: AcquisitionProvenance | undefined,
    ): void => {
      if (presented) return;
      presented = true;
      presentedProjectId = project.projectId;
      entry.resolve(result);
    };
    try {
      const result = await this.#execute(entry.command, present);
      if (!presented) {
        present(
          resolveScheduledProject(entry.command),
          result as AcquisitionProvenance | undefined,
        );
      }
    } catch (error) {
      if (!presented) {
        entry.reject(error);
        return;
      }
      try {
        this.#observe?.({
          type: 'promotion-refused',
          projectId: presentedProjectId,
          operation: 'terminal-install',
          reason: `settlement-failed: ${reasonOf(error)}`,
        });
      } catch {
        // Observability cannot become a second package-state owner.
      }
    }
  }

  async #runChildAdmission(entry: ChildAdmissionQueueEntry): Promise<void> {
    let snapshot: PackageTreeAdmission;
    try {
      snapshot = await this.#captureChildAdmission(entry.root);
    } catch (error) {
      entry.reject(error);
      return;
    }

    let release = (): void => {};
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
          await exited;
          release();
        },
      }),
    );
    await held;
  }

  async #captureChildAdmission(lookupPath: string): Promise<PackageTreeAdmission> {
    const ancestry = [...this.#packageTrees.entries()]
      .filter(([publishedRoot]) => pathContains(publishedRoot, lookupPath))
      .sort(([left], [right]) => right.length - left.length || left.localeCompare(right));
    const knownAncestry = [...this.#knownProjects.entries()]
      .filter(([knownRoot]) => pathContains(knownRoot, lookupPath))
      .sort(([left], [right]) => right.length - left.length || left.localeCompare(right));
    for (const [knownRoot, knownProject] of knownAncestry) {
      const published = this.#packageTrees.get(knownRoot);
      if (published === undefined) {
        throw new Error(`package tree readiness is not published for ${knownRoot}`);
      }
      if (
        published.project.projectId !== knownProject.projectId ||
        published.project.root !== knownProject.root ||
        published.project.slug !== knownProject.slug ||
        published.project.identity !== knownProject.identity
      ) {
        this.#packageTrees.delete(knownRoot);
        throw new Error(`package tree readiness is not trusted for ${knownRoot}`);
      }
    }
    const nearest = ancestry[0];
    if (nearest === undefined) {
      throw new Error(`package tree readiness is not published for ${lookupPath}`);
    }
    for (const [canonicalRoot, published] of ancestry) {
      await this.#assertPackageTreeAdmission(canonicalRoot, published);
    }
    const [canonicalRoot, published] = nearest;
    const composed = await this.#composePackageTreeAncestry(ancestry);
    return Object.freeze({
      root: canonicalRoot,
      project: published.project,
      plan: composed.plan,
      ready: composed.ready,
    });
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

  async #execute(
    command: PackageAcquisitionCommand,
    presentTerminal?: (
      project: PackageAcquisitionProject,
      result: AcquisitionProvenance | undefined,
    ) => void,
  ): Promise<PackageAcquisitionResult> {
    switch (command.type) {
      case 'ensure':
        this.#rememberProject(command.project);
        return this.#ensure(command);
      case 'terminal-install': {
        const project = resolveScheduledProject(command);
        this.#rememberProject(project);
        return this.#install({ ...command, project }, [], null, undefined, (result) => {
          presentTerminal?.(project, result);
        });
      }
      case 'package-json-edit': {
        if (command.preflight && !(await command.preflight())) return;
        const project = resolveScheduledProject(command);
        this.#rememberProject(project);
        await this.#runGuardedMutation(
          [{ mode: 'demote', project }],
          command.mutate,
          command.readCurrentPackageJsonText === undefined
            ? undefined
            : () => command.readCurrentPackageJsonText?.() ?? null,
        );
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
        if (plan) {
          if (plan.resetDependencyTree) {
            await plan.mutate(() => this.#adapter.reset(command));
          } else await plan.mutate();
        } else await this.#adapter.reset(command);
        return;
      }
      case 'guarded-mutation':
        if (command.preflight && !(await command.preflight())) return;
        await this.#runGuardedMutation(
          command.resolveTransitions(),
          command.mutate,
          command.readCurrentPackageJsonText,
        );
        return;
      case 'project-switch':
        if (command.from) this.#rememberProject(command.from);
        this.#rememberProject(command.to);
        if (command.resetPackages) {
          this.#invalidatePackageTrees(command.to.root);
          await this.#applyMutationTransitions(this.#treeGuardsFor(command.to.root));
          await this.#stamps.revoke({ root: command.to.root }, this.#stampTransition);
        }
        await this.#adapter.switchProject(command);
        return;
      case 'activate-and-ensure': {
        const registration = command.register();
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
          ...(registration.manifestChanged ? { replaceTrustedTree: true } : {}),
          ...(command.onPromotion ? { onPromotion: command.onPromotion } : {}),
        });
      }
      case 'prepare-first-materialization': {
        const registration = command.register();
        const from = typeof command.from === 'function' ? command.from() : command.from;
        if (from) this.#rememberProject(from);
        this.#rememberProject(command.to);
        await this.#adapter.switchProject({ type: 'project-switch', from, to: command.to });

        const existing = registration.manifestChanged
          ? null
          : await this.#trustedProvenance(command.to, command.packageJsonText);
        if (existing !== null) {
          return Object.freeze({ kind: 'ready', provenance: Object.freeze(existing) });
        }
        if (command.materialization.kind === 'install') {
          return this.#deferredInstallPlan(command.to, command.packageJsonText, []);
        }
        try {
          const provenance = await this.#ensure({
            type: 'ensure',
            project: command.to,
            packageJsonText: command.packageJsonText,
            snapshotSource: command.materialization.source,
            fallback: 'snapshot-only',
            ...(command.replaceTreeOnMiss ? { replaceTreeOnMiss: true } : {}),
            ...(command.onPromotion ? { onPromotion: command.onPromotion } : {}),
          });
          return Object.freeze({ kind: 'ready', provenance: Object.freeze(provenance) });
        } catch (error) {
          if (
            !(error instanceof PackageAcquisitionError) ||
            error.failure !== 'snapshot-unavailable'
          ) {
            throw error;
          }
          return this.#deferredInstallPlan(
            command.to,
            command.packageJsonText,
            error.snapshotFailures,
          );
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
    const canonicalTransitions = rawTransitions.map((raw): PackageMutationTransition => {
      const root = normalizeSchedulingRoot(raw.mode === 'revoke' ? raw.root : raw.project.root);
      return raw.mode === 'revoke'
        ? { mode: 'revoke', root }
        : { mode: 'demote', project: { ...raw.project, root } };
    });
    const byRoot = new Map<string, PackageMutationTransition>();
    for (const transition of canonicalTransitions) {
      const root = transition.mode === 'revoke' ? transition.root : transition.project.root;
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
      this.#invalidatePackageTrees(
        transition.mode === 'revoke' ? transition.root : transition.project.root,
      );
      if (transition.mode === 'revoke') {
        await this.#stamps.revoke({ root: transition.root }, this.#stampTransition);
      } else {
        await this.#stamps.demote(transition.project, this.#stampTransition);
      }
    }
  }

  async #runGuardedMutation(
    transitions: readonly PackageMutationTransition[],
    mutate: () => Promise<void>,
    readCurrentPackageJsonText?: (root: string) => string | null,
  ): Promise<void> {
    const retained = new Map<string, PublishedPackageTree>();
    for (const transition of transitions) {
      if (transition.mode !== 'demote') continue;
      const root = normalizeSchedulingRoot(transition.project.root);
      const published = this.#packageTrees.get(root);
      if (published !== undefined) retained.set(root, published);
    }

    await this.#applyMutationTransitions(transitions);
    await mutate();

    for (const transition of transitions) {
      if (transition.mode !== 'demote') continue;
      const root = normalizeSchedulingRoot(transition.project.root);
      const published = retained.get(root);
      if (published?.kind === 'installed') {
        this.#packageTrees.set(root, Object.freeze({ ...published, proof: 'owner-runtime' }));
        continue;
      }
      const packageJsonText =
        published?.kind === 'empty' ? readCurrentPackageJsonText?.(root) : undefined;
      if (packageJsonText !== undefined && packageJsonText !== null) {
        await this.#publishEmptyPackageTree(transition.project, packageJsonText);
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
      const readLockfile = this.#adapter.readTrustedPackageLock;
      if (readLockfile === undefined) {
        throw new NotImplementedError('package-acquisition.trusted-lockfile');
      }
      await this.#publishPackageLockfile(project, packageJsonText, await readLockfile(project));
      return {
        outcome: 'existing',
        identity: existing.stamp.installArtifactIdentity,
        packages: existing.stamp.packages,
      };
    }
    return null;
  }

  async #ensure(command: EnsurePackagesCommand): Promise<AcquisitionProvenance> {
    const existing = command.replaceTrustedTree
      ? null
      : await this.#trustedProvenance(command.project, command.packageJsonText);
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
      this.#invalidatePackageTrees(command.project.root);
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
          snapshotPlan.shadowPlan,
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
    presentTerminal?: (result: AcquisitionProvenance | undefined) => void,
  ): Promise<AcquisitionProvenance | undefined> {
    const rootKey = normalizeSchedulingRoot(request.project.root);
    const publishedBeforeInstall = this.#packageTrees.get(rootKey);
    const recoverableEmpty =
      publishedBeforeInstall?.kind === 'empty' ? publishedBeforeInstall : null;
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
      this.#invalidatePackageTrees(request.project.root);
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
      let failure = cause;
      if (recoverableEmpty !== null) {
        try {
          await this.#publishEmptyPackageTree(
            recoverableEmpty.project,
            recoverableEmpty.packageJsonText,
          );
        } catch (recoveryError) {
          failure = new AggregateError(
            [cause, recoveryError],
            `package install and empty-tree recovery failed for ${request.project.projectId}`,
          );
        }
      }
      throw new PackageAcquisitionError(
        request.type,
        `package install failed for ${request.project.projectId}`,
        { failure: 'install', cause: failure, snapshotFailures },
      );
    }
    if (installed.status === 'noop') {
      const provenance: AcquisitionProvenance | undefined =
        installed.packageJsonText === null
          ? undefined
          : {
              outcome: 'installed',
              resolution: 'metadata',
              packages: [],
            };
      presentTerminal?.(provenance);
      await this.#completePromotion(
        request.project,
        request.type,
        installed.packageJsonText,
        0,
        claim,
        installed.shadowPlan,
        onPromotion ?? (request.type === 'terminal-install' ? request.onPromotion : undefined),
      );
      return provenance;
    }

    const provenance = installedProvenance(installed.result);
    presentTerminal?.(provenance);
    await this.#completePromotion(
      request.project,
      request.type,
      installed.packageJsonText,
      installed.result.packages.length,
      claim,
      installed.shadowPlan,
      onPromotion ?? (request.type === 'terminal-install' ? request.onPromotion : undefined),
    );
    return provenance;
  }

  async #completePromotion(
    project: PackageAcquisitionProject,
    operation: 'ensure' | 'terminal-install',
    packageJsonText: string | null,
    packages: number,
    claim: InstallStampClaim,
    shadowPlan: ShadowAssetPlan,
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
        packageJsonText !== null &&
        result.status === 'trusted' &&
        result.stamp.installArtifactIdentity === project.identity
      ) {
        await this.#publishPackageTree(project, packageJsonText, shadowPlan);
        return;
      }
      this.#invalidatePackageTrees(project.root);
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

    await settle();
  }
}

export function createPackageAcquisitionAuthority(
  options: PackageAcquisitionAuthorityOptions,
): PackageAcquisitionAuthority {
  return new FifoPackageAcquisitionAuthority(options);
}
