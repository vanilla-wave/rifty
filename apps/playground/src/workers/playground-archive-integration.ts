import { dirname } from '@riftydev/vfs';
import { InstallStampAuthorityError } from '../glue/install-stamp-authority.ts';
import {
  PLAYGROUND_ARCHIVE_V1_LIMITS,
  exportPlaygroundArchiveV1,
  preparePlaygroundArchiveV1Import,
  readBoundedPlaygroundArchiveTree,
} from '../workbench/internal/playground-archive.ts';
import { formatProjectPersistenceFailure } from '../workbench/project-file-boundary.ts';
import type { OwnerPackageState } from './owner-package-state.ts';
import type { OwnerVfsAuthority, OwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import type { WorkbenchProjectVfs } from './workbench-project-vfs.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const PHASE_PROMOTING = 'promoting\n';
const PHASE_COMMITTED = 'committed\n';

interface OwnerPlaygroundArchive {
  export(): Promise<string>;
  import(archiveJson: string, beforePublish: () => void): Promise<void>;
}

export interface CreateOwnerPlaygroundArchiveOptions {
  readonly projectRoot: string;
  readonly owner: OwnerVfsAuthorityComposition;
  readonly packages: OwnerPackageState;
  readonly projectVfs: WorkbenchProjectVfs;
}

export interface RecoverOwnerPlaygroundArchiveTransactionOptions {
  readonly projectRoot: string;
  readonly owner: OwnerVfsAuthorityComposition;
  readonly packages: OwnerPackageState;
}

interface ArchiveTransactionPaths {
  readonly root: string;
  readonly stage: string;
  readonly phase: string;
}

interface ArchiveStageFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function transactionPaths(projectRoot: string): ArchiveTransactionPaths {
  const root = `${dirname(projectRoot)}/.playground-archive-v1`;
  return Object.freeze({ root, stage: `${root}/stage`, phase: `${root}/phase` });
}

function errorFrom(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function publicArchiveMessage(
  projectRoot: string,
  paths: ArchiveTransactionPaths,
  message: string,
): string {
  const firstPrivatePath = [projectRoot, paths.root, '/.rifty']
    .map((marker) => message.indexOf(marker))
    .filter((index) => index >= 0)
    .reduce((first, index) => Math.min(first, index), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(firstPrivatePath)) return message;
  // Error text has no path grammar: every printable character except NUL is
  // legal in a Unix filename. Keep the diagnostic prefix, redact the rest.
  return `${message.slice(0, firstPrivatePath)}[outside active project]`;
}

function publicArchiveError(
  projectRoot: string,
  paths: ArchiveTransactionPaths,
  error: unknown,
  seen = new Set<unknown>(),
): Error {
  if (seen.has(error)) return new Error('Playground archive error cause cycle');
  seen.add(error);
  if (error instanceof AggregateError) {
    const cause =
      error.cause === undefined
        ? undefined
        : publicArchiveError(projectRoot, paths, error.cause, seen);
    return new AggregateError(
      error.errors.map((nested) => publicArchiveError(projectRoot, paths, nested, seen)),
      publicArchiveMessage(projectRoot, paths, error.message),
      cause === undefined ? undefined : { cause },
    );
  }
  const source = errorFrom(error);
  const cause =
    source.cause === undefined
      ? undefined
      : publicArchiveError(projectRoot, paths, source.cause, seen);
  const message = publicArchiveMessage(projectRoot, paths, source.message);
  if (source instanceof InstallStampAuthorityError) {
    return new InstallStampAuthorityError(
      source.code,
      message,
      cause === undefined ? undefined : { cause },
    );
  }
  const projected = new Error(message, cause === undefined ? undefined : { cause });
  projected.name = publicArchiveMessage(projectRoot, paths, source.name) || 'Error';
  return projected;
}

async function publicArchiveBoundary<T>(
  projectRoot: string,
  paths: ArchiveTransactionPaths,
  operation: () => Promise<T> | T,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw publicArchiveError(projectRoot, paths, error);
  }
}

/** Keep owner paths private across the complete public archive command. */
export function runPlaygroundArchivePublicOperation<T>(
  projectRoot: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  return publicArchiveBoundary(projectRoot, transactionPaths(projectRoot), operation);
}

async function requireDurable(authority: OwnerVfsAuthority, projectRoot: string): Promise<void> {
  const report = await authority.flush();
  if (report === undefined || report.total === 0) return;
  const detail = report.failures
    .map((failure) => formatProjectPersistenceFailure(projectRoot, failure))
    .join('; ');
  const summary = `${String(report.total)} unhealed failure${report.total === 1 ? '' : 's'}`;
  throw new Error(
    `Playground archive persistence failed: ${summary}; ${detail || 'failure sample unavailable'}`,
  );
}

async function settleArchiveOperation<T>(
  authority: OwnerVfsAuthority,
  projectRoot: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    try {
      await requireDurable(authority, projectRoot);
    } catch (drainError) {
      throw new AggregateError(
        [errorFrom(error), errorFrom(drainError)],
        'Playground archive operation and durability settlement failed',
      );
    }
    throw error;
  }
}

