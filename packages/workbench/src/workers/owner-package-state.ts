import { NotImplementedError } from '@riftydev/io';
import type { KernelEntryCapabilityPorts } from '@riftydev/kernel';
import type { RegistryClient } from '@riftydev/npm-client';
import {
  type PackageTreeShadowAssetBoundary,
  SHADOW_ASSET_PORT_CAPABILITY,
  type ShadowAssetPortServer,
  type ShadowAssetReadySet,
  planShadowSubstitutionsFromLockfile,
  shadowAssetPlanForInstallResult,
} from '@riftydev/npm-client/internal';
import {
  type CommandContext,
  type ShellCommand,
  type ShellCommandResult,
  shellCommandExitCode,
} from '@riftydev/shell';
import type { PersistFailureReport, Vfs } from '@riftydev/vfs';
import { normalizePath } from '@riftydev/vfs';
import {
  type DepSnapshotV3,
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
import type { ProjectPackageConfig } from '../workbench/internal/project-package-config.ts';
import type {
  ProjectAcquisitionPlan,
  ProjectFirstMaterialization,
} from '../workbench/project-materialization.ts';
import { shouldCleanForDevBootWithInstallState } from './dev-boot-clean.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';
import {
  type AcquisitionProvenance,
  type PackageAcquisitionAuthority,
  type PackageAcquisitionProject,
  type PackageFifoReservation,
  createPackageAcquisitionAuthority,
} from './package-acquisition-authority.ts';
import { finalizePackageInstallFiles } from './package-install-finalizer.ts';

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
  readonly registry: RegistryClient;
  /** Origin-exclusive ready-asset manager, constructed under the Workbench Web Lock. */
  readonly shadowAssets?: PackageTreeShadowAssetBoundary;
  /** Test seam at the external registry/install boundary. */
  readonly install?: InstallFn;
  /** Fold one exact first-install lock into the fresh Starter Git baseline. */
  readonly amendGeneratedBaseline?: (root: string, lockfile: Uint8Array) => Promise<boolean>;
  readonly resolverUrl: () => string | undefined;
  readonly resolverBundleBaseUrl: () => string | undefined;
  readonly resolverPin: (templateId: string) => string | undefined;
}

