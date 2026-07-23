import type { CommandContext } from '@riftydev/shell';
import {
  type FsSync,
  VfsError,
  type VfsMutationGuard,
  type VfsMutationIntent,
  normalizePath,
} from '@riftydev/vfs';
import { toOwnerProjectPath, toProjectPath } from '../workbench/project-file-boundary.ts';

function publicPath(path: string): string {
  return normalizePath(path);
}

function publicMessage(projectRoot: string, message: string): string {
  return message.replaceAll(projectRoot, '') || '/';
}

function namespaceError(projectRoot: string, error: unknown): unknown {
  if (error instanceof AggregateError) {
    return new AggregateError(
      error.errors.map((entry) => namespaceError(projectRoot, entry)),
      publicMessage(projectRoot, error.message),
      { cause: error },
    );
  }
  if (error instanceof VfsError) {
    const path = toProjectPath(projectRoot, error.path);
    return new VfsError(error.code, path, publicMessage(projectRoot, error.message), {
      cause: error,
    });
  }
  if (error instanceof Error) {
    const translated = new Error(publicMessage(projectRoot, error.message), { cause: error });
    translated.name = error.name;
    const details = error as Error & { readonly code?: unknown; readonly path?: unknown };
    if (typeof details.code === 'string') Object.assign(translated, { code: details.code });
    if (typeof details.path === 'string') {
      Object.assign(translated, { path: publicMessage(projectRoot, details.path) });
    }
    return translated;
  }
  return typeof error === 'string' ? publicMessage(projectRoot, error) : error;
}

function rethrowNamespaceError(projectRoot: string, error: unknown): never {
  throw namespaceError(projectRoot, error);
}

function isRootDestructive(intent: VfsMutationIntent): boolean {
  switch (intent.kind) {
    case 'rm':
    case 'replace':
      return publicPath(intent.path) === '/';
    case 'rename':
    case 'copy':
      return publicPath(intent.sourcePath) === '/' || publicPath(intent.targetPath) === '/';
    case 'write':
    case 'mkdir':
    case 'utimes':
      return false;
  }
}

function rejectRootDestructive(intents: readonly VfsMutationIntent[]): void {
  if (intents.some((intent) => intent.kind === 'write' && publicPath(intent.path) === '/')) {
    throw new VfsError('EISDIR', '/');
  }
  if (intents.some(isRootDestructive)) {
    throw new VfsError('EPERM', '/', 'EPERM: project root cannot be replaced or removed');
  }
}

/** Strict project-rooted sync view: public `/x` maps to private `<projectRoot>/x`. */
export class ProjectTerminalFsSync implements FsSync {
  constructor(
    private readonly inner: FsSync,
    private readonly projectRoot: string,
  ) {}

  private owner(path: string): string {
    return toOwnerProjectPath(this.projectRoot, publicPath(path), { allowRoot: true });
  }

  private rejectRoot(path: string): void {
    if (publicPath(path) === '/') {
      throw new VfsError('EPERM', '/', 'EPERM: project root cannot be replaced or removed');
    }
  }

  private read<T>(path: string, operation: (ownerPath: string) => T): T {
    try {
      return operation(this.owner(path));
    } catch (error) {
      rethrowNamespaceError(this.projectRoot, error);
    }
  }

  existsSync(path: string): boolean {
    return this.read(path, (ownerPath) => this.inner.existsSync(ownerPath));
  }

  readFileBytesSync(path: string): Uint8Array {
    return this.read(path, (ownerPath) => this.inner.readFileBytesSync(ownerPath));
  }

  writeFileSync(path: string, data: Uint8Array): void {
    if (publicPath(path) === '/') throw new VfsError('EISDIR', '/');
    this.read(path, (ownerPath) => this.inner.writeFileSync(ownerPath, data));
  }

  readdirSync(path: string): ReturnType<FsSync['readdirSync']> {
    return this.read(path, (ownerPath) => this.inner.readdirSync(ownerPath));
  }

