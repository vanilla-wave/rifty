import {
  type FsSync,
  type VfsMutationIntent,
  basename,
  dirname,
  joinPath,
  normalizePath,
} from '@riftydev/vfs';
import type {
  PackageAcquisitionAuthority,
  PackageAcquisitionProject,
  PackageMutationTransition,
} from '../workers/package-acquisition-authority.ts';
import { installStampPath, installTreeDir, readInstallStampSync } from './install-stamp.ts';
import type { HostCommitAck, HostCommitRequest } from './owner-vfs-protocol.ts';

export interface PackageMutationTarget {
  readonly root: string;
}

export type PackageMutation = () => Promise<void>;
export type PackageResetPlan =
  | { readonly status: 'noop' }
  | { readonly status: 'ready'; readonly mutate: PackageMutation };
export type PackageResetPreparation = () => Promise<PackageResetPlan>;
export type PackageEditPreflight<T> = () => Promise<
  { readonly status: 'ready' } | { readonly status: 'noop'; readonly value: T }
>;

/** Composition seam: named package mutations execute inside the owner FIFO. */
export interface PackageMutationExecutor {
  /** Every writer enters the package FIFO; claim discovery runs at its head. */
  guardedMutation<T>(
    intents: readonly VfsMutationIntent[],
    mutate: () => Promise<T>,
    preflight?: PackageEditPreflight<T>,
  ): Promise<T>;
  reset(target: PackageMutationTarget, prepare: PackageResetPreparation): Promise<void>;
  packageJsonEdit<T>(
    target: PackageMutationTarget,
    mutate: () => Promise<T>,
    preflight?: PackageEditPreflight<T>,
  ): Promise<T>;
}

export interface PackageMutationExecutorOptions {
  readonly packages: PackageAcquisitionAuthority;
  readonly fs: FsSync;
  readonly assertPortablePaths: (paths: readonly string[]) => void;
  readonly activeProject: () => PackageAcquisitionProject;
}

/** One adapter from every owner writer into the package-acquisition FIFO. */
export function createPackageMutationExecutor(
  options: PackageMutationExecutorOptions,
): PackageMutationExecutor {
  const transitions = (intents: readonly VfsMutationIntent[]): PackageMutationTransition[] => {
    assertPortableVfsMutationIntents(options.assertPortablePaths, intents);
    return discoverPackageMutationTransitions(
      options.fs,
      options.packages.knownProjects?.() ?? [],
      intents,
    );
  };
  const preflight = async <T>(
    run: PackageEditPreflight<T> | undefined,
    settle: (value: T) => void,
  ): Promise<boolean> => {
    if (!run) return true;
    const result = await run();
    if (result.status === 'ready') return true;
    settle(result.value);
    return false;
  };
  const settled = async <T>(
    execute: (settle: (value: T) => void) => Promise<void>,
    failure: string,
  ): Promise<T> => {
    let completed = false;
    let value!: T;
    await execute((next) => {
      value = next;
      completed = true;
    });
    if (!completed) throw new Error(failure);
    return value;
  };

  return {
    guardedMutation: <T>(
      intents: readonly VfsMutationIntent[],
      mutate: () => Promise<T>,
      check?: PackageEditPreflight<T>,
    ) =>
      settled<T>(
        (settle) =>
          options.packages.dispatch({
            type: 'guarded-mutation',
            ...(check ? { preflight: () => preflight(check, settle) } : {}),
            resolveTransitions: () => transitions(intents),
            mutate: async () => settle(await mutate()),
          }),
        'guarded package mutation did not settle',
      ),
    reset: (target, prepare) =>
      options.packages.dispatch({
        type: 'reset',
        target,
        prepare,
        resolveTransitions: () => transitions([{ kind: 'rm', path: target.root }]),
      }),
    packageJsonEdit: <T>(
      target: PackageMutationTarget,
      mutate: () => Promise<T>,
      check?: PackageEditPreflight<T>,
    ) =>
      settled<T>(
        (settle) =>
          options.packages.dispatch({
            type: 'package-json-edit',
            project: () => {
              const active = options.activeProject();
              if (normalizePath(target.root) !== normalizePath(active.root)) {
                throw new Error(
                  `package.json edit target ${target.root} is not the active package root ${active.root}`,
                );
              }
              return active;
            },
            ...(check ? { preflight: () => preflight(check, settle) } : {}),
            mutate: async () => settle(await mutate()),
          }),
        `package.json edit did not run for ${target.root}`,
      ),
  };
}

