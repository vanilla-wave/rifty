import { type CommandContext, ShellCommandLifecycleError } from '@riftydev/shell';
import {
  type FsSync,
  type VfsDirent,
  VfsError,
  type VfsMutationGuard,
  type VfsMutationIntent,
  normalizePath,
} from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import {
  type GuestLayout,
  type GuestMount,
  type GuestResolution,
  guestText,
  ownerToGuestPath,
  resolveGuestPath,
} from './guest-layout.ts';

type MountResolution = Extract<GuestResolution, { kind: 'mount' }>;

function guestMessage(layout: GuestLayout, message: string): string {
  return guestText(layout, message) || '/';
}

function namespaceError(layout: GuestLayout, error: unknown): unknown {
  if (error instanceof AggregateError) {
    return new AggregateError(
      error.errors.map((entry) => namespaceError(layout, entry)),
      guestMessage(layout, error.message),
      { cause: error },
    );
  }
  if (error instanceof ShellCommandLifecycleError) {
    return new ShellCommandLifecycleError(guestMessage(layout, error.message), { cause: error });
  }
  if (error instanceof VfsError) {
    const path = ownerToGuestPath(layout, error.path) ?? error.path;
    return new VfsError(error.code, path, guestMessage(layout, error.message), { cause: error });
  }
  if (error instanceof Error) {
    const translated = new Error(guestMessage(layout, error.message), { cause: error });
    translated.name = error.name;
    const details = error as Error & { readonly code?: unknown; readonly path?: unknown };
    if (typeof details.code === 'string') Object.assign(translated, { code: details.code });
    if (typeof details.path === 'string') {
      Object.assign(translated, { path: guestMessage(layout, details.path) });
    }
    return translated;
  }
  return typeof error === 'string' ? guestMessage(layout, error) : error;
}

function rethrowNamespaceError(layout: GuestLayout, error: unknown): never {
  throw namespaceError(layout, error);
}

const projectMount = (layout: GuestLayout): GuestMount =>
  layout.mounts.find((mount) => mount.area === 'project') as GuestMount;

/**
 * A project-owned mount nested under the project mount (`publicRoot` `/`) must
 * not shadow a project entry: refuse loudly (ADR-0531 §4).
 */
function assertNoCollision(layout: GuestLayout, inner: FsSync, mount: GuestMount): void {
  const project = projectMount(layout);
  if (mount.area === 'project' || mount.guest === project.guest) return;
  if (!(project.guest === '/' || mount.guest.startsWith(`${project.guest}/`))) return;
  const below = project.guest === '/' ? mount.guest : mount.guest.slice(project.guest.length);
  const segment = below.split('/')[1] as string;
  const guestEntry = project.guest === '/' ? `/${segment}` : `${project.guest}/${segment}`;
  if (inner.statSyncOrNull(`${project.owner}/${segment}`) !== null) {
    throw new VfsError(
      'EEXIST',
      guestEntry,
      `EEXIST: the project tree has its own ${guestEntry}, where the project-owned ${mount.guest} is mounted`,
    );
  }
}

/** The project's top-level `.rifty` stays reserved (ADR-0280), wherever the project is mounted. */
function assertNotReserved(resolved: GuestResolution, guestPath: string): void {
  if (resolved.kind !== 'mount' || resolved.mount.area !== 'project') return;
  const relative =
    resolved.mount.guest === '/' ? guestPath : guestPath.slice(resolved.mount.guest.length);
  if (relative === '/.rifty' || relative.startsWith('/.rifty/')) {
    throw new TypeError('Invalid project path');
  }
}

/** Guest view over the owner authority: mounts, virtual ancestors, and their edges (ADR-0531). */
export class ProjectTerminalFsSync implements FsSync {
  readonly #virtual = new MemoryFsSync();
  constructor(
    private readonly inner: FsSync,
    private readonly layout: GuestLayout,
  ) {
    for (const mount of layout.mounts) this.#virtual.mkdirSync(mount.guest, { recursive: true });
  }

  private resolve(path: string): GuestResolution {
    const guest = normalizePath(path);
    const resolved = resolveGuestPath(this.layout, guest);
    assertNotReserved(resolved, guest);
    if (resolved.kind === 'mount' && resolved.mount.area !== 'project') {
      assertNoCollision(this.layout, this.inner, resolved.mount);
      // A project-owned mount exists from its first use (no publication at open).
      if (this.inner.statSyncOrNull(resolved.mount.owner) === null) {
        this.inner.mkdirSync(resolved.mount.owner, { recursive: true });
      }
    }
    return resolved;
  }

