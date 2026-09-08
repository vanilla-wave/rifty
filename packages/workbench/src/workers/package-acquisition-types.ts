import type { InstallResult } from '@riftydev/npm-client';
import type { ShadowSubstitutionPlan } from '@riftydev/npm-client/internal';
import type { CommandContext } from '@riftydev/shell';
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
  ProjectSnapshotAdmission,
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
  readonly requireTrustedSnapshot?: boolean;
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
  readonly register: () => { readonly manifestChanged: boolean; readonly restore?: () => void };
  readonly from: PackageAcquisitionProject | null | (() => PackageAcquisitionProject | null);
  readonly to: PackageAcquisitionProject;
  readonly packageJsonText: string;
  readonly materialization:
    | { readonly kind: 'install' }
    | {
        readonly kind: 'snapshot';
        readonly source: PackageSnapshotSource;
        readonly conflict?: 'error' | 'overwrite';
      };
  readonly snapshotAdmission?: ProjectSnapshotAdmission;
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
      readonly shadowPlan: ShadowSubstitutionPlan;
    }
  | {
      readonly status?: 'installed';
      readonly result: InstallResult;
      /** Installer-owned, frozen decode of this exact result. Never reparse its lockfile. */
      readonly shadowPlan: ShadowSubstitutionPlan;
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
      readonly shadowPlan: ShadowSubstitutionPlan;
      /** Applies only the already-validated immutable restore plan. */
      readonly apply: () => Promise<void>;
    }
  | { readonly status: 'rejected'; readonly reason: string };

export interface SnapshotApplicationPlan {
  readonly packages: number;
  readonly packageJsonText: string;
  readonly shadowPlan: ShadowSubstitutionPlan;
  readonly transitions: readonly PackageMutationTransition[];
  prepareCache(): Promise<void>;
  apply(): Promise<void>;
}

/** Internal seam. Production composition and fault adapters share this shape. */
export interface PackageAcquisitionAdapter {
  planSnapshotApplication?(input: {
    readonly project: PackageAcquisitionProject;
    readonly snapshot: PackageSnapshotCandidate;
    readonly conflict: 'error' | 'overwrite';
    readonly preflightRoot?: string;
    readonly knownProjects: readonly PackageAcquisitionProject[];
  }): Promise<SnapshotApplicationPlan>;
  snapshotManifestApplied?(project: PackageAcquisitionProject, packageJsonText: string): void;
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
  readonly plan: ShadowSubstitutionPlan;
  readonly runtimeBindings: readonly Readonly<{ adapterId: string; packagePath: string }>[];
}

export type PackageAcquisitionResult = AcquisitionProvenance | ProjectAcquisitionPlan | undefined;
