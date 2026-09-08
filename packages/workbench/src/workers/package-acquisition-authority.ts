import { NotImplementedError } from '@riftydev/io';
import type { InstallResult } from '@riftydev/npm-client';
import {
  type ShadowSubstitutionPlan,
  planAppliedShadowSubstitutions,
  planShadowSubstitutionsFromLockfile,
} from '@riftydev/npm-client/internal';
import { isAbsolute, normalizePath } from '@riftydev/vfs';
import type {
  InstallStampAuthority,
  InstallStampClaim,
  InstallStampPromotionResult,
  InstallStampTransitionOptions,
  ProjectSaveIdentity,
  ProjectSaveRebindResult,
} from '../glue/install-stamp-authority.ts';
import type {
  ProjectAcquisitionPlan,
  ProjectSnapshotAdmission,
} from '../workbench/project-materialization.ts';

import {
  type AcquisitionObservation,
  type AcquisitionProvenance,
  type ActivateAndEnsurePackagesCommand,
  type EnsurePackagesCommand,
  type GuardedPackageMutationCommand,
  type PackageAcquisitionAdapter,
  type PackageAcquisitionAuthority,
  type PackageAcquisitionAuthorityOptions,
  type PackageAcquisitionCommand,
  PackageAcquisitionError,
  type PackageAcquisitionProject,
  type PackageAcquisitionResult,
  type PackageFifoReservation,
  type PackageInstallAdapterResult,
  type PackageInstallRequest,
  type PackageJsonEditCommand,
  type PackageMutationTransition,
  type PackageSnapshotCandidate,
  type PackageSnapshotResolution,
  type PackageTreeAdmission,
  type PrepareFirstMaterializationPackagesCommand,
  type ProjectSwitchCommand,
  type ResetPackagesCommand,
  type SnapshotApplicationPlan,
  type SnapshotFailure,
  type SnapshotRestorePlan,
  type TerminalInstallCommand,
} from './package-acquisition-types.ts';

