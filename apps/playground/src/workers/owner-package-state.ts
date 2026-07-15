import { NotImplementedError } from '@riftydev/io';
import type { RegistryClient } from '@riftydev/npm-client';
import type { CommandContext, ShellCommand, ShellCommandResult } from '@riftydev/shell';
import type { PersistFailureReport, Vfs } from '@riftydev/vfs';
import { normalizePath } from '@riftydev/vfs';
import { type DepSnapshotV2, prepareDepSnapshotRestore } from '../glue/dep-snapshot.ts';
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
import type { BootstrapConfig } from '../templates/project-spec.ts';
import { shouldCleanForDevBootWithInstallState } from './dev-boot-clean.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';
import {
  type AcquisitionProvenance,
  type PackageAcquisitionProject,
  createPackageAcquisitionAuthority,
} from './package-acquisition-authority.ts';
import { finalizePackageInstallFiles } from './package-install-finalizer.ts';

const enc = new TextEncoder();

export interface OwnerPackageConfig {
  readonly cfg: BootstrapConfig;
  readonly templateId: string;
  readonly slug: string;
  readonly fromScratch: boolean;
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
  readonly resolverUrl?: () => string | undefined;
  readonly resolverBundleBaseUrl?: () => string | undefined;
  readonly resolverPin?: (templateId: string) => string | undefined;
}

export interface OwnerPackageState {
  readonly mutations: PackageMutationExecutor;
  /** Register, activate, and install/reuse one exact project through one FIFO admission. */
  activateAndEnsure(config: OwnerPackageConfig): Promise<AcquisitionProvenance>;
  /** Settle package commands and durability work admitted before this call. */
  quiesce(): Promise<void>;
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
  ): ShellCommand;
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

function decodeChunk(chunk: string | Uint8Array): string {
  return typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
}

export function createOwnerPackageState(options: OwnerPackageStateOptions): OwnerPackageState {
  const configs = new Map<string, OwnerPackageConfig>();
  let configured = options.initial;
  let activeProject = options.initial ? packageProject(options.initial) : null;
  let activeTemplateId: string | null = null;
  if (options.initial) {
    configs.set(configKey(options.initial.cfg.root, options.initial.slug), options.initial);
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
        const payload = snapshot.payload as DepSnapshotV2 | undefined;
        if (!payload) return { status: 'rejected', reason: 'snapshot-payload-missing' };
        try {
          const prepared = prepareDepSnapshotRestore(options.fsSync, project.root, payload);
          const config = configFor(project);
          return {
            status: 'ready',
            packages: payload.packages,
            apply: async () => {
              prepared.apply();
              seedTemplateNodeModulesFiles(options.fsSync, config.cfg.root, config.cfg.seedFiles);
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
        const operationDeps: NpmShellCommandDeps = config
          ? {
              ...baseNpmDeps,
              prepareInstall: async (ctx, info) => {
                if (!config.fromScratch || !info.fullInstall) return;
                if (normalizePath(ctx.cwd) !== normalizePath(request.project.root)) return;
                if (info.priorTrustedTree) return;
                if (info.priorSessionSlug === request.project.slug) return;
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
          : baseNpmDeps;
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
        const installed = await executeNpmInstallOperation(
          parsed.request,
          context,
          operationDeps,
          execution,
        );
        if (installed.status !== 'noop') {
          await finalizePackageInstallFiles({
            root: request.project.root,
            ...(config
              ? {
                  seedTemplateFiles: () =>
                    seedTemplateNodeModulesFiles(
                      options.fsSync,
                      config.cfg.root,
                      config.cfg.seedFiles,
                    ),
                }
              : {}),
          });
        }
        return installed;
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
        seedTemplateNodeModulesFiles(options.fsSync, config.cfg.root, config.cfg.seedFiles),
      async () => {
        intents = templateNodeModulesSeedMutationIntents(
          options.fsSync,
          config.cfg.root,
          config.cfg.seedFiles,
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

  const activateAndEnsure = (config: OwnerPackageConfig): Promise<AcquisitionProvenance> => {
    return packages.dispatch({
      type: 'activate-and-ensure',
      register: () => configure(config),
      from: () => activeProject,
      to: packageProject(config),
      packageJsonText: config.cfg.packageJson,
      replaceTreeOnMiss: true,
    });
  };

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
    configure,
    restore,
    transition,
    reassertTemplateNodeModules,
    createNpmCommand: (runScript) =>
      createNpmShellCommand({
        ...baseNpmDeps,
        packageAcquisitionAuthority: packages,
        runScript,
      }),
  };
}