  /** A path whose entry may be created: inside a mount, below the mount point. */
  private writable(path: string): MountResolution {
    const guest = normalizePath(path);
    const resolved = this.resolve(guest);
    if (resolved.kind === 'mount') return resolved;
    if (resolved.kind === 'virtual') throw new VfsError('EISDIR', guest);
    const parent = guest.slice(0, guest.lastIndexOf('/')) || '/';
    const parentResolved = resolveGuestPath(this.layout, parent);
    if (parentResolved.kind === 'virtual' && parentResolved.covering === null) {
      throw new VfsError('EACCES', guest, `EACCES: permission denied, ${guest}`);
    }
    throw new VfsError('ENOENT', guest);
  }

  /** An existing mount path (a copy source may be a mount point). */
  private existing(path: string): MountResolution {
    const guest = normalizePath(path);
    const resolved = this.resolve(guest);
    if (resolved.kind === 'mount') return resolved;
    if (resolved.kind === 'virtual')
      throw new VfsError('EPERM', guest, `EPERM: ${guest} spans mounts`);
    throw new VfsError('ENOENT', guest);
  }

  /** A path whose entry may be removed or replaced: never a mount point or ancestor. */
  private removable(path: string): MountResolution {
    const guest = normalizePath(path);
    const resolved = this.resolve(guest);
    if (
      resolved.kind === 'virtual' ||
      (resolved.kind === 'mount' && resolved.mount.guest === guest)
    ) {
      throw new VfsError(
        'EPERM',
        guest,
        `EPERM: ${guest} is a mount point and cannot be replaced or removed`,
      );
    }
    if (resolved.kind === 'absent') throw new VfsError('ENOENT', guest);
    return resolved;
  }

  private run<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      rethrowNamespaceError(this.layout, error);
    }
  }

  existsSync(path: string): boolean {
    return this.run(() => {
      const resolved = this.resolve(path);
      if (resolved.kind === 'virtual') return true;
      return resolved.kind === 'mount' && this.inner.existsSync(resolved.owner);
    });
  }

  readFileBytesSync(path: string): Uint8Array {
    return this.run(() => {
      const resolved = this.resolve(path);
      if (resolved.kind === 'virtual') throw new VfsError('EISDIR', normalizePath(path));
      if (resolved.kind === 'absent') throw new VfsError('ENOENT', normalizePath(path));
      return this.inner.readFileBytesSync(resolved.owner);
    });
  }

  writeFileSync(path: string, data: Uint8Array): void {
    this.run(() => {
      const resolved = this.writable(path);
      if (resolved.mount.guest === normalizePath(path))
        throw new VfsError('EISDIR', resolved.mount.guest);
      this.inner.writeFileSync(resolved.owner, data);
    });
  }

  readdirSync(path: string): readonly VfsDirent[] {
    return this.run(() => {
      const resolved = this.resolve(path);
      if (resolved.kind === 'absent') throw new VfsError('ENOENT', normalizePath(path));
      if (resolved.kind === 'mount') return this.inner.readdirSync(resolved.owner);
      // Listing a merged ancestor would show a mount over a project entry.
      for (const mount of this.layout.mounts) assertNoCollision(this.layout, this.inner, mount);
      return this.virtualEntries(resolved);
    });
  }

  private virtualEntries(
    resolved: Extract<GuestResolution, { kind: 'virtual' }>,
  ): readonly VfsDirent[] {
    const own =
      resolved.owner !== null && this.inner.statSyncOrNull(resolved.owner)?.isDirectory === true
        ? this.inner.readdirSync(resolved.owner)
        : [];
    const mounts = resolved.children.map((name) =>
      Object.freeze({ name, isFile: false, isDirectory: true }),
    );
    return [...own.filter((entry) => !resolved.children.includes(entry.name)), ...mounts].sort(
      (left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    );
  }

  mkdirSync(path: string, options: { recursive?: boolean }): void {
    this.run(() => {
      const guest = normalizePath(path);
      const resolved = this.resolve(guest);
      if (
        resolved.kind === 'virtual' ||
        (resolved.kind === 'mount' && resolved.mount.guest === guest)
      ) {
        if (options.recursive === true) return;
        throw new VfsError('EEXIST', guest);
      }
      if (resolved.kind === 'mount') {
        this.inner.mkdirSync(resolved.owner, options);
        return;
      }
      this.writable(guest);
    });
  }

  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    this.run(() => {
      const guest = normalizePath(path);
      if (options.force === true && this.resolve(guest).kind === 'absent') return;
      this.inner.rmSync(this.removable(guest).owner, options);
    });
  }

  statSync(path: string): ReturnType<FsSync['statSync']> {
    return this.run(() => {
      const resolved = this.resolve(path);
      if (resolved.kind === 'absent') throw new VfsError('ENOENT', normalizePath(path));
      if (resolved.kind === 'virtual')
        return {
          ...this.#virtual.statSync(normalizePath(path)),
          nlink: 2 + this.virtualEntries(resolved).filter((entry) => entry.isDirectory).length,
        };
      return this.inner.statSync(resolved.owner);
    });
  }

  statSyncOrNull(path: string): ReturnType<FsSync['statSyncOrNull']> {
    return this.run(() => {
      const resolved = this.resolve(path);
      if (resolved.kind === 'absent') return null;
      if (resolved.kind === 'virtual')
        return {
          ...this.#virtual.statSync(normalizePath(path)),
          nlink: 2 + this.virtualEntries(resolved).filter((entry) => entry.isDirectory).length,
        };
      return this.inner.statSyncOrNull(resolved.owner);
    });
  }

  utimes(path: string, atimeMs: number, mtimeMs: number): void {
    this.run(() => {
      const resolved = this.resolve(path);
      if (resolved.kind === 'absent') throw new VfsError('ENOENT', normalizePath(path));
      if (resolved.kind === 'virtual') throw new VfsError('EPERM', normalizePath(path));
      this.inner.utimes(resolved.owner, atimeMs, mtimeMs);
    });
  }

  copyFileSync(src: string, dst: string): void {
    this.run(() => {
      const source = this.existing(src);
      const target = this.writable(dst);
      this.inner.copyFileSync(source.owner, target.owner);
    });
  }

  cpSync(src: string, dst: string, options?: { recursive?: boolean }): void {
    this.run(() => {
      const source = this.existing(src);
      const target = this.writable(dst);
      if (target.mount.guest === normalizePath(dst))
        throw new VfsError('EEXIST', target.mount.guest);
      this.inner.cpSync(source.owner, target.owner, options);
    });
  }

  renameSync(src: string, dst: string): void {
    this.run(() => {
      const source = this.removable(src);
      const target = this.writable(dst);
      if (target.mount.guest === normalizePath(dst)) {
        throw new VfsError(
          'EPERM',
          target.mount.guest,
          `EPERM: ${target.mount.guest} is a mount point`,
        );
      }
      if (source.mount !== target.mount) {
        throw new VfsError(
          'EXDEV',
          normalizePath(src),
          `EXDEV: cross-device link not permitted, rename '${normalizePath(src)}' -> '${normalizePath(dst)}'`,
        );
      }
      this.inner.renameSync(source.owner, target.owner);
    });
  }
}

