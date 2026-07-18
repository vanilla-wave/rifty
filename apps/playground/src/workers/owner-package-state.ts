import { NotImplementedError } from '@riftydev/io';
import type {
  RegistryClient,
  ShadowAssetEnsureOptions,
  ShadowAssetPlan,
  ShadowAssetReadyReceipt,
} from '@riftydev/npm-client';
import type { CommandContext, ShellCommand, ShellCommandResult } from '@riftydev/shell';
import type { PersistFailureReport, Vfs } from '@riftydev/vfs';
import { normalizePath } from '@riftydev/vfs';
import {
  type DepSnapshotV2,
  fetchVerifiedDepSnapshot,
  prepareDepSnapshotRestore,
} from '../glue/dep-snapshot.ts';
import {
  learnedPinForPackageJsonSync,
  readLearnedPin,
  revalidateLearnedPin,
  writeLearnedPin,
} from '../glue/eddy-learned-pins.ts';
import { installArtifactIdentity } from '../glue/install-artifact-identity.ts';
import { decideInstallPrefetch, startInstallPrefetch } from '../glue/install-prefetch.ts';
import {
  type InstallStampClaimIo,
  createInstallStampAuthority,
} from '../glue/install-stamp-authority.ts';
import {
  type InstallFn,
  type NpmShellCommandDeps,
  createNpmShellCommand,
  executeNpmInstallOperation,
  parseNpmInstallRequest,
} from '../glue/npm-shell-command.ts';
import {
  type PackageMutationExecutor,
  createPackageMutationExecutor,
  discoverPackageAcquisitionGuardTransitions,
} from '../glue/package-mutation-executor.ts';
import {
  clearProjectTree,
  ensureProjectDependencies,
  prepareProjectInstallTree,
  seedTemplateNodeModulesFiles,
  templateNodeModulesSeedMutationIntents,
} from '../glue/project-deps.ts';
import { createProxiedRegistryClient } from '../glue/registry-fetch.ts';
import { getEddyBundleBaseUrl, getEddyPin, getResolverUrl } from '../glue/resolver-config.ts';
import type { ProjectPackageConfig } from '../workbench/internal/project-package-config.ts';
import type {
  ProjectAcquisitionPlan,
  ProjectFirstMaterialization,
} from '../workbench/project-materialization.ts';
import { shouldCleanForDevBootWithInstallState } from './dev-boot-clean.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';
import {
  type AcquisitionProvenance,
  type PackageAcquisitionProject,
  type PackageRuntimeAssetPort,
  type PackageTreeRuntimeAssetReadiness,
  createPackageAcquisitionAuthority,
} from './package-acquisition-authority.ts';
import {
  finalizePackageInstallFiles,
  finalizePackageInstallResult,
} from './package-install-finalizer.ts';
import { PackageTreeUnattestedError } from './package-tree-unattested-error.ts';

export { PackageTreeUnattestedError };

const enc = new TextEncoder();

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
  /** Exact npm-client facts producer plus the storage-owned readiness installer. */
  readonly runtimeAssets?: PackageRuntimeAssetPort;
  /** Test seam at the external registry/install boundary. */
  readonly install?: InstallFn;
  readonly resolverUrl?: () => string | undefined;
  readonly resolverBundleBaseUrl?: () => string | undefined;
  readonly resolverPin?: (templateId: string) => string | undefined;
}