export interface OwnerPackageState {
  readonly mutations: PackageMutationExecutor;
  /** Register, activate, and install/reuse one exact project through one FIFO admission. */
  activateAndEnsure(
    config: FirstMaterializationOwnerPackageConfig,
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
  readonly ready: ShadowAssetReadySet | null;
  readonly capabilityPorts: KernelEntryCapabilityPorts;
  /** Release the ready-port server after confirmed physical child settlement. */
  dispose(): void;
}

export type OwnerChildPackageReservation = PackageFifoReservation<OwnerChildPackageAdmission>;

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

function packageLockValue(authority: OwnerVfsAuthority, root: string): unknown {
  const path = normalizePath(`${root}/package-lock.json`);
  const bytes = optionalFile(authority, path);
  if (bytes === null) {
    return Object.freeze({ lockfileVersion: 3, packages: Object.freeze({}) });
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`package lock is not UTF-8 at ${path}`, { cause: error });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`package lock is not valid JSON at ${path}`, { cause: error });
  }
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
  const firstMaterializationPhases = new Map<string, 'preparing' | 'deferred' | 'consuming'>();
  if (options.initial) {
    configs.set(configKey(options.initial.cfg.root, options.initial.slug), options.initial);
  }

  const registry = options.registry;
  const resolverUrl = options.resolverUrl;
  const resolverBundleBaseUrl = options.resolverBundleBaseUrl;
  const resolverPin = options.resolverPin;
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

  const baseNpmDeps: Omit<NpmShellCommandDeps, 'packageAcquisitionAuthority'> = {
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
    ...(options.shadowAssets === undefined ? {} : { shadowAssets: options.shadowAssets }),
    stampTransition: { flush: options.flush },
    resolveTreeGuards: (root, knownProjects) =>
      discoverPackageAcquisitionGuardTransitions(options.fsSync, knownProjects, root),
    observe: (event) => {
      if (event.type === 'promotion-refused') {
        console.warn(
          `[shell-owner/worker] package stamp promotion refused for ${event.projectId}: ${event.reason}`,
        );
      }
    },
    adapter: {
      readTrustedPackageLock: async (project) => packageLockValue(options.fsSync, project.root),
      attestEmptyPackageTree: async ({ project, packageJsonText }) => {
        const root = normalizePath(project.root);
        return (
          equalOptionalBytes(
            optionalFile(options.fsSync, `${root}/package.json`),
            enc.encode(packageJsonText),
          ) && !options.fsSync.existsSync(`${root}/node_modules`)
        );
      },
      prepareEnsure: async (command, execution) => {
        if (!command.replaceTreeOnMiss) return;
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
      planSnapshotRestore: async ({ project, snapshot }) => {
        const payload = snapshot.payload as DepSnapshotV3 | undefined;
        if (!payload) return { status: 'rejected', reason: 'snapshot-payload-missing' };
        try {
          const prepared = await prepareDepSnapshotRestore(options.fsSync, project.root, payload);
          const config = configFor(project);
          const lockfile =
            payload.lockfile.length === 0
              ? { lockfileVersion: 3, packages: {} }
              : (JSON.parse(payload.lockfile) as unknown);
          return {
            status: 'ready',
            packages: payload.packages,
            shadowPlan: planShadowSubstitutionsFromLockfile(lockfile),
            apply: async () => {
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
        const operationBase: NpmShellCommandDeps = {
          ...baseNpmDeps,
          prepareEmptyInstall: async (ctx) => clearProjectTree(options.fsSync, ctx.cwd),
          packageAcquisitionAuthority: packages,
        };
        const operationDeps: NpmShellCommandDeps = config
          ? {
              ...operationBase,
              prepareInstall: async (ctx, info) => {
                if (!config.fromScratch || !info.fullInstall) return;
                if (normalizePath(ctx.cwd) !== normalizePath(request.project.root)) return;
                if (info.priorTrustedTree) return;
                if (info.priorSessionSlug === request.project.slug) return;
                const manifestIsForeign =
                  (info.priorSessionSlug !== undefined &&
                    info.priorSessionSlug !== request.project.slug) ||
                  (info.priorSlug !== undefined && info.priorSlug !== request.project.slug);
                prepareProjectInstallTree(options.fsSync, request.project.root, {
                  ...(manifestIsForeign ? { packageJsonText: config.cfg.packageJson } : {}),
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
          : operationBase;
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
        const firstMaterializationKey =
          config !== undefined && hasFirstMaterialization(config)
            ? configKey(config.cfg.root, config.slug)
            : null;
        const consumesFirstMaterialization =
          firstMaterializationKey !== null &&
          firstMaterializationPhases.get(firstMaterializationKey) === 'deferred';
        const generatedBaselineEligible =
          consumesFirstMaterialization &&
          request.type === 'terminal-install' &&
          parsed.request.packageSpecs.length === 0 &&
          config !== undefined &&
          optionalFile(options.fsSync, `${request.project.root}/package-lock.json`) === null &&
          equalOptionalBytes(
            optionalFile(options.fsSync, `${request.project.root}/package.json`),
            enc.encode(config.cfg.packageJson),
          );
        if (consumesFirstMaterialization) {
          firstMaterializationPhases.set(firstMaterializationKey, 'consuming');
        }
        try {
          const installed = await executeNpmInstallOperation(
            parsed.request,
            context,
            operationDeps,
            execution,
          );
          if (!('status' in installed) || installed.packageJsonText !== null) {
            await finalizePackageInstallFiles({
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
          }
          if (consumesFirstMaterialization) {
            const generatedLockfile = optionalFile(
              options.fsSync,
              `${request.project.root}/package-lock.json`,
            );
            const folded =
              generatedBaselineEligible &&
              generatedLockfile !== null &&
              (await options.amendGeneratedBaseline?.(request.project.root, generatedLockfile)) ===
                true;
            if (request.type === 'terminal-install') request.onGeneratedBaseline?.(folded);
            firstMaterializationPhases.delete(firstMaterializationKey);
          }
          if ('status' in installed) return installed;
          return {
            ...installed,
            shadowPlan: shadowAssetPlanForInstallResult(installed.result),
          };
        } catch (error) {
          if (consumesFirstMaterialization) {
            firstMaterializationPhases.set(firstMaterializationKey, 'deferred');
          }
          throw error;
        }
      },
      reset: async (command) => clearProjectTree(options.fsSync, command.target.root),
      switchProject: async (command) => {
        if (command.resetPackages) {
          if (command.packageJsonText === undefined) {
            throw new NotImplementedError('package-acquisition.project-switch.package-json');
          }
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

  const reserveChildAdmission = async (root: string): Promise<OwnerChildPackageReservation> => {
    const canonicalRoot = normalizePath(root);
    const reservation = await packages.reserveChildAdmission(canonicalRoot);
    const admitted = reservation.snapshot;
    if (admitted.ready === null) {
      const snapshot: OwnerChildPackageAdmission = Object.freeze({
        root: admitted.root,
        ready: null,
        capabilityPorts: Object.freeze({}),
        dispose: () => {},
      });
      return Object.freeze({ ...reservation, snapshot });
    }
    const boundary = options.shadowAssets;
    if (boundary === undefined) {
      reservation.abortBeforeSpawn(new NotImplementedError('npm-client.packageTree.shadowAssets'));
      throw new NotImplementedError('npm-client.packageTree.shadowAssets');
    }
    const channel = new MessageChannel();
    let server: ShadowAssetPortServer;
    try {
      server = boundary.serve(admitted.ready, channel.port1);
    } catch (error) {
      channel.port1.close();
      channel.port2.close();
      reservation.abortBeforeSpawn(error);
      throw error;
    }
    let disposed = false;
    const snapshot: OwnerChildPackageAdmission = Object.freeze({
      root: admitted.root,
      ready: admitted.ready,
      capabilityPorts: Object.freeze({
        [SHADOW_ASSET_PORT_CAPABILITY]: channel.port2,
      }),
      dispose() {
        if (disposed) return;
        disposed = true;
        server.dispose();
        channel.port2.close();
      },
    });
    return Object.freeze({ ...reservation, snapshot });
  };

  const mutations = createPackageMutationExecutor({
    packages,
    fs: options.fsSync,
    assertPortablePaths: (paths) => options.fsSync.assertPortablePaths(paths),
    activeProject: () => {
      if (!activeProject) throw new Error('package acquisition project is not active');
      return activeProject;
    },
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

  const registerActivation = (
    config: OwnerPackageConfig,
  ): { readonly manifestChanged: boolean } => {
    const previous = configs.get(configKey(config.cfg.root, config.slug));
    configure(config);
    return {
      manifestChanged:
        previous !== undefined && previous.cfg.packageJson !== config.cfg.packageJson,
    };
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
  ): Promise<ProjectAcquisitionPlan>;
  function activateAndEnsure(config: OwnerPackageConfig): Promise<AcquisitionProvenance>;
  function activateAndEnsure(
    config: OwnerPackageConfig,
  ): Promise<ProjectAcquisitionPlan | AcquisitionProvenance> {
    if (!hasFirstMaterialization(config)) {
      return packages.dispatch({
        type: 'activate-and-ensure',
        register: () => registerActivation(config),
        from: () => activeProject,
        to: packageProject(config),
        packageJsonText: config.cfg.packageJson,
        replaceTreeOnMiss: true,
      });
    }

    const materialization = config.firstMaterialization;
    const key = configKey(config.cfg.root, config.slug);
    firstMaterializationPhases.set(key, 'preparing');
    const prepared = packages.dispatch({
      type: 'prepare-first-materialization',
      register: () => registerActivation(config),
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
    });
    void prepared.then(
      (plan) => {
        if (plan.kind === 'install') firstMaterializationPhases.set(key, 'deferred');
        else firstMaterializationPhases.delete(key);
      },
      () => firstMaterializationPhases.delete(key),
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

  if (options.primeInitialPrefetch) {
    if (!options.initial) throw new Error('initial package config required to prime prefetch');
    primePrefetch(options.initial);
  }

  return {
    mutations,
    activateAndEnsure,
    quiesce: () => packages.quiesce(),
    projectSave: (input, operation) => packages.projectSave(input, operation),
    reserveChildAdmission,
    configure,
    restore,
    transition,
    reassertTemplateNodeModules,
    createNpmCommand: (runScript, commandOptions = {}) => {
      return async (args, context) => {
        let generatedBaselineClean = false;
        const command = createNpmShellCommand({
          ...baseNpmDeps,
          packageAcquisitionAuthority: packages,
          runScript,
          ...(commandOptions.mapInvocationContext === undefined
            ? {}
            : { mapInvocationContext: commandOptions.mapInvocationContext }),
          observeGeneratedBaseline: (clean) => {
            generatedBaselineClean = clean;
          },
        });
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
        const packageJsonPath = normalizePath(`${config.cfg.root}/package.json`);
        const packageLockPath = normalizePath(`${config.cfg.root}/package-lock.json`);
        const priorTreeRevision = options.fsSync.treeRevision;
        const priorPackageJson = optionalFile(options.fsSync, packageJsonPath);
        const priorPackageLock = optionalFile(options.fsSync, packageLockPath);
        const firstDependencyArrival =
          firstMaterializationPhases.has(key) &&
          isBareInstallCommand(args) &&
          priorPackageLock === null &&
          equalOptionalBytes(priorPackageJson, enc.encode(config.cfg.packageJson));
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
            const commandSucceeded =
              commandFailure === undefined &&
              result !== undefined &&
              shellCommandExitCode(result) === 0;
            if (firstDependencyArrival && commandSucceeded && generatedBaselineClean) {
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