const MOUNT_POINT = (guest: string, operation: string): VfsError =>
  new VfsError('EPERM', guest, `EPERM: ${guest} is a mount point and cannot be ${operation}`);

/**
 * The owner intent the project publication guard needs, or `null` when the
 * mutation writes no project path (private areas persist without publication;
 * the FS operation itself refuses virtual or absent targets). Mount points and
 * cross-mount renames refuse before any filesystem or package-state effect.
 */
function projectIntent(layout: GuestLayout, intent: VfsMutationIntent): VfsMutationIntent | null {
  const at = (path: string): MountResolution | null => {
    const guest = normalizePath(path);
    const resolved = resolveGuestPath(layout, guest);
    assertNotReserved(resolved, guest);
    return resolved.kind === 'mount' ? resolved : null;
  };
  // A mount ancestor (`/`, `/home`) is never written, removed, moved or replaced.
  const ancestor = (path: string): string | null => {
    const guest = normalizePath(path);
    return resolveGuestPath(layout, guest).kind === 'virtual' ? guest : null;
  };
  const isMountPoint = (path: string, resolved: MountResolution): boolean =>
    resolved.mount.guest === normalizePath(path);
  switch (intent.kind) {
    case 'write':
    case 'mkdir':
    case 'utimes': {
      const virtual = ancestor(intent.path);
      if (virtual !== null && intent.kind === 'write') throw new VfsError('EISDIR', virtual);
      const target = at(intent.path);
      if (target === null) return null;
      if (intent.kind === 'write' && isMountPoint(intent.path, target)) {
        throw new VfsError('EISDIR', target.mount.guest);
      }
      return target.mount.area === 'project' ? { kind: intent.kind, path: target.owner } : null;
    }
    case 'rm':
    case 'replace': {
      const virtual = ancestor(intent.path);
      if (virtual !== null) throw MOUNT_POINT(virtual, 'replaced or removed');
      const target = at(intent.path);
      if (target === null) return null;
      if (isMountPoint(intent.path, target))
        throw MOUNT_POINT(target.mount.guest, 'replaced or removed');
      return target.mount.area === 'project' ? { kind: intent.kind, path: target.owner } : null;
    }
    case 'rename':
    case 'copy': {
      const virtual = ancestor(intent.sourcePath) ?? ancestor(intent.targetPath);
      if (virtual !== null)
        throw MOUNT_POINT(virtual, `${intent.kind === 'copy' ? 'copie' : 'move'}d`);
      const source = at(intent.sourcePath);
      const target = at(intent.targetPath);
      if (source === null || target === null) return null;
      if (isMountPoint(intent.targetPath, target))
        throw MOUNT_POINT(target.mount.guest, 'replaced');
      if (intent.kind === 'rename') {
        if (isMountPoint(intent.sourcePath, source)) throw MOUNT_POINT(source.mount.guest, 'moved');
        // `renameSync` itself refuses a cross-mount move (EXDEV); a caller that
        // then copies + removes (GNU mv) changes only the project side.
        if (source.mount !== target.mount) {
          if (source.mount.area === 'project') return { kind: 'rm', path: source.owner };
          return target.mount.area === 'project' ? { kind: 'write', path: target.owner } : null;
        }
      }
      if (target.mount.area !== 'project') return null;
      // A copy from a private area publishes only its project target.
      return source.mount.area === 'project'
        ? { kind: intent.kind, sourcePath: source.owner, targetPath: target.owner }
        : { kind: 'write', path: target.owner };
    }
  }
}