export * from './package-acquisition-types.ts';

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
      plan: ShadowSubstitutionPlan;
      /** A manifest-only edit preserves the live tree, not its durable install claim. */
      proof: 'claim' | 'owner-runtime';
    }>
  | Readonly<{
      kind: 'empty';
      project: PackageAcquisitionProject;
      packageJsonText: string;
      plan: ShadowSubstitutionPlan;
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
    plan: ShadowSubstitutionPlan,
  ): Promise<void> {
    const root = normalizeSchedulingRoot(project.root);
    this.#packageTrees.set(
      root,
      Object.freeze({
        kind: 'installed',
        project: Object.freeze({ ...project, root }),
        packageJsonText,
        plan,
        proof: 'claim',
      }),
    );
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

  async #composePackageTreeAncestry(ancestry: readonly PublishedPackageTreeEntry[]): Promise<
    Readonly<{
      plan: ShadowSubstitutionPlan;
      runtimeBindings: readonly Readonly<{ adapterId: string; packagePath: string }>[];
    }>
  > {
    const substitutions: ShadowSubstitutionPlan['substitutions'][number][] = [];
    const claimedInstallPaths = new Set<string>();
    const claimedAdapters = new Set<string>();
    const runtimeBindings: Array<Readonly<{ adapterId: string; packagePath: string }>> = [];
    for (const [root, published] of ancestry) {
      for (const binding of published.plan.bindings) {
        if (claimedAdapters.has(binding.adapterId)) continue;
        claimedAdapters.add(binding.adapterId);
        runtimeBindings.push(
          Object.freeze({
            adapterId: binding.adapterId,
            packagePath: normalizePath(`${root}/${binding.packagePath}`),
          }),
        );
      }
      for (const substitution of published.plan.substitutions) {
        const installPath = substitution.materialization.installPath;
        if (claimedInstallPaths.has(installPath)) continue;
        claimedInstallPaths.add(installPath);
        substitutions.push(substitution);
      }
    }

    const nearest = ancestry[0];
    if (nearest === undefined) throw new Error('package tree ancestry is empty');
    const exactPublished = ancestry.find(
      ([, published]) =>
        published.plan.substitutions.length === substitutions.length &&
        published.plan.substitutions.every(
          (substitution, index) => substitution === substitutions[index],
        ),
    )?.[1];
    const plan =
      exactPublished?.plan ??
      (substitutions.length === 0
        ? nearest[1].plan
        : planAppliedShadowSubstitutions(substitutions));
    return Object.freeze({ plan, runtimeBindings: Object.freeze(runtimeBindings) });
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
      runtimeBindings: composed.runtimeBindings,
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
      case 'prepare-first-materialization':
        return this.#prepareFirstMaterialization(command);
      default:
        return unreachable(command);
    }
  }

  async #prepareFirstMaterialization(
    command: PrepareFirstMaterializationPackagesCommand,
  ): Promise<ProjectAcquisitionPlan> {
    const registration = command.register();
    const from = typeof command.from === 'function' ? command.from() : command.from;
    if (from) this.#rememberProject(from);
    this.#rememberProject(command.to);
    await this.#adapter.switchProject({ type: 'project-switch', from, to: command.to });
    const admission = command.snapshotAdmission;
    try {
      if (admission?.mode === 'saved') {
        const provenance = await this.#trustedProvenance(command.to, command.packageJsonText);
        if (provenance === null)
          throw new Error(
            `Saved project is incompatible with current install trust: ${command.to.projectId}`,
          );
        return Object.freeze({ kind: 'ready', provenance: Object.freeze(provenance) });
      }
      if (admission?.mode === 'apply')
        return await this.#applySnapshot(command, admission, registration.restore);
      if (admission?.mode === 'initial') {
        const roots = [
          command.to.root,
          ...this.#treeGuardsFor(command.to.root).map((transition) =>
            transition.mode === 'revoke' ? transition.root : transition.project.root,
          ),
        ];
        return await this.#stamps.withRollback(roots, (reconcile) =>
          admission.transaction(
            async () => {
              const result = await this.#firstMaterializationDecision(command, false, true);
              if (result.kind === 'ready')
                await this.#requireSnapshotDurability(command.to, command.packageJsonText);
              return result;
            },
            async () => {
              await reconcile();
              registration.restore?.();
              for (const root of roots) this.#invalidatePackageTrees(root);
            },
          ),
        );
      }
      return await this.#firstMaterializationDecision(command, registration.manifestChanged, false);
    } catch (error) {
      registration.restore?.();
      throw error;
    }
  }

  async #firstMaterializationDecision(
    command: PrepareFirstMaterializationPackagesCommand,
    manifestChanged: boolean,
    requireTrustedSnapshot: boolean,
  ): Promise<ProjectAcquisitionPlan> {
    const existing = manifestChanged
      ? null
      : await this.#trustedProvenance(command.to, command.packageJsonText);
    if (existing !== null)
      return Object.freeze({ kind: 'ready', provenance: Object.freeze(existing) });
    if (command.materialization.kind === 'install')
      return this.#deferredInstallPlan(command.to, command.packageJsonText, []);
    try {
      const provenance = await this.#ensure({
        type: 'ensure',
        project: command.to,
        packageJsonText: command.packageJsonText,
        snapshotSource: command.materialization.source,
        fallback: 'snapshot-only',
        requireTrustedSnapshot,
        ...(command.replaceTreeOnMiss ? { replaceTreeOnMiss: true } : {}),
        ...(command.onPromotion ? { onPromotion: command.onPromotion } : {}),
      });
      return Object.freeze({ kind: 'ready', provenance: Object.freeze(provenance) });
    } catch (error) {
      if (!(error instanceof PackageAcquisitionError) || error.failure !== 'snapshot-unavailable')
        throw error;
      return this.#deferredInstallPlan(command.to, command.packageJsonText, error.snapshotFailures);
    }
  }

  async #requireSnapshotDurability(
    project: PackageAcquisitionProject,
    packageJsonText: string,
  ): Promise<void> {
    const report = await this.#stampTransition?.flush?.();
    if (report !== undefined && report.total > 0)
      throw new Error('Snapshot project durability failed');
    const current = await this.#stamps.check({
      root: project.root,
      slug: project.slug,
      expectedPackageJsonText: packageJsonText,
    });
    if (current.status !== 'trusted' || current.stamp.installArtifactIdentity !== project.identity)
      throw new Error('Snapshot promotion did not establish a trusted installed tree');
  }

  async #applySnapshot(
    command: PrepareFirstMaterializationPackagesCommand,
    admission: Extract<ProjectSnapshotAdmission, { mode: 'initial' | 'apply' }>,
    restoreRegistration?: () => void,
  ): Promise<ProjectAcquisitionPlan> {
    if (command.materialization.kind !== 'snapshot')
      throw new Error('Snapshot application requires a snapshot source');
    const resolution = await command.materialization.source.resolve();
    if (resolution.status === 'rejected')
      throw new Error(`Snapshot application rejected: ${resolution.reason}`);
    const snapshot = resolution.snapshot;
    if (snapshot.identity !== command.to.identity)
      throw new Error('Snapshot application rejected: install-artifact-identity-mismatch');
    const prepare = this.#adapter.planSnapshotApplication;
    if (prepare === undefined)
      throw new NotImplementedError('package-acquisition.snapshot-application');
    const plan: SnapshotApplicationPlan = await prepare({
      project: command.to,
      snapshot,
      conflict: command.materialization.conflict ?? 'error',
      knownProjects: this.knownProjects(),
      ...(admission.preflightRoot === undefined ? {} : { preflightRoot: admission.preflightRoot }),
    });
    const transitions = [
      ...this.#treeGuardsFor(command.to.root).filter((transition) => {
        const root = transition.mode === 'revoke' ? transition.root : transition.project.root;
        return root !== command.to.root && pathContains(root, command.to.root);
      }),
      ...plan.transitions,
    ].filter(
      (transition) =>
        (transition.mode === 'revoke' ? transition.root : transition.project.root) !==
        command.to.root,
    );
    const roots = [
      command.to.root,
      ...transitions.map((transition) =>
        transition.mode === 'revoke' ? transition.root : transition.project.root,
      ),
    ];
    return this.#stamps.withRollback(roots, (reconcile) =>
      admission.transaction(
        async () => {
          await plan.prepareCache();
          await this.#applyMutationTransitions(transitions);
          this.#invalidatePackageTrees(command.to.root);
          const claim = await this.#stamps.demote(command.to, this.#stampTransition);
          await this.#stamps.prepareTreeMutation(claim);
          await plan.apply();
          this.#adapter.snapshotManifestApplied?.(command.to, plan.packageJsonText);
          const promotion = await this.#completePromotion(
            command.to,
            'ensure',
            plan.packageJsonText,
            plan.packages,
            claim,
            plan.shadowPlan,
            command.onPromotion,
          );
          if (promotion.status !== 'trusted')
            throw new Error(`Snapshot ${promotionReason(promotion)}`);
          await this.#requireSnapshotDurability(command.to, plan.packageJsonText);
          return Object.freeze({
            kind: 'ready',
            provenance: Object.freeze({
              outcome: 'snapshot',
              snapshotId: snapshot.snapshotId,
              identity: snapshot.identity,
              packages: plan.packages,
            }),
          });
        },
        async () => {
          await reconcile();
          restoreRegistration?.();
          for (const root of roots) this.#invalidatePackageTrees(root);
        },
      ),
    );
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
        const promotion = await this.#completePromotion(
          command.project,
          'ensure',
          command.packageJsonText,
          snapshotPlan.packages,
          claim,
          snapshotPlan.shadowPlan,
          command.onPromotion,
        );
        if (command.requireTrustedSnapshot && promotion.status !== 'trusted')
          throw new Error(`Snapshot ${promotionReason(promotion)}`);
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
    shadowPlan: ShadowSubstitutionPlan,
    onPromotion?: (result: InstallStampPromotionResult) => void,
  ): Promise<InstallStampPromotionResult> {
    const settle = async (): Promise<InstallStampPromotionResult> => {
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
        return result;
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
      return result;
    };

    return settle();
  }
}

export function createPackageAcquisitionAuthority(
  options: PackageAcquisitionAuthorityOptions,
): PackageAcquisitionAuthority {
  return new FifoPackageAcquisitionAuthority(options);
}
