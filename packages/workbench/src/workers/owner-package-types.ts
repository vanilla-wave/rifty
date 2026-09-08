import type { RegistryClient } from '@riftydev/npm-client';
import type { CommandContext, ShellCommand, ShellCommandResult } from '@riftydev/shell';
import type { PersistFailureReport, Vfs } from '@riftydev/vfs';
import type { InstallStampClaimIo } from '../glue/install-stamp-authority.ts';
import type { InstallFn } from '../glue/npm-shell-command.ts';
import type { PackageMutationExecutor } from '../glue/package-mutation-executor.ts';
import type { ProjectPackageConfig } from '../workbench/internal/project-package-config.ts';
import type {
  ProjectAcquisitionPlan,
  ProjectFirstMaterialization,
  ProjectSnapshotAdmission,
} from '../workbench/project-materialization.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';
import type {
  AcquisitionProvenance,
  PackageAcquisitionAuthority,
  PackageFifoReservation,
} from './package-acquisition-authority.ts';

export type OwnerPackageMutationKind = 'dependency' | 'package-manifest' | 'package-lock';

export interface OwnerNpmCommandOptions {
  readonly recordMutation?: (kind: OwnerPackageMutationKind, treeRevision: number) => Promise<void>;
  readonly mapInvocationContext?: (context: CommandContext) => CommandContext;
}

export interface OwnerPackageConfig {
  readonly cfg: ProjectPackageConfig;
  readonly templateId: string;
  readonly slug: string;
  readonly fromScratch: boolean;
  /** Explicit baseline files restored after package acquisition replaces node_modules. */
  readonly templateNodeModulesFiles?: Readonly<Record<string, string | Uint8Array>>;
}

export interface FirstMaterializationOwnerPackageConfig extends OwnerPackageConfig {
  readonly firstMaterialization: ProjectFirstMaterialization;
}

export interface OwnerPackageStateOptions {
  readonly initial?: OwnerPackageConfig;
  readonly primeInitialPrefetch?: boolean;
  readonly vfs: Vfs;
  readonly fsSync: OwnerVfsAuthority;
  readonly installStampClaims: InstallStampClaimIo;
  readonly flush: () => Promise<PersistFailureReport | undefined>;
  readonly nodeWorkerRuntimeEnv: Readonly<Record<string, string>>;
  readonly log: (line: string) => void;
  readonly registry?: RegistryClient;
  /** Test seam at the external registry/install boundary. */
  readonly install?: InstallFn;
  /** Fold one exact first-install lock into the fresh Starter Git baseline. */
  readonly amendGeneratedBaseline?: (root: string, lockfile: Uint8Array) => Promise<boolean>;
  readonly resolverUrl?: () => string | undefined;
  readonly resolverBundleBaseUrl?: () => string | undefined;
  readonly resolverPin?: (templateId: string) => string | undefined;
}

export interface OwnerPackageState {
  readonly mutations: PackageMutationExecutor;
  /** Register, activate, and install/reuse one exact project through one FIFO admission. */
  activateAndEnsure(
    config: FirstMaterializationOwnerPackageConfig,
    snapshotAdmission?: ProjectSnapshotAdmission,
  ): Promise<ProjectAcquisitionPlan>;
  activateAndEnsure(config: OwnerPackageConfig): Promise<AcquisitionProvenance>;
  /** Settle package commands and durability work admitted before this call. */
  quiesce(): Promise<void>;
  /** Hold the package FIFO across claim-free project Save and trust publication. */
  projectSave: PackageAcquisitionAuthority['projectSave'];
  /** Freeze the exact installed-tree shadow facts across synchronous child spawn. */
  reserveChildAdmission(root: string): Promise<OwnerChildPackageReservation>;
  /** Registers the terminal-facing config and starts its optional prefetch. */
  configure(config: OwnerPackageConfig): void;
  /** Restore an instant config without ever turning boot into an implicit install. */
  restore(config: OwnerPackageConfig): Promise<void>;
  /** Serialize the active-project transition and restore instant dependencies. */
  transition(config: OwnerPackageConfig): Promise<void>;
  /** Reassert missing template-owned node_modules files under the package FIFO. */
  reassertTemplateNodeModules(config: OwnerPackageConfig): Promise<void>;
  /** The npm command already bound to the same acquisition/stamp authority. */
  createNpmCommand(
    runScript: (name: string, command: string, ctx: CommandContext) => Promise<ShellCommandResult>,
    options?: OwnerNpmCommandOptions,
  ): ShellCommand;
}

export interface OwnerChildPackageAdmission {
  readonly root: string;
  readonly runtimeBindings: readonly Readonly<{ adapterId: string; packagePath: string }>[];
}

export type OwnerChildPackageReservation = PackageFifoReservation<OwnerChildPackageAdmission>;