export interface OwnerPackageState {
  readonly mutations: PackageMutationExecutor;
  /** Register, activate, and install/reuse one exact project through one FIFO admission. */
  activateAndEnsure(
    config: FirstMaterializationOwnerPackageConfig,
    runtimeAssets?: ShadowAssetEnsureOptions,
  ): Promise<ProjectAcquisitionPlan>;
  activateAndEnsure(
    config: OwnerPackageConfig,
    runtimeAssets?: ShadowAssetEnsureOptions,
  ): Promise<AcquisitionProvenance>;
  /** Settle package commands and durability work admitted before this call. */
  quiesce(): Promise<void>;
  /** Read only the exact active owner project; epoch evidence never crosses owner IPC. */
  readPackageTreeEpoch(project: OwnerPackageTreeProject): OwnerPackageTreeEpoch;
  /** Idempotent acquisition-token barrier before the first installed-tree write. */
  beginTreeMutation(project: OwnerPackageTreeProject, acquisitionToken: object): void;
  /** Hold the package FIFO across synchronous physical child spawn and supervision attach. */
  reserveChildAdmission(
    project: OwnerPackageTreeProject,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<OwnerChildAdmissionReservation>;
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

export interface OwnerPackageTreeProject {
  readonly root: string;
  readonly slug: string;
}

export type OwnerPackageTreeReadiness =
  | Readonly<{ kind: 'unavailable' }>
  | Readonly<{ kind: 'not-required' }>
  | Readonly<{ kind: 'pending'; plan: ShadowAssetPlan }>
  | Readonly<{
      kind: 'ready';
      plan: ShadowAssetPlan;
      receipt: ShadowAssetReadyReceipt;
    }>;

export interface OwnerPackageTreeEpoch {
  readonly project: OwnerPackageTreeProject;
  readonly sequence: number;
  readonly readiness: OwnerPackageTreeReadiness;
}

export interface OwnerChildAdmissionReservation {
  readonly readiness: Extract<OwnerPackageTreeReadiness, { kind: 'not-required' | 'ready' }>;
  commit(): void;
  abortBeforeSpawn(error: unknown): void;
  abortAfterChildSettlement(error: unknown, exited: Promise<unknown>): Promise<void>;
}

interface FirstMaterializationState {
  readonly consumptions: Set<object>;
}

function configKey(root: string, slug: string): string {
  return `${normalizePath(root)}\0${slug}`;
}

function packageProject(config: OwnerPackageConfig): PackageAcquisitionProject {
  return {
    projectId: config.slug,
    root: config.cfg.root,
    slug: config.slug,
    identity: installArtifactIdentity,
  };
}

function hasFirstMaterialization(
  config: OwnerPackageConfig,
): config is FirstMaterializationOwnerPackageConfig {
  return Object.hasOwn(config, 'firstMaterialization');
}

function isBareInstallCommand(args: readonly string[]): boolean {
  const subcommand = args[0];
  if (subcommand !== 'install' && subcommand !== 'i' && subcommand !== 'add') return false;
  const parsed = parseNpmInstallRequest(args.slice(1));
  return parsed.status === 'ready' && parsed.request.packageSpecs.length === 0;
}

function decodeChunk(chunk: string | Uint8Array): string {
  return typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
}

function optionalFile(authority: OwnerVfsAuthority, path: string): Uint8Array | null {
  return authority.statSyncOrNull(path)?.isFile === true ? authority.readFileBytesSync(path) : null;
}

function equalOptionalBytes(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (left === null || right === null) return left === right;
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

export function createOwnerPackageState(options: OwnerPackageStateOptions): OwnerPackageState {
  const configs = new Map<string, OwnerPackageConfig>();

  const templateNodeModulesFiles = (
    config: OwnerPackageConfig,
  ): Readonly<Record<string, string | Uint8Array>> =>
    config.templateNodeModulesFiles ?? config.cfg.seedFiles;
  let configured = options.initial;
  let activeProject = options.initial ? packageProject(options.initial) : null;
  let activeTemplateId: string | null = null;
  let packageTreeSequence = 0;
  let packageTreeEpoch: OwnerPackageTreeEpoch | null = null;
  const treeMutationTokens = new WeakMap<object, string>();
  const firstMaterializations = new Map<string, FirstMaterializationState>();

  const canonicalTreeProject = (project: OwnerPackageTreeProject): OwnerPackageTreeProject =>
    Object.freeze({ root: normalizePath(project.root), slug: project.slug });
  const treeProjectMatches = (
    left: OwnerPackageTreeProject,
    right: OwnerPackageTreeProject,
  ): boolean => left.root === right.root && left.slug === right.slug;
  const freezeReadiness = (readiness: OwnerPackageTreeReadiness): OwnerPackageTreeReadiness => {
    switch (readiness.kind) {
      case 'unavailable':
      case 'not-required':
        return Object.freeze({ kind: readiness.kind });
      case 'pending':
        return Object.freeze({ kind: 'pending', plan: readiness.plan });
      case 'ready':
        return Object.freeze({
          kind: 'ready',
          plan: readiness.plan,
          receipt: readiness.receipt,
        });
    }
  };
  const replacePackageTreeEpoch = (
    project: OwnerPackageTreeProject,
    readiness: OwnerPackageTreeReadiness,
  ): OwnerPackageTreeEpoch => {
    if (
      !Number.isSafeInteger(packageTreeSequence) ||
      packageTreeSequence >= Number.MAX_SAFE_INTEGER
    ) {
      throw new RangeError('owner package-tree epoch sequence exhausted');
    }
    const next = Object.freeze({
      project: canonicalTreeProject(project),
      sequence: packageTreeSequence + 1,
      readiness: freezeReadiness(readiness),
    });
    packageTreeSequence = next.sequence;
    packageTreeEpoch = next;
    return next;
  };
  const readPackageTreeEpoch = (project: OwnerPackageTreeProject): OwnerPackageTreeEpoch => {
    const epoch = packageTreeEpoch;
    if (
      epoch === null ||
      normalizePath(project.root) !== project.root ||
      !treeProjectMatches(epoch.project, project)
    ) {
      throw new Error(`package-tree epoch project mismatch for ${project.slug} at ${project.root}`);
    }
    return epoch;
  };
  const beginTreeMutation = (project: OwnerPackageTreeProject, acquisitionToken: object): void => {
    if (typeof acquisitionToken !== 'object' || acquisitionToken === null) {
      throw new TypeError('package-tree mutation requires an acquisition token object');
    }
    const epoch = readPackageTreeEpoch(project);
    const key = configKey(epoch.project.root, epoch.project.slug);
    const prior = treeMutationTokens.get(acquisitionToken);
    if (prior !== undefined) {
      if (prior !== key) throw new Error('package-tree mutation token belongs to another project');
      return;
    }
    replacePackageTreeEpoch(epoch.project, { kind: 'unavailable' });
    treeMutationTokens.set(acquisitionToken, key);
  };
  const publishTreeReadiness = (
    project: OwnerPackageTreeProject,
    readiness: PackageTreeRuntimeAssetReadiness,
  ): void => {
    const epoch = readPackageTreeEpoch(project);
    replacePackageTreeEpoch(epoch.project, readiness);
  };
  const publishUnavailableProject = (project: OwnerPackageTreeProject): void => {
    replacePackageTreeEpoch(project, { kind: 'unavailable' });
  };
  if (options.initial) {
    configs.set(configKey(options.initial.cfg.root, options.initial.slug), options.initial);
    publishUnavailableProject(packageProject(options.initial));
  }

  const registry = options.registry ?? createProxiedRegistryClient();
  const resolverUrl = options.resolverUrl ?? getResolverUrl;
  const resolverBundleBaseUrl = options.resolverBundleBaseUrl ?? getEddyBundleBaseUrl;
  const resolverPin = options.resolverPin ?? getEddyPin;
  const stamps = createInstallStampAuthority({
    vfs: options.vfs,
    fsSync: options.fsSync,
    claimIo: options.installStampClaims,
  });
  let installPrefetch: ReturnType<typeof startInstallPrefetch>;
  let installPrefetchConfig: string | undefined;

  const configFor = (project: PackageAcquisitionProject): OwnerPackageConfig => {
    const found = configs.get(configKey(project.root, project.slug));
    if (!found) {
      throw new Error(`package acquisition config missing for ${project.slug} at ${project.root}`);
    }
    return found;
  };

  const primePrefetch = (config: OwnerPackageConfig): void => {
    const url = resolverUrl();
    const identity = JSON.stringify([
      config.templateId,
      config.cfg.root,
      config.slug,
      config.cfg.packageJson,
    ]);
    const decision = decideInstallPrefetch({
      devFromScratch: config.fromScratch,
      resolverUrl: url,
      config: identity,
      hasHandle: installPrefetch !== undefined,
      prevConfig: installPrefetchConfig,
      isStamped: () => {
        const checked = stamps.checkSync({
          root: config.cfg.root,
          slug: config.slug,
          expectedPackageJsonText: config.cfg.packageJson,
        });
        return (
          checked.status === 'trusted' &&
          checked.stamp.installArtifactIdentity === installArtifactIdentity
        );
      },
      pinFor: () =>
        learnedPinForPackageJsonSync(options.fsSync, config.cfg.packageJson) ??
        resolverPin(config.templateId),
    });
    if (decision.kind === 'keep') return;
    if (decision.kind === 'clear') {
      installPrefetch = undefined;
      installPrefetchConfig = undefined;
      return;
    }
    installPrefetchConfig = decision.config;
    installPrefetch =
      decision.kind === 'start'
        ? startInstallPrefetch({
            packageJsonText: config.cfg.packageJson,
            resolverUrl: url as string,
            closureHash: decision.closureHash,
            bundleBaseUrl: resolverBundleBaseUrl(),
          })
        : undefined;
  };

  const baseNpmDeps: NpmShellCommandDeps = {
    vfs: options.vfs,
    registry,
    ...(options.install ? { install: options.install } : {}),
    assertPortablePaths: (paths) => options.fsSync.assertPortablePaths(paths),
    flush: options.flush,
    projectSlug: (root) => {
      const normalized = normalizePath(root);
      return activeProject && normalized === normalizePath(activeProject.root)
        ? activeProject.slug
        : `root:${normalized}`;
    },
    resolverUrl: resolverUrl(),
    resolverBundleBaseUrl: resolverBundleBaseUrl(),
    learnedPins: {
      get: (key) => readLearnedPin(options.vfs, key),
      set: async (key, hash, expectedCurrent) => {
        await writeLearnedPin(options.vfs, key, hash, undefined, expectedCurrent);
      },
      revalidate: async (_key, request, servedHash) => {
        const url = resolverUrl();
        if (!url) throw new Error('eddy resolver is not configured');
        await revalidateLearnedPin({
          vfs: options.vfs,
          resolverUrl: url,
          request,
          staleClosureHash: servedHash,
        });
      },
    },
  };

  const packages = createPackageAcquisitionAuthority({
    stamps,
    stampTransition: { flush: options.flush },
    ...(options.runtimeAssets ? { runtimeAssets: options.runtimeAssets } : {}),
    beginTreeMutation,
    publishTreeReadiness,
    resolveTreeGuards: (root, knownProjects) =>
      discoverPackageAcquisitionGuardTransitions(options.fsSync, knownProjects, root),
    observe: (event) => {
      if (event.type === 'promotion-refused') {
        console.warn(
          `[shell-owner/worker] package stamp promotion refused for ${event.projectId}: ${event.reason}`,
        );
      }
    },
    captureDeferredTerminalConsumption: () => {
      if (activeProject === null) return null;
      const key = configKey(activeProject.root, activeProject.slug);
      const state = firstMaterializations.get(key);
      if (!state) return null;
      const token = Object.freeze({});
      state.consumptions.add(token);
      let settled = false;
      return Object.freeze({
        reuseTrustedClaim: true as const,
        settle: (outcome: 'success' | 'failure'): void => {
          if (settled) throw new Error('deferred terminal consumption already settled');
          settled = true;
          state.consumptions.delete(token);
          if (firstMaterializations.get(key) !== state) return;
          if (outcome === 'success') firstMaterializations.delete(key);
        },
      });
    },
    adapter: {
      prepareEnsure: async (command, execution) => {
        if (!command.replaceTreeOnMiss) return;
        execution.beginTreeMutation();
        if (execution.phase === 'snapshot-rejected') {
          clearProjectTree(options.fsSync, command.project.root);
          options.fsSync.writeFileSync(
            normalizePath(`${command.project.root}/package.json`),
            enc.encode(command.packageJsonText),
          );
          return;
        }
        prepareProjectInstallTree(options.fsSync, command.project.root, {
          packageJsonText: command.packageJsonText,
          currentSlug: command.project.slug,
          ...(execution.claim.priorSlug ? { priorSlug: execution.claim.priorSlug } : {}),
          priorTrustedTree: false,
        });
      },
      planSnapshotRestore: async ({
        project,
        snapshot,
        beginTreeMutation: beginSnapshotMutation,
      }) => {
        const payload = snapshot.payload as DepSnapshotV2 | undefined;
        if (!payload) return { status: 'rejected', reason: 'snapshot-payload-missing' };
        try {
          const prepared = prepareDepSnapshotRestore(options.fsSync, project.root, payload);
          const config = configFor(project);
          return {
            status: 'ready',
            packages: payload.packages,
            apply: async () => {
              beginSnapshotMutation();
              prepared.apply();
              seedTemplateNodeModulesFiles(
                options.fsSync,
                config.cfg.root,
                templateNodeModulesFiles(config),
              );
              await finalizePackageInstallFiles({ root: project.root });
            },
          } as const;
        } catch (error) {
          return {
            status: 'rejected',
            reason: `snapshot-restore-plan-failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          } as const;
        }
      },
      install: async (request, execution) => {
        const parsed = parseNpmInstallRequest(
          request.type === 'terminal-install' ? request.argv : [],
        );
        if (parsed.status === 'rejected') throw new Error(parsed.message.trimEnd());
        const config = configs.get(configKey(request.project.root, request.project.slug));
        const acquisitionNpmDeps: NpmShellCommandDeps = {
          ...baseNpmDeps,
          ...(execution.beginTreeMutation
            ? { onTreeMutationStart: execution.beginTreeMutation }
            : {}),
          ...(options.runtimeAssets
            ? {
                shadowAssets: {
                  installer: options.runtimeAssets.installer,
                  ...(request.runtimeAssets ? { options: request.runtimeAssets } : {}),
                },
              }
            : {}),
        };
        const operationDeps: NpmShellCommandDeps = config
          ? {
              ...acquisitionNpmDeps,
              prepareInstall: async (ctx, info) => {
                if (!config.fromScratch || !info.fullInstall) return;
                if (normalizePath(ctx.cwd) !== normalizePath(request.project.root)) return;
                if (info.priorTrustedTree) return;
                if (info.priorSessionSlug === request.project.slug) return;
                execution.beginTreeMutation?.();
                prepareProjectInstallTree(options.fsSync, request.project.root, {
                  packageJsonText: config.cfg.packageJson,
                  currentSlug: request.project.slug,
                  ...(info.priorSlug ? { priorSlug: info.priorSlug } : {}),
                  priorTrustedTree: info.priorTrustedTree,
                });
              },
              resolverClosureHash: () => resolverPin(config.templateId),
              resolverPrefetch: () =>
                configured !== undefined &&
                configKey(configured.cfg.root, configured.slug) ===
                  configKey(request.project.root, request.project.slug)
                  ? installPrefetch
                  : undefined,
            }
          : acquisitionNpmDeps;
        const sink = {
          write: (chunk: string | Uint8Array): void => options.log(decodeChunk(chunk)),
        };
        const context: CommandContext =
          request.type === 'terminal-install'
            ? (request.context ??
              (() => {
                throw new Error('terminal package acquisition requires its shell context');
              })())
            : {
                cwd: request.project.root,
                env: { ...options.nodeWorkerRuntimeEnv },
                stdout: sink,
                stderr: sink,
              };
        if (
          request.type === 'terminal-install' &&
          config !== undefined &&
          hasFirstMaterialization(config)
        ) {
          const packageSpecs = request.argv.length === 0 ? '' : ` ${request.argv.join(' ')}`;
          context.stdout.write(`$ npm install${packageSpecs}\n`);
        }
        const installed = await executeNpmInstallOperation(
          parsed.request,
          context,
          operationDeps,
          execution,
        );
        return finalizePackageInstallResult(installed, {
          root: request.project.root,
          ...(config
            ? {
                seedTemplateFiles: () =>
                  seedTemplateNodeModulesFiles(
                    options.fsSync,
                    config.cfg.root,
                    templateNodeModulesFiles(config),
                  ),
              }
            : {}),
        });
      },
      reset: async (command) => clearProjectTree(options.fsSync, command.target.root),
      switchProject: async (command, execution) => {
        if (command.resetPackages) {
          if (command.packageJsonText === undefined) {
            throw new NotImplementedError('package-acquisition.project-switch.package-json');
          }
        }
        const destination = canonicalTreeProject(command.to);
        if (
          packageTreeEpoch === null ||
          !treeProjectMatches(packageTreeEpoch.project, destination)
        ) {
          publishUnavailableProject(destination);
        }
        if (command.resetPackages) {
          execution.beginTreeMutation();
          clearProjectTree(options.fsSync, command.to.root);
          options.fsSync.writeFileSync(
            normalizePath(`${command.to.root}/package.json`),
            enc.encode(command.packageJsonText),
          );
        }
        activeProject = command.to;
        activeTemplateId = configFor(command.to).templateId;
      },
    },
  });

  const mutations = createPackageMutationExecutor({
    packages,
    fs: options.fsSync,
    assertPortablePaths: (paths) => options.fsSync.assertPortablePaths(paths),
    activeProject: () => {
      if (!activeProject) throw new Error('package acquisition project is not active');
      return activeProject;
    },
    beginTreeMutation,
  });

  const reassertTemplateNodeModules = async (config: OwnerPackageConfig): Promise<void> => {
    let intents: ReturnType<typeof templateNodeModulesSeedMutationIntents> = [];
    await mutations.guardedMutation(
      () => intents,
      async () =>
        seedTemplateNodeModulesFiles(
          options.fsSync,
          config.cfg.root,
          templateNodeModulesFiles(config),
        ),
      async () => {
        intents = templateNodeModulesSeedMutationIntents(
          options.fsSync,
          config.cfg.root,
          templateNodeModulesFiles(config),
        );
        return intents.length === 0 ? { status: 'noop', value: undefined } : { status: 'ready' };
      },
    );
  };

  const configure = (config: OwnerPackageConfig): void => {
    configured = config;
    configs.set(configKey(config.cfg.root, config.slug), config);
    primePrefetch(config);
  };

  const restore = async (config: OwnerPackageConfig): Promise<void> => {
    if (!config.cfg.bakedNodeModulesUrl) return;
    const result = await ensureProjectDependencies({
      vfs: options.vfs,
      fsSync: options.fsSync,
      packageAcquisitionAuthority: packages,
      root: config.cfg.root,
      templateId: config.templateId,
      snapshotTemplateId: config.cfg.bakedNodeModulesTemplateId,
      slug: config.slug,
      snapshotUrl: config.cfg.bakedNodeModulesUrl,
      packageJsonText: config.cfg.packageJson,
      replaceTreeOnMiss: true,
      log: options.log,
      flush: options.flush,
    });
    if (result.source === 'none') {
      console.warn(
        `[shell-owner/worker] instant snapshot unavailable/stale for ${config.templateId} — node_modules absent (re-run \`pnpm snapshots:bake\`)`,
      );
    }
  };

  function activateAndEnsure(
    config: FirstMaterializationOwnerPackageConfig,
    runtimeAssets?: ShadowAssetEnsureOptions,
  ): Promise<ProjectAcquisitionPlan>;
  function activateAndEnsure(
    config: OwnerPackageConfig,
    runtimeAssets?: ShadowAssetEnsureOptions,
  ): Promise<AcquisitionProvenance>;
  function activateAndEnsure(
    config: OwnerPackageConfig,
    runtimeAssets?: ShadowAssetEnsureOptions,
  ): Promise<ProjectAcquisitionPlan | AcquisitionProvenance> {
    if (!hasFirstMaterialization(config)) {
      return packages.dispatch({
        type: 'activate-and-ensure',
        register: () => configure(config),
        from: () => activeProject,
        to: packageProject(config),
        packageJsonText: config.cfg.packageJson,
        replaceTreeOnMiss: true,
        ...(runtimeAssets === undefined ? {} : { runtimeAssets }),
      });
    }

    const materialization = config.firstMaterialization;
    const key = configKey(config.cfg.root, config.slug);
    const firstMaterialization: FirstMaterializationState = {
      consumptions: new Set(),
    };
    firstMaterializations.set(key, firstMaterialization);
    const prepared = packages.dispatch({
      type: 'prepare-first-materialization',
      register: () => configure(config),
      from: () => activeProject,
      to: packageProject(config),
      packageJsonText: config.cfg.packageJson,
      materialization:
        materialization.kind === 'install'
          ? { kind: 'install' }
          : {
              kind: 'snapshot',
              source: {
                snapshotId: materialization.snapshot.snapshotId,
                resolve: async () => {
                  const verified = await fetchVerifiedDepSnapshot(
                    materialization.snapshot.assetUrl,
                    materialization.snapshot.snapshotId,
                  );
                  if (verified.status === 'mismatch') {
                    return { status: 'rejected' as const, reason: 'snapshot-id-mismatch' };
                  }
                  const snapshot = verified.snapshot;
                  if (snapshot.templateId !== materialization.snapshot.templateId) {
                    return { status: 'rejected' as const, reason: 'snapshot-template-mismatch' };
                  }
                  return {
                    status: 'candidate' as const,
                    snapshot: {
                      snapshotId: materialization.snapshot.snapshotId,
                      identity: snapshot.installArtifactIdentity,
                      packageJsonText: snapshot.packageJsonText,
                      payload: snapshot,
                    },
                  };
                },
              },
            },
      replaceTreeOnMiss: true,
      ...(runtimeAssets === undefined ? {} : { runtimeAssets }),
    });
    void prepared.then(
      (plan) => {
        if (firstMaterializations.get(key) !== firstMaterialization) return;
        if (plan.kind !== 'install') firstMaterializations.delete(key);
      },
      () => {
        if (firstMaterializations.get(key) === firstMaterialization) {
          firstMaterializations.delete(key);
        }
      },
    );
    return prepared;
  }

  const transition = async (config: OwnerPackageConfig): Promise<void> => {
    configs.set(configKey(config.cfg.root, config.slug), config);
    const checked = config.fromScratch
      ? await stamps.check({
          root: config.cfg.root,
          slug: config.slug,
          expectedPackageJsonText: config.cfg.packageJson,
        })
      : null;
    const clean = shouldCleanForDevBootWithInstallState({
      lastTemplateId: activeTemplateId,
      lastRoot: activeProject?.root ?? null,
      nextTemplateId: config.templateId,
      nextRoot: config.cfg.root,
      fromScratch: config.fromScratch,
      installStampSatisfied:
        checked?.status === 'trusted' &&
        checked.stamp.installArtifactIdentity === installArtifactIdentity,
    });
    await packages.dispatch({
      type: 'project-switch',
      from: activeProject,
      to: packageProject(config),
      resetPackages: clean && !config.fromScratch,
      ...(clean && !config.fromScratch ? { packageJsonText: config.cfg.packageJson } : {}),
    });
    if (!config.fromScratch) await restore(config);
  };

  const reserveChildAdmission = async (
    project: OwnerPackageTreeProject,
    admissionOptions: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<OwnerChildAdmissionReservation> => {
    const signal = admissionOptions.signal;
    const throwIfAdmissionAborted = (): void => {
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
    };
    throwIfAdmissionAborted();
    type AttestedReadiness = Extract<OwnerPackageTreeReadiness, { kind: 'not-required' | 'ready' }>;
    const held = await packages.reserveChildAdmission<AttestedReadiness>(async () => {
      throwIfAdmissionAborted();
      let epoch: OwnerPackageTreeEpoch;
      try {
        epoch = readPackageTreeEpoch(project);
      } catch {
        throw new PackageTreeUnattestedError(project);
      }
      if (epoch.readiness.kind === 'unavailable') {
        throw new PackageTreeUnattestedError(project);
      }
      if (epoch.readiness.kind === 'pending') {
        const runtimeAssets = options.runtimeAssets;
        if (!runtimeAssets) throw new PackageTreeUnattestedError(project);
        const pendingSequence = epoch.sequence;
        const pendingPlan = epoch.readiness.plan;
        const ensured = await runtimeAssets.installer.ensure(
          pendingPlan,
          signal === undefined ? undefined : { signal },
        );
        throwIfAdmissionAborted();
        if (
          ensured.kind !== 'ready' ||
          ensured.plan.requiredSetDigest !== pendingPlan.requiredSetDigest
        ) {
          throw new Error('child admission runtime-asset readiness did not attest its exact plan');
        }
        let current: OwnerPackageTreeEpoch;
        try {
          current = readPackageTreeEpoch(project);
        } catch {
          throw new PackageTreeUnattestedError(project);
        }
        if (
          current.sequence !== pendingSequence ||
          current.readiness.kind !== 'pending' ||
          current.readiness.plan.requiredSetDigest !== pendingPlan.requiredSetDigest
        ) {
          throw new PackageTreeUnattestedError(project);
        }
        publishTreeReadiness(project, {
          kind: 'ready',
          plan: pendingPlan,
          receipt: ensured.receipt,
        });
        epoch = readPackageTreeEpoch(project);
      }
      if (epoch.readiness.kind !== 'not-required' && epoch.readiness.kind !== 'ready') {
        throw new PackageTreeUnattestedError(project);
      }
      return epoch.readiness;
    });
    try {
      throwIfAdmissionAborted();
    } catch (error) {
      held.abortBeforeSpawn(error);
      throw error;
    }
    return Object.freeze({
      readiness: held.snapshot,
      commit: (): void => held.commit(),
      abortBeforeSpawn: (error: unknown): void => held.abortBeforeSpawn(error),
      abortAfterChildSettlement: (error: unknown, exited: Promise<unknown>): Promise<void> =>
        held.abortAfterChildSettlement(error, exited),
    });
  };

  if (options.primeInitialPrefetch) {
    if (!options.initial) throw new Error('initial package config required to prime prefetch');
    primePrefetch(options.initial);
  }

  return {
    mutations,
    activateAndEnsure,
    quiesce: () => packages.quiesce(),
    readPackageTreeEpoch,
    beginTreeMutation,
    reserveChildAdmission,
    configure,
    restore,
    transition,
    reassertTemplateNodeModules,
    createNpmCommand: (runScript, commandOptions = {}) => {
      const command = createNpmShellCommand({
        ...baseNpmDeps,
        packageAcquisitionAuthority: packages,
        runScript,
        ...(commandOptions.mapInvocationContext === undefined
          ? {}
          : { mapInvocationContext: commandOptions.mapInvocationContext }),
      });
      return async (args, context) => {
        const config = configured;
        const reflectionContext = commandOptions.mapInvocationContext?.(context) ?? context;
        if (
          config === undefined ||
          normalizePath(reflectionContext.cwd) !== normalizePath(config.cfg.root) ||
          commandOptions.recordMutation === undefined
        ) {
          return command(args, context);
        }

        const key = configKey(config.cfg.root, config.slug);
        const firstDependencyArrival = firstMaterializations.has(key) && isBareInstallCommand(args);
        const packageJsonPath = normalizePath(`${config.cfg.root}/package.json`);
        const packageLockPath = normalizePath(`${config.cfg.root}/package-lock.json`);
        const priorTreeRevision = options.fsSync.treeRevision;
        const priorPackageJson = optionalFile(options.fsSync, packageJsonPath);
        const priorPackageLock = optionalFile(options.fsSync, packageLockPath);
        let result: ShellCommandResult | undefined;
        let commandFailure: unknown;
        try {
          result = await command(args, context);
        } catch (error) {
          commandFailure = error;
        }

        let recordFailure: unknown;
        try {
          const treeRevision = options.fsSync.treeRevision;
          if (treeRevision > priorTreeRevision) {
            if (firstDependencyArrival) {
              await commandOptions.recordMutation('dependency', treeRevision);
            } else {
              const packageJsonChanged = !equalOptionalBytes(
                priorPackageJson,
                optionalFile(options.fsSync, packageJsonPath),
              );
              const packageLockChanged = !equalOptionalBytes(
                priorPackageLock,
                optionalFile(options.fsSync, packageLockPath),
              );
              if (packageJsonChanged) {
                await commandOptions.recordMutation('package-manifest', treeRevision);
              }
              if (packageLockChanged) {
                await commandOptions.recordMutation('package-lock', treeRevision);
              }
            }
          }
        } catch (error) {
          recordFailure = error;
        }

        if (commandFailure !== undefined && recordFailure !== undefined) {
          throw new AggregateError(
            [commandFailure, recordFailure],
            'npm command and package mutation reflection failed',
          );
        }
        if (commandFailure !== undefined) throw commandFailure;
        if (recordFailure !== undefined) throw recordFailure;
        return result as ShellCommandResult;
      };
    },
  };
}
