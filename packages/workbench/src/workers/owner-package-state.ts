import { NotImplementedError } from '@riftydev/io';
import {
  planShadowSubstitutionsFromLockfile,
  shadowSubstitutionPlanForInstallResult,
} from '@riftydev/npm-client/internal';
import type { CommandContext } from '@riftydev/shell';
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
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import {
  type NpmShellCommandDeps,
  createNpmShellCommand,
  executeNpmInstallOperation,
  parseNpmInstallRequest,
} from '../glue/npm-shell-command.ts';
import {
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
import {
  type ProjectAcquisitionPlan,
  type ProjectSnapshotAdmission,
  normalizeProjectSnapshotApplication,
} from '../workbench/project-materialization.ts';
import { shouldCleanForDevBootWithInstallState } from './dev-boot-clean.ts';
import {
  planOwnerSnapshotApplication,
  snapshotManifestConfig,
} from './owner-snapshot-application.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';
import {
  type AcquisitionProvenance,
  type PackageAcquisitionProject,
  createPackageAcquisitionAuthority,
} from './package-acquisition-authority.ts';
import { finalizePackageInstallFiles } from './package-install-finalizer.ts';

const enc = new TextEncoder();

import type {
  FirstMaterializationOwnerPackageConfig,
  OwnerChildPackageAdmission,
  OwnerChildPackageReservation,
  OwnerPackageConfig,
  OwnerPackageState,
  OwnerPackageStateOptions,
} from './owner-package-types.ts';
export * from './owner-package-types.ts';

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
  const registry = options.registry;
  if (
    registry === undefined &&
    (options.resolverUrl || options.resolverBundleBaseUrl || options.resolverPin)
  )
    throw new TypeError('Eddy acquisition requires a registry capability');
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
    if (registry === undefined) return;
    const url = resolverUrl?.();
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
        resolverPin?.(config.templateId),
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
            bundleBaseUrl: resolverBundleBaseUrl?.(),
          })
        : undefined;
  };

  const baseNpmDeps: Omit<NpmShellCommandDeps, 'packageAcquisitionAuthority'> = {
    vfs: options.vfs,
    ...(registry === undefined ? {} : { registry }),
    ...(options.install ? { install: options.install } : {}),
    assertPortablePaths: (paths) => options.fsSync.assertPortablePaths(paths),
    flush: options.flush,
    projectSlug: (root) => {
      const normalized = normalizePath(root);
      return activeProject && normalized === normalizePath(activeProject.root)
        ? activeProject.slug
        : `root:${normalized}`;
    },
    ...(registry === undefined
      ? {}
      : {
          resolverUrl: resolverUrl?.(),
          resolverBundleBaseUrl: resolverBundleBaseUrl?.(),
          learnedPins: {
            get: (key) => readLearnedPin(options.vfs, key),
            set: async (key, hash, expectedCurrent) => {
              await writeLearnedPin(options.vfs, key, hash, undefined, expectedCurrent);
            },
            revalidate: async (_key, request, servedHash) => {
              const url = resolverUrl?.();
              if (!url) throw new Error('eddy resolver is not configured');
              await revalidateLearnedPin({
                vfs: options.vfs,
                resolverUrl: url,
                request,
                staleClosureHash: servedHash,
              });
            },
          },
        }),
  };

  const packages = createPackageAcquisitionAuthority({
    automaticFallback: registry === undefined ? 'snapshot-only' : 'install',
    stamps,
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
      planSnapshotApplication: (input) => planOwnerSnapshotApplication(options, input),
      snapshotManifestApplied: (project, packageJsonText) => {
        const updated = snapshotManifestConfig(configFor(project), packageJsonText);
        configs.set(configKey(project.root, project.slug), updated);
        if (configured?.cfg.root === project.root && configured.slug === project.slug)
          configured = updated;
      },
      readPackageLock: async (project) => packageLockValue(options.fsSync, project.root),
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
              prepared.applyCache();
              const report = await options.flush();
              if (report !== undefined && report.total > 0)
                throw new Error('Snapshot replay cache persistence failed');
              prepared.applyPayload();
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
              ...(registry === undefined
                ? {}
                : {
                    resolverClosureHash: () => resolverPin?.(config.templateId),
                    resolverPrefetch: () =>
                      configured !== undefined &&
                      configKey(configured.cfg.root, configured.slug) ===
                        configKey(request.project.root, request.project.slug)
                        ? installPrefetch
                        : undefined,
                  }),
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
        const initialInstall =
          consumesFirstMaterialization && config !== undefined
            ? {
                kind: request.type,
                root: request.project.root,
                packageSpecs: parsed.request.packageSpecs,
                initialPackageJson: config.cfg.packageJson,
                priorPackageLock: optionalFile(
                  options.fsSync,
                  `${request.project.root}/package-lock.json`,
                ),
                priorPackageJson: optionalFile(
                  options.fsSync,
                  `${request.project.root}/package.json`,
                ),
              }
            : undefined;
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
            const finalized =
              initialInstall !== undefined &&
              generatedLockfile !== null &&
              (await options.finalizeFirstInstall?.({
                ...initialInstall,
                lockfile: generatedLockfile,
              })) === true;
            if (request.type === 'terminal-install') request.onInitialInstall?.(finalized);
            firstMaterializationPhases.delete(firstMaterializationKey);
          }
          if ('status' in installed) return installed;
          return {
            ...installed,
            shadowPlan: shadowSubstitutionPlanForInstallResult(installed.result),
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
    const snapshot: OwnerChildPackageAdmission = Object.freeze({
      root: reservation.snapshot.root,
      runtimeBindings: reservation.snapshot.runtimeBindings,
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
    snapshotAdmission = false,
  ): { readonly manifestChanged: boolean; readonly restore?: () => void } => {
    const key = configKey(config.cfg.root, config.slug);
    const previous = configs.get(key);
    const priorConfigured = configured;
    const priorProject = activeProject;
    const priorTemplate = activeTemplateId;
    if (snapshotAdmission) {
      configured = config;
      configs.set(key, config);
    } else configure(config);
    return {
      manifestChanged:
        previous !== undefined && previous.cfg.packageJson !== config.cfg.packageJson,
      ...(snapshotAdmission
        ? {
            restore: () => {
              if (previous === undefined) configs.delete(key);
              else configs.set(key, previous);
              configured = priorConfigured;
              activeProject = priorProject;
              activeTemplateId = priorTemplate;
            },
          }
        : {}),
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
    snapshotAdmission?: ProjectSnapshotAdmission,
  ): Promise<ProjectAcquisitionPlan>;
  function activateAndEnsure(config: OwnerPackageConfig): Promise<AcquisitionProvenance>;
  function activateAndEnsure(
    config: OwnerPackageConfig,
    snapshotAdmission?: ProjectSnapshotAdmission,
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
    const application =
      materialization.kind === 'snapshot'
        ? normalizeProjectSnapshotApplication(materialization.application)
        : undefined;
    const key = configKey(config.cfg.root, config.slug);
    firstMaterializationPhases.set(key, 'preparing');
    const prepared = packages.dispatch({
      type: 'prepare-first-materialization',
      register: () => registerActivation(config, snapshotAdmission !== undefined),
      from: () => activeProject,
      to: packageProject(config),
      packageJsonText: config.cfg.packageJson,
      materialization:
        materialization.kind === 'install'
          ? { kind: 'install' }
          : {
              kind: 'snapshot',
              ...(application?.mode === 'apply-snapshot' ? { conflict: application.conflict } : {}),
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
      ...(snapshotAdmission === undefined ? {} : { snapshotAdmission }),
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
        let initialInstallFinalized = false;
        const command = createNpmShellCommand({
          ...baseNpmDeps,
          packageAcquisitionAuthority: packages,
          runScript,
          ...(commandOptions.mapInvocationContext === undefined
            ? {}
            : { mapInvocationContext: commandOptions.mapInvocationContext }),
          observeInitialInstall: (finalized) => {
            initialInstallFinalized = finalized;
          },
        });
        const config = configured;
        const execute = () => Promise.resolve(command(args, context));
        if (commandOptions.observeOperation === undefined) return execute();
        return commandOptions.observeOperation({
          args,
          cwd: (commandOptions.mapInvocationContext?.(context) ?? context).cwd,
          ...(config === undefined
            ? {}
            : { project: { root: config.cfg.root, packageJson: config.cfg.packageJson } }),
          firstMaterialization:
            config !== undefined &&
            firstMaterializationPhases.has(configKey(config.cfg.root, config.slug)),
          initialInstallFinalized: () => initialInstallFinalized,
          execute,
        });
      };
    },
  };
}
