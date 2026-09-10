import { type ShellCommandResult, shellCommandExitCode } from '@riftydev/shell';
import { type VfsMutationIntent, normalizePath } from '@riftydev/vfs';
import { isInsideInstallTree } from '../glue/install-stamp.ts';
import { parseNpmInstallRequest } from '../glue/npm-shell-command.ts';
import { vfsMutationIntentPaths } from '../glue/package-mutation-executor.ts';
import type { OwnerInitialInstall, OwnerNpmOperation } from './owner-package-types.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';

export type PlaygroundPackageMutationKind = 'dependency' | 'package-manifest' | 'package-lock';

function optionalFile(fs: OwnerVfsAuthority, path: string): Uint8Array | null {
  return fs.statSyncOrNull(path)?.isFile === true ? fs.readFileBytesSync(path) : null;
}

function equalBytes(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (left === null || right === null) return left === right;
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function bareInstall(args: readonly string[]): boolean {
  if (!['install', 'i', 'add'].includes(args[0] ?? '')) return false;
  const parsed = parseNpmInstallRequest(args.slice(1));
  return parsed.status === 'ready' && parsed.request.packageSpecs.length === 0;
}

/** The companion alone decides whether a first generated lock belongs to its starter baseline. */
export function playgroundInitialInstallFinalizer(
  amend: (root: string, lockfile: Uint8Array) => Promise<boolean>,
): (input: OwnerInitialInstall) => Promise<boolean> {
  return async (input) => {
    if (
      input.kind !== 'terminal-install' ||
      input.packageSpecs.length > 0 ||
      input.priorPackageLock !== null ||
      !equalBytes(input.priorPackageJson, new TextEncoder().encode(input.initialPackageJson))
    )
      return false;
    return amend(input.root, input.lockfile);
  };
}

/** Observe real command/filesystem facts inside the existing mutation settlement. */
export function createPlaygroundNpmObserver(
  fs: OwnerVfsAuthority,
  record: (kind: PlaygroundPackageMutationKind, revision: number) => Promise<void>,
): (operation: OwnerNpmOperation) => Promise<ShellCommandResult> {
  return async (operation) => {
    const project = operation.project;
    if (project === undefined || normalizePath(operation.cwd) !== normalizePath(project.root))
      return operation.execute();
    const manifestPath = normalizePath(`${project.root}/package.json`);
    const lockPath = normalizePath(`${project.root}/package-lock.json`);
    const revision = fs.treeRevision;
    const manifest = optionalFile(fs, manifestPath);
    const lock = optionalFile(fs, lockPath);
    const firstArrival =
      operation.firstMaterialization &&
      bareInstall(operation.args) &&
      lock === null &&
      equalBytes(manifest, new TextEncoder().encode(project.packageJson));
    let result: ShellCommandResult | undefined;
    let commandFailure: unknown;
    try {
      result = await operation.execute();
    } catch (error) {
      commandFailure = error;
    }
    let reflectionFailure: unknown;
    try {
      if (fs.treeRevision > revision) {
        if (
          firstArrival &&
          commandFailure === undefined &&
          result !== undefined &&
          shellCommandExitCode(result) === 0 &&
          operation.initialInstallFinalized()
        ) {
          await record('dependency', fs.treeRevision);
        } else {
          if (!equalBytes(manifest, optionalFile(fs, manifestPath)))
            await record('package-manifest', fs.treeRevision);
          if (!equalBytes(lock, optionalFile(fs, lockPath)))
            await record('package-lock', fs.treeRevision);
        }
      }
    } catch (error) {
      reflectionFailure = error;
    }
    if (commandFailure !== undefined && reflectionFailure !== undefined)
      throw new AggregateError(
        [commandFailure, reflectionFailure],
        'npm command and package mutation reflection failed',
      );
    if (commandFailure !== undefined) throw commandFailure;
    if (reflectionFailure !== undefined) throw reflectionFailure;
    return result as ShellCommandResult;
  };
}

export type PlaygroundProjectMutationKind =
  | 'guest'
  | 'scm'
  | 'archive'
  | 'file'
  | 'package-manifest'
  | 'package-lock'
  | 'seed'
  | 'dependency'
  | 'reserved-authority';

export function playgroundMutationIsDirty(
  kind: PlaygroundProjectMutationKind,
  intents?: readonly VfsMutationIntent[],
): boolean {
  if (
    (kind === 'file' || kind === 'guest') &&
    intents !== undefined &&
    intents.length > 0 &&
    intents.every((intent) => vfsMutationIntentPaths(intent).every(isInsideInstallTree))
  )
    return false;
  return (
    kind === 'guest' ||
    kind === 'file' ||
    kind === 'scm' ||
    kind === 'archive' ||
    kind === 'package-manifest' ||
    kind === 'package-lock'
  );
}
