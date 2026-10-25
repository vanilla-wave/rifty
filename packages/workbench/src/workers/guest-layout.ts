import { dirname, isAbsolute, normalizePath } from '@riftydev/vfs';

/**
 * ADR-0531 guest layout: the active project is mounted at a public root beside
 * project-owned `/tmp` and `/home/rifty` (stored in `<container>/guest`, outside
 * the visible tree). Strict ancestors of a mount are directories listing the
 * next mount segment; every other guest path is absent.
 */
export const DEFAULT_PUBLIC_PROJECT_ROOT = '/home/project';
export const GUEST_TMP = '/tmp';
export const GUEST_HOME = '/home/rifty';

export type GuestArea = 'project' | 'tmp' | 'home';

export interface GuestMount {
  readonly guest: string;
  readonly owner: string;
  readonly area: GuestArea;
}

export interface GuestLayout {
  readonly publicRoot: string;
  readonly projectRoot: string;
  /** Longest guest path first, so the first containing mount wins. */
  readonly mounts: readonly GuestMount[];
}

/** Typed launch pair carried to every child beside its public cwd (ADR-0280/0531). */
export interface GuestRoots {
  /** Owner physical project root. */
  readonly remoteFsRoot: string;
  /** Guest mount point of that project. */
  readonly publicRoot: string;
}

export function guestRootsLayout(roots: GuestRoots): GuestLayout {
  return createGuestLayout(roots.publicRoot, roots.remoteFsRoot);
}

export type GuestResolution =
  | { readonly kind: 'mount'; readonly mount: GuestMount; readonly owner: string }
  | {
      /** An ancestor of other mounts; `covering` is the mount that also contains it, if any. */
      readonly kind: 'virtual';
      readonly children: readonly string[];
      readonly covering: GuestMount | null;
      readonly owner: string | null;
    }
  | { readonly kind: 'absent' };

function contains(ancestor: string, path: string): boolean {
  return ancestor === '/' || path === ancestor || path.startsWith(`${ancestor}/`);
}

function canonical(path: string, label: string): string {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  return normalizePath(path);
}

/** Absolute, normalized, and never inside a project-owned mount. */
export function assertPublicProjectRoot(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) {
    throw new TypeError('publicProjectRoot must be an absolute path');
  }
  if (normalizePath(value) !== value) {
    throw new TypeError('publicProjectRoot must be a normalized path');
  }
  for (const reserved of [GUEST_TMP, GUEST_HOME]) {
    if (contains(reserved, value)) {
      throw new TypeError(`publicProjectRoot cannot be inside project-owned ${reserved}`);
    }
  }
  return value;
}

/** Project-owned private storage beside the visible tree. */
export function guestPrivateRoot(projectRoot: string): string {
  return `${dirname(projectRoot)}/guest`;
}

export function createGuestLayout(publicRoot: string, projectRoot: string): GuestLayout {
  const root = assertPublicProjectRoot(publicRoot);
  const owner = canonical(projectRoot, 'Workbench owner project root');
  if (owner === '/') throw new TypeError('Workbench owner project root cannot be /');
  const privateRoot = guestPrivateRoot(owner);
  const mounts: GuestMount[] = [
    { guest: root, owner, area: 'project' },
    { guest: GUEST_TMP, owner: `${privateRoot}/tmp`, area: 'tmp' },
    { guest: GUEST_HOME, owner: `${privateRoot}/home`, area: 'home' },
  ];
  mounts.sort((left, right) => right.guest.length - left.guest.length);
  return Object.freeze({
    publicRoot: root,
    projectRoot: owner,
    mounts: Object.freeze(mounts.map((mount) => Object.freeze(mount))),
  });
}

function ownerOf(mount: GuestMount, path: string): string {
  if (path === mount.guest) return mount.owner;
  return mount.guest === '/'
    ? `${mount.owner}${path}`
    : `${mount.owner}${path.slice(mount.guest.length)}`;
}

export function resolveGuestPath(layout: GuestLayout, rawPath: string): GuestResolution {
  const path = canonical(rawPath, 'Guest path');
  const children = new Set<string>();
  for (const mount of layout.mounts) {
    if (mount.guest !== path && contains(path, mount.guest)) {
      const rest = path === '/' ? mount.guest.slice(1) : mount.guest.slice(path.length + 1);
      children.add(rest.split('/')[0] as string);
    }
  }
  const covering = layout.mounts.find((mount) => contains(mount.guest, path)) ?? null;
  if (children.size > 0) {
    return Object.freeze({
      kind: 'virtual',
      children: Object.freeze([...children].sort()),
      covering,
      owner: covering === null ? null : ownerOf(covering, path),
    });
  }
  if (covering !== null) {
    return Object.freeze({ kind: 'mount', mount: covering, owner: ownerOf(covering, path) });
  }
  return Object.freeze({ kind: 'absent' });
}

/** Owner path → guest path, or `null` for owner state no mount exposes. */
export function ownerToGuestPath(layout: GuestLayout, rawOwnerPath: string): string | null {
  const ownerPath = canonical(rawOwnerPath, 'Owner path');
  let best: GuestMount | null = null;
  for (const mount of layout.mounts) {
    if (!contains(mount.owner, ownerPath)) continue;
    if (best === null || mount.owner.length > best.owner.length) best = mount;
  }
  if (best === null) return null;
  const rest = ownerPath.slice(best.owner.length);
  if (best.guest === '/') return rest === '' ? '/' : rest;
  return `${best.guest}${rest}`;
}

/** Rewrite owner paths in free text (diagnostics, npm output) to guest paths. */
export function guestText(layout: GuestLayout, text: string): string {
  let result = text;
  for (const mount of [...layout.mounts].sort((l, r) => r.owner.length - l.owner.length)) {
    result = result.replaceAll(mount.owner, mount.guest === '/' ? '' : mount.guest);
  }
  return result;
}