export type PackageMutationImpact = 'none' | 'manifest' | 'tree';

function containsPath(container: string, path: string): boolean {
  const normalizedContainer = normalizePath(container);
  const normalizedPath = normalizePath(path);
  return (
    normalizedContainer === normalizedPath || normalizedPath.startsWith(`${normalizedContainer}/`)
  );
}

export function packageMutationImpactForPath(path: string, root: string): PackageMutationImpact {
  const normalized = normalizePath(path);
  const packageJson = normalizePath(`${root}/package.json`);
  const nodeModules = normalizePath(`${root}/node_modules`);
  if (normalized === packageJson) return 'manifest';
  if (containsPath(nodeModules, normalized)) return 'tree';
  if (containsPath(normalized, packageJson) || containsPath(normalized, nodeModules)) return 'tree';
  return 'none';
}

export function combinePackageMutationImpact(
  left: PackageMutationImpact,
  right: PackageMutationImpact,
): PackageMutationImpact {
  if (left === 'tree' || right === 'tree') return 'tree';
  if (left === 'manifest' || right === 'manifest') return 'manifest';
  return 'none';
}

export function classifyVfsMutationIntentsPackageImpact(
  intents: readonly VfsMutationIntent[],
  root: string,
): PackageMutationImpact {
  return intents.reduce<PackageMutationImpact>((impact, intent) => {
    let next: PackageMutationImpact;
    if ('path' in intent) {
      next = packageMutationImpactForPath(intent.path, root);
    } else if (intent.kind === 'rename') {
      next =
        normalizePath(intent.sourcePath) === normalizePath(intent.targetPath)
          ? 'none'
          : combinePackageMutationImpact(
              packageMutationImpactForPath(intent.sourcePath, root),
              packageMutationImpactForPath(intent.targetPath, root),
            );
    } else {
      next = packageMutationImpactForPath(intent.targetPath, root);
    }
    return combinePackageMutationImpact(impact, next);
  }, 'none');
}

function transitionRoot(transition: PackageMutationTransition): string {
  return transition.mode === 'revoke' ? transition.root : transition.project.root;
}

function sortTransitions(
  transitions: readonly PackageMutationTransition[],
): PackageMutationTransition[] {
  return [...transitions].sort((left, right) => {
    const leftRoot = transitionRoot(left);
    const rightRoot = transitionRoot(right);
    if (leftRoot.length !== rightRoot.length) return leftRoot.length - rightRoot.length;
    return leftRoot < rightRoot ? -1 : leftRoot > rightRoot ? 1 : 0;
  });
}

export function packageMutationTransitionsForProjects(
  intents: readonly VfsMutationIntent[],
  projects: readonly PackageAcquisitionProject[],
): PackageMutationTransition[] {
  const byRoot = new Map<string, PackageAcquisitionProject>();
  for (const project of projects) {
    const root = normalizePath(project.root);
    byRoot.set(root, { ...project, root });
  }
  const transitions: PackageMutationTransition[] = [];
  for (const project of byRoot.values()) {
    const impact = classifyVfsMutationIntentsPackageImpact(intents, project.root);
    if (impact === 'manifest') transitions.push({ mode: 'demote', project });
    else if (impact === 'tree') transitions.push({ mode: 'revoke', root: project.root });
  }
  return sortTransitions(transitions);
}

const INSTALL_STAMP_BASENAME = basename(installStampPath('/'));

function stampedProjectAt(
  fs: Pick<FsSync, 'existsSync' | 'readFileBytesSync'>,
  root: string,
): PackageAcquisitionProject | null {
  const normalizedRoot = normalizePath(root);
  const stamp = readInstallStampSync(fs, normalizedRoot);
  if (!stamp) return null;
  return {
    projectId: stamp.slug || normalizedRoot,
    root: normalizedRoot,
    slug: stamp.slug,
    identity: stamp.installArtifactIdentity,
  };
}