export interface ProjectTerminalNamespace {
  readonly layout: GuestLayout;
  readonly fileSystem: FsSync;
  readonly mutationGuard?: VfsMutationGuard;
  readonly assertPortablePaths?: (paths: readonly string[]) => void;
  /** Guest path inside a mount → owner path; other guest paths throw. */
  toOwnerPath(path: string): string;
  /** Owner path → guest path; owner state no mount exposes throws. */
  toGuestPath(path: string): string;
  toOwnerContext(context: CommandContext): CommandContext;
  rethrowOwnerError(error: unknown): never;
}

/** One bijection shared by shell paths, mutation policy, npm, and child launches. */
export function createProjectTerminalNamespace(options: {
  readonly layout: GuestLayout;
  readonly fileSystem: FsSync;
  readonly mutationGuard?: VfsMutationGuard;
  readonly assertPortablePaths?: (paths: readonly string[]) => void;
}): ProjectTerminalNamespace {
  const { layout } = options;
  const toOwnerPath = (path: string): string => {
    const guest = normalizePath(path);
    const resolved = resolveGuestPath(layout, guest);
    assertNotReserved(resolved, guest);
    if (resolved.kind === 'mount') return resolved.owner;
    if (resolved.kind === 'virtual' && resolved.owner !== null) return resolved.owner;
    throw new VfsError(
      'ENOENT',
      normalizePath(path),
      `ENOENT: ${normalizePath(path)} is not inside a mount`,
    );
  };
  const toGuestPath = (path: string): string => {
    const guest = ownerToGuestPath(layout, path);
    if (guest === null) throw new TypeError('Owner entry is outside the guest namespace');
    return guest;
  };
  const fileSystem = new ProjectTerminalFsSync(options.fileSystem, layout);
  const ownerMutationGuard = options.mutationGuard;
  const mutationGuard: VfsMutationGuard | undefined =
    ownerMutationGuard === undefined
      ? undefined
      : (intents, apply) => {
          try {
            const project = intents
              .map((intent) => projectIntent(layout, intent))
              .filter((intent): intent is VfsMutationIntent => intent !== null);
            // Private areas persist in the owner authority without project publication.
            if (project.length === 0) return apply();
            const guarded = ownerMutationGuard(project, apply);
            return guarded instanceof Promise
              ? guarded.catch((error: unknown) => rethrowNamespaceError(layout, error))
              : guarded;
          } catch (error) {
            rethrowNamespaceError(layout, error);
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
            rethrowNamespaceError(layout, error);
          }
        };
  const guestWriter = (writer: CommandContext['stdout']): CommandContext['stdout'] => ({
    write(chunk): void {
      writer.write(typeof chunk === 'string' ? guestMessage(layout, chunk) : chunk);
    },
  });

  return Object.freeze({
    layout,
    fileSystem,
    ...(mutationGuard === undefined ? {} : { mutationGuard }),
    ...(assertPortablePaths === undefined ? {} : { assertPortablePaths }),
    toOwnerPath,
    toGuestPath,
    toOwnerContext(context: CommandContext): CommandContext {
      return {
        ...context,
        cwd: toOwnerPath(context.cwd),
        stdout: guestWriter(context.stdout),
        stderr: guestWriter(context.stderr),
        fileSystem: options.fileSystem,
        mutationGuard: options.mutationGuard,
        assertPortablePaths: options.assertPortablePaths,
      };
    },
    rethrowOwnerError(error: unknown): never {
      rethrowNamespaceError(layout, error);
    },
  });
}