async function durableMkdir(
  authority: OwnerVfsAuthority,
  projectRoot: string,
  path: string,
): Promise<void> {
  if (authority.statSyncOrNull(path) !== null) return;
  authority.mkdirSync(path, { recursive: true });
  await requireDurable(authority, projectRoot);
}

async function durableWrite(
  authority: OwnerVfsAuthority,
  projectRoot: string,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await durableMkdir(authority, projectRoot, dirname(path));
  authority.writeFileSync(path, bytes);
  await requireDurable(authority, projectRoot);
}

async function durableRemove(
  authority: OwnerVfsAuthority,
  projectRoot: string,
  path: string,
): Promise<void> {
  if (authority.statSyncOrNull(path) === null) return;
  authority.rmSync(path, { recursive: true, force: true });
  await requireDurable(authority, projectRoot);
}

type ArchiveTransactionState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unarmed' }
  | { readonly kind: 'promoting' }
  | { readonly kind: 'committed' };

function inspectArchiveTransaction(
  authority: OwnerVfsAuthority,
  paths: ArchiveTransactionPaths,
): ArchiveTransactionState {
  const root = authority.statSyncOrNull(paths.root);
  if (root === null) return Object.freeze({ kind: 'absent' });
  if (!root.isDirectory) {
    throw new Error('Playground archive transaction root is corrupt');
  }
  const phaseEntry = authority.statSyncOrNull(paths.phase);
  if (phaseEntry === null) return Object.freeze({ kind: 'unarmed' });
  if (!phaseEntry.isFile) {
    throw new Error('Playground archive recovery phase is not a file');
  }
  let phase: string;
  try {
    phase = decoder.decode(authority.readFileBytesSync(paths.phase));
  } catch (error) {
    throw new Error('Playground archive recovery phase is corrupt UTF-8', {
      cause: error,
    });
  }
  if (phase === PHASE_PROMOTING) return Object.freeze({ kind: 'promoting' });
  if (phase === PHASE_COMMITTED) return Object.freeze({ kind: 'committed' });
  throw new Error(`Playground archive recovery phase is unknown: ${JSON.stringify(phase)}`);
}

function stageFiles(
  authority: OwnerVfsAuthority,
  paths: ArchiveTransactionPaths,
): readonly ArchiveStageFile[] {
  if (authority.statSyncOrNull(paths.stage)?.isDirectory !== true) {
    throw new Error('Playground archive recovery stage is missing');
  }
  return Object.freeze(
    readBoundedPlaygroundArchiveTree(
      authority,
      paths.stage,
      PLAYGROUND_ARCHIVE_V1_LIMITS,
      'reject',
    ).map(({ path, bytes }) => Object.freeze({ path, bytes: bytes.slice() })),
  );
}

async function materializeStage(
  projectRoot: string,
  authority: OwnerVfsAuthority,
  paths: ArchiveTransactionPaths,
  files: readonly { readonly path: string; readonly bytes: Uint8Array }[],
): Promise<void> {
  await durableMkdir(authority, projectRoot, paths.stage);
  const directories = new Set<string>();
  for (const file of files) {
    let directory = dirname(`${paths.stage}/${file.path}`);
    while (directory !== paths.stage) {
      directories.add(directory);
      directory = dirname(directory);
    }
  }
  for (const directory of [...directories].sort((left, right) => {
    const depth = left.split('/').length - right.split('/').length;
    return depth || compareCodeUnits(left, right);
  })) {
    await durableMkdir(authority, projectRoot, directory);
  }
  for (const file of [...files].sort((left, right) => compareCodeUnits(left.path, right.path))) {
    await durableWrite(authority, projectRoot, `${paths.stage}/${file.path}`, file.bytes);
  }
}

async function promoteStage(
  projectRoot: string,
  authority: OwnerVfsAuthority,
  staged: readonly ArchiveStageFile[],
): Promise<void> {
  if (authority.statSyncOrNull(`${projectRoot}/node_modules`) !== null) {
    throw new Error('Playground archive package reset left node_modules present');
  }
  await durableMkdir(authority, projectRoot, projectRoot);
  const children = [...authority.readdirSync(projectRoot)].sort((left, right) =>
    compareCodeUnits(left.name, right.name),
  );
  // V1 archives produced before ADR-0286 contain no Git bytes. Keep their
  // source-only import behavior; a current archive carrying `.git/*` replaces
  // the repository as part of the exact workspace snapshot.
  const replacesGit = staged.some(({ path }) => path === '.git' || path.startsWith('.git/'));
  for (const child of children) {
    if (child.name === '.git' && !replacesGit) continue;
    await durableRemove(authority, projectRoot, `${projectRoot}/${child.name}`);
  }

  const directories = new Set<string>();
  for (const file of staged) {
    let directory = dirname(`${projectRoot}/${file.path}`);
    while (directory !== projectRoot) {
      directories.add(directory);
      directory = dirname(directory);
    }
  }
  for (const directory of [...directories].sort((left, right) => {
    const depth = left.split('/').length - right.split('/').length;
    return depth || compareCodeUnits(left, right);
  })) {
    await durableMkdir(authority, projectRoot, directory);
  }
  for (const file of staged) {
    await durableWrite(authority, projectRoot, `${projectRoot}/${file.path}`, file.bytes);
  }
}