function addPathDerivedStampRoots(path: string, roots: Set<string>): void {
  const normalized = normalizePath(path);
  const segments = normalized.split('/').filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] !== 'node_modules') continue;
    roots.add(index === 0 ? '/' : `/${segments.slice(0, index).join('/')}`);
  }
  if (basename(normalized) === 'package.json') roots.add(dirname(normalized));
}

function scanStampRoots(fs: FsSync, path: string, roots: Set<string>): void {
  const normalized = normalizePath(path);
  const stat = fs.statSyncOrNull(normalized);
  if (!stat) return;
  const parent = dirname(normalized);
  if (basename(normalized) === INSTALL_STAMP_BASENAME && basename(parent) === 'node_modules') {
    roots.add(dirname(parent));
    return;
  }
  if (stat.isFile) {
    return;
  }
  if (!stat.isDirectory) return;
  for (const entry of fs.readdirSync(normalized)) {
    const child = joinPath(normalized, entry.name);
    if (entry.isFile) {
      if (entry.name === INSTALL_STAMP_BASENAME && basename(normalized) === 'node_modules') {
        roots.add(dirname(normalized));
      }
    } else if (entry.isDirectory) {
      scanStampRoots(fs, child, roots);
    }
  }
}

function physicalStampRoots(
  fs: Pick<FsSync, 'existsSync'>,
  candidates: ReadonlySet<string>,
): Set<string> {
  const roots = new Set<string>();
  for (const root of candidates) {
    if (fs.existsSync(installStampPath(root))) roots.add(root);
  }
  return roots;
}

function mutationPaths(intent: VfsMutationIntent): readonly string[] {
  if ('path' in intent) return [intent.path];
  return intent.kind === 'copy' ? [intent.targetPath] : [intent.sourcePath, intent.targetPath];
}

/** Exact endpoints a host namespace policy must validate before a batch applies. */
export function vfsMutationIntentPaths(intent: VfsMutationIntent): readonly string[] {
  if ('path' in intent) return [intent.path];
  return [intent.sourcePath, intent.targetPath];
}

export function assertPortableVfsMutationIntents(
  assertPaths: (paths: readonly string[]) => void,
  intents: readonly VfsMutationIntent[],
): void {
  assertPaths(intents.flatMap(vfsMutationIntentPaths));
}

function mutationScanPaths(intent: VfsMutationIntent): readonly string[] {
  if ('path' in intent) return intent.kind === 'rm' ? [intent.path] : [];
  return intent.kind === 'copy' ? [intent.targetPath] : [intent.sourcePath, intent.targetPath];
}

/** Discover current claims from known live projects plus markers in affected scopes. */
export function discoverPackageMutationTransitions(
  fs: FsSync,
  knownProjects: readonly PackageAcquisitionProject[],
  intents: readonly VfsMutationIntent[],
): PackageMutationTransition[] {
  const projects = new Map<string, PackageAcquisitionProject>();
  const candidateRoots = new Set<string>();
  for (const project of knownProjects) {
    const root = normalizePath(project.root);
    projects.set(root, { ...project, root });
    candidateRoots.add(root);
  }
  for (const intent of intents) {
    for (const path of mutationPaths(intent)) addPathDerivedStampRoots(path, candidateRoots);
    for (const path of mutationScanPaths(intent)) scanStampRoots(fs, path, candidateRoots);
  }
  const physicalRoots = physicalStampRoots(fs, candidateRoots);
  const invalidRoots = new Set<string>();
  for (const root of candidateRoots) {
    const stamped = stampedProjectAt(fs, root);
    if (stamped) projects.set(root, stamped);
    else if (physicalRoots.has(root)) {
      projects.delete(root);
      invalidRoots.add(root);
    }
  }
  const transitions = packageMutationTransitionsForProjects(intents, [...projects.values()]);
  const transitionedRoots = new Set(transitions.map(transitionRoot));
  for (const root of invalidRoots) {
    if (
      !transitionedRoots.has(root) &&
      classifyVfsMutationIntentsPackageImpact(intents, root) !== 'none'
    ) {
      transitions.push({ mode: 'revoke', root });
    }
  }
  return sortTransitions(transitions);
}