  mkdirSync(path: string, options: { recursive?: boolean }): void {
    if (publicPath(path) === '/') {
      if (options.recursive === true) return;
      throw new VfsError('EEXIST', '/');
    }
    this.read(path, (ownerPath) => this.inner.mkdirSync(ownerPath, options));
  }

  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    this.rejectRoot(path);
    this.read(path, (ownerPath) => this.inner.rmSync(ownerPath, options));
  }

  statSync(path: string): ReturnType<FsSync['statSync']> {
    return this.read(path, (ownerPath) => this.inner.statSync(ownerPath));
  }

  statSyncOrNull(path: string): ReturnType<FsSync['statSyncOrNull']> {
    return this.read(path, (ownerPath) => this.inner.statSyncOrNull(ownerPath));
  }

  utimes(path: string, atimeMs: number, mtimeMs: number): void {
    this.read(path, (ownerPath) => this.inner.utimes(ownerPath, atimeMs, mtimeMs));
  }

  copyFileSync(src: string, dst: string): void {
    this.rejectRoot(src);
    this.rejectRoot(dst);
    const ownerSource = this.owner(src);
    const ownerTarget = this.owner(dst);
    try {
      this.inner.copyFileSync(ownerSource, ownerTarget);
    } catch (error) {
      rethrowNamespaceError(this.projectRoot, error);
    }
  }

  cpSync(src: string, dst: string, options?: { recursive?: boolean }): void {
    this.rejectRoot(src);
    this.rejectRoot(dst);
    const ownerSource = this.owner(src);
    const ownerTarget = this.owner(dst);
    try {
      this.inner.cpSync(ownerSource, ownerTarget, options);
    } catch (error) {
      rethrowNamespaceError(this.projectRoot, error);
    }
  }

  renameSync(src: string, dst: string): void {
    this.rejectRoot(src);
    this.rejectRoot(dst);
    const ownerSource = this.owner(src);
    const ownerTarget = this.owner(dst);
    try {
      this.inner.renameSync(ownerSource, ownerTarget);
    } catch (error) {
      rethrowNamespaceError(this.projectRoot, error);
    }
  }
}

function ownerIntent(projectRoot: string, intent: VfsMutationIntent): VfsMutationIntent {
  switch (intent.kind) {
    case 'write':
    case 'mkdir':
    case 'rm':
    case 'utimes':
    case 'replace':
      return {
        kind: intent.kind,
        path: toOwnerProjectPath(projectRoot, publicPath(intent.path), { allowRoot: true }),
      };
    case 'rename':
    case 'copy':
      return {
        kind: intent.kind,
        sourcePath: toOwnerProjectPath(projectRoot, publicPath(intent.sourcePath), {
          allowRoot: true,
        }),
        targetPath: toOwnerProjectPath(projectRoot, publicPath(intent.targetPath), {
          allowRoot: true,
        }),
      };
  }
}

export interface ProjectTerminalNamespace {
  readonly fileSystem: FsSync;
  readonly mutationGuard?: VfsMutationGuard;
  readonly assertPortablePaths?: (paths: readonly string[]) => void;
  toOwnerPath(path: string): string;
  toProjectPath(path: string): string;
  toOwnerContext(context: CommandContext): CommandContext;
  rethrowOwnerError(error: unknown): never;
}

/** One bijection shared by shell paths, mutation policy, npm, and child launches. */
export function createProjectTerminalNamespace(options: {
  readonly projectRoot: string;
  readonly fileSystem: FsSync;
  readonly mutationGuard?: VfsMutationGuard;
  readonly assertPortablePaths?: (paths: readonly string[]) => void;
}): ProjectTerminalNamespace {
  const toOwnerPath = (path: string): string =>
    toOwnerProjectPath(options.projectRoot, publicPath(path), { allowRoot: true });
  const fileSystem = new ProjectTerminalFsSync(options.fileSystem, options.projectRoot);
  const ownerMutationGuard = options.mutationGuard;
  const mutationGuard: VfsMutationGuard | undefined =
    ownerMutationGuard === undefined
      ? undefined
      : (intents, apply) => {
          rejectRootDestructive(intents);
          try {
            const guarded = ownerMutationGuard(
              intents.map((intent) => ownerIntent(options.projectRoot, intent)),
              apply,
            );
            return guarded instanceof Promise
              ? guarded.catch((error: unknown) => rethrowNamespaceError(options.projectRoot, error))
              : guarded;
          } catch (error) {
            rethrowNamespaceError(options.projectRoot, error);
          }
        };
  const ownerAssertPortablePaths = options.assertPortablePaths;
  const assertPortablePaths =
    ownerAssertPortablePaths === undefined
      ? undefined
      : (paths: readonly string[]): void => {
          try {
            ownerAssertPortablePaths(paths.map(toOwnerPath));
          } catch (error) {
            rethrowNamespaceError(options.projectRoot, error);
          }
        };
  const projectWriter = (writer: CommandContext['stdout']): CommandContext['stdout'] => ({
    write(chunk): void {
      writer.write(typeof chunk === 'string' ? publicMessage(options.projectRoot, chunk) : chunk);
    },
  });

  return Object.freeze({
    fileSystem,
    ...(mutationGuard === undefined ? {} : { mutationGuard }),
    ...(assertPortablePaths === undefined ? {} : { assertPortablePaths }),
    toOwnerPath,
    toProjectPath: (path: string) => toProjectPath(options.projectRoot, path),
    toOwnerContext(context: CommandContext): CommandContext {
      return {
        ...context,
        cwd: toOwnerPath(context.cwd),
        stdout: projectWriter(context.stdout),
        stderr: projectWriter(context.stderr),
        fileSystem: options.fileSystem,
        mutationGuard: options.mutationGuard,
        assertPortablePaths: options.assertPortablePaths,
      };
    },
    rethrowOwnerError(error: unknown): never {
      rethrowNamespaceError(options.projectRoot, error);
    },
  });
}