async function recoverArchiveTransaction(
  projectRoot: string,
  owner: OwnerVfsAuthorityComposition,
  packages: OwnerPackageState,
  paths: ArchiveTransactionPaths,
): Promise<void> {
  await settleArchiveOperation(owner.authority, projectRoot, async () => {
    const state = inspectArchiveTransaction(owner.authority, paths);
    if (state.kind === 'absent') return;
    if (state.kind === 'unarmed' || state.kind === 'committed') {
      await durableRemove(owner.authority, projectRoot, paths.root);
      return;
    }
    const staged = stageFiles(owner.authority, paths);
    await packages.mutations.reset({ root: projectRoot }, async () => ({
      status: 'ready',
      resetDependencyTree: true,
      mutate: async (resetDependencyTree) => {
        if (resetDependencyTree === undefined) {
          throw new Error('Playground archive recovery package reset is missing');
        }
        await resetDependencyTree();
        await promoteStage(projectRoot, owner.authority, staged);
        await durableRemove(owner.authority, projectRoot, paths.root);
      },
    }));
  });
}

async function beginArchiveTransaction(
  projectRoot: string,
  authority: OwnerVfsAuthority,
  paths: ArchiveTransactionPaths,
): Promise<void> {
  const state = inspectArchiveTransaction(authority, paths);
  if (state.kind === 'promoting') {
    throw new Error(
      'Playground archive import cannot replace an existing promoting transaction; reopen the project to recover it',
    );
  }
  if (state.kind !== 'absent') await durableRemove(authority, projectRoot, paths.root);
}

/** Roll forward an armed archive before runtime, Git, SCM, or content reads. */
export async function recoverOwnerPlaygroundArchiveTransaction(
  options: RecoverOwnerPlaygroundArchiveTransactionOptions,
): Promise<void> {
  const paths = transactionPaths(options.projectRoot);
  return publicArchiveBoundary(options.projectRoot, paths, () =>
    recoverArchiveTransaction(options.projectRoot, options.owner, options.packages, paths),
  );
}

export async function createOwnerPlaygroundArchive(
  options: CreateOwnerPlaygroundArchiveOptions,
): Promise<OwnerPlaygroundArchive> {
  const paths = transactionPaths(options.projectRoot);
  return publicArchiveBoundary(options.projectRoot, paths, async () => {
    await recoverArchiveTransaction(options.projectRoot, options.owner, options.packages, paths);
    // Construction may follow Git/bootstrap writes admitted before this slice.
    // The archive starts only from a fully drained durability boundary.
    await requireDurable(options.owner.authority, options.projectRoot);

    return Object.freeze({
      export: () =>
        publicArchiveBoundary(options.projectRoot, paths, async () => {
          await options.packages.quiesce();
          await options.projectVfs.publicationBarrier();
          return exportPlaygroundArchiveV1(options.owner.authority, options.projectRoot);
        }),
      import: (archiveJson: string, beforePublish: () => void) =>
        publicArchiveBoundary(options.projectRoot, paths, async () => {
          const prepared = preparePlaygroundArchiveV1Import(
            options.owner.authority,
            options.projectRoot,
            archiveJson,
          );
          const files = prepared.decodedFiles();
          let staged: readonly ArchiveStageFile[] | null = null;
          await settleArchiveOperation(options.owner.authority, options.projectRoot, () =>
            options.projectVfs.recoverableProjectReplace(
              async (armPointOfNoReturn) => {
                await beginArchiveTransaction(options.projectRoot, options.owner.authority, paths);
                await materializeStage(options.projectRoot, options.owner.authority, paths, files);
                armPointOfNoReturn();
                await durableWrite(
                  options.owner.authority,
                  options.projectRoot,
                  paths.phase,
                  encoder.encode(PHASE_PROMOTING),
                );
                staged = stageFiles(options.owner.authority, paths);
              },
              async () => {
                try {
                  if (staged === null) {
                    throw new Error('Playground archive stage was not prepared');
                  }
                  await promoteStage(options.projectRoot, options.owner.authority, staged);
                  await durableWrite(
                    options.owner.authority,
                    options.projectRoot,
                    paths.phase,
                    encoder.encode(PHASE_COMMITTED),
                  );
                  await durableRemove(options.owner.authority, options.projectRoot, paths.root);
                  beforePublish();
                  return { status: 'committed', value: undefined };
                } catch (error) {
                  return { status: 'recoverable-failure', error: errorFrom(error) };
                }
              },
            ),
          );
        }),
    });
  });
}