/** Acquisition owns its actual claim separately: ancestors demote, descendants revoke. */
export function discoverPackageAcquisitionGuardTransitions(
  fs: FsSync,
  knownProjects: readonly PackageAcquisitionProject[],
  actualProject: string | Pick<PackageAcquisitionProject, 'root'>,
): PackageMutationTransition[] {
  const actualRoot = normalizePath(
    typeof actualProject === 'string' ? actualProject : actualProject.root,
  );
  const projects = new Map<string, PackageAcquisitionProject>();
  const candidateRoots = new Set<string>();
  for (const project of knownProjects) {
    const root = normalizePath(project.root);
    projects.set(root, { ...project, root });
    candidateRoots.add(root);
  }
  addPathDerivedStampRoots(actualRoot, candidateRoots);
  scanStampRoots(fs, installTreeDir(actualRoot), candidateRoots);
  const physicalRoots = physicalStampRoots(fs, candidateRoots);
  const invalidRoots = new Set<string>();
  for (const root of candidateRoots) {
    const stamped = stampedProjectAt(fs, root);
    if (stamped) projects.set(root, stamped);
    else if (physicalRoots.has(root)) {
      projects.delete(root);
      invalidRoots.add(root);
    }
  }

  const transitions: PackageMutationTransition[] = [];
  for (const project of projects.values()) {
    if (project.root === actualRoot) continue;
    if (containsPath(installTreeDir(project.root), actualRoot)) {
      transitions.push({ mode: 'demote', project });
    } else if (containsPath(installTreeDir(actualRoot), project.root)) {
      transitions.push({ mode: 'revoke', root: project.root });
    }
  }
  for (const root of invalidRoots) {
    if (root === actualRoot) continue;
    if (
      containsPath(installTreeDir(root), actualRoot) ||
      containsPath(installTreeDir(actualRoot), root)
    ) {
      transitions.push({ mode: 'revoke', root });
    }
  }
  return sortTransitions(transitions);
}

export function applyPackageAwareVfsMutations<T>(
  mutations: PackageMutationExecutor,
  _root: string,
  intents: readonly VfsMutationIntent[],
  apply: () => T | Promise<T>,
): T | Promise<T> {
  return mutations.guardedMutation(intents, async () => apply());
}

export function classifyHostCommitPackageImpact(
  request: HostCommitRequest,
  root: string,
): PackageMutationImpact {
  return classifyVfsMutationIntentsPackageImpact([hostCommitMutationIntent(request)], root);
}

export function hostCommitMutationIntent(request: HostCommitRequest): VfsMutationIntent {
  return request.kind === 'rename'
    ? {
        kind: 'rename',
        sourcePath: request.sourcePath,
        targetPath: request.targetPath,
      }
    : {
        kind: request.kind === 'remove' ? 'rm' : request.kind,
        path: request.path,
      };
}

export function hostCommitTouchesPath(request: HostCommitRequest, path: string): boolean {
  const target = normalizePath(path);
  const affects = (candidate: string): boolean => {
    const normalized = normalizePath(candidate);
    return normalized === target || containsPath(normalized, target);
  };
  if (request.kind === 'rename') {
    return affects(request.sourcePath) || affects(request.targetPath);
  }
  return affects(request.path);
}

export interface PackageAwareHostCommitAuthority {
  validateHostCommit(request: HostCommitRequest): HostCommitAck | null;
  applyHostCommit(request: HostCommitRequest): HostCommitAck;
}

/** Synchronous preflight preserves exact CAS/idempotency errors before stamp transition. */
export async function applyPackageAwareHostCommit(
  owner: PackageAwareHostCommitAuthority,
  mutations: PackageMutationExecutor,
  _root: string,
  request: HostCommitRequest,
): Promise<HostCommitAck> {
  const replay = owner.validateHostCommit(request);
  if (replay) return replay;
  const preflight: PackageEditPreflight<HostCommitAck> = async () => {
    const repeated = owner.validateHostCommit(request);
    if (repeated) return { status: 'noop', value: repeated };
    return { status: 'ready' };
  };
  return mutations.guardedMutation(
    [hostCommitMutationIntent(request)],
    async () => owner.applyHostCommit(request),
    preflight,
  );
}
