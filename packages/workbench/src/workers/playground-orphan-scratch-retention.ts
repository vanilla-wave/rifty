import type {
  PlaygroundRetainedOrphan,
  PlaygroundRetainedOrphanEntry,
} from '../workbench/playground.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';
import { compareCodeUnits, nonEmpty } from './playground-catalog-json.ts';
import type { StoredCatalog, StoredRetainedOrphan } from './playground-stored-catalog.ts';

export const RETAINED_ORPHANS_ROOT = '/.rifty/workbench/v1/retained-orphans';
export const SCRATCH_CONTAINER = '/.rifty/workbench/v1/projects/scratch';
export const SCRATCH_TREE = `${SCRATCH_CONTAINER}/tree`;
export const PLAYGROUND_TRANSACTION_FILE = '/.rifty/workbench/playground/transaction.json';

const RETAINED_ID = /^orphan-scratch-[A-Za-z0-9-]+$/;

export function retainedOrphanRoot(id: string): string {
  return `${RETAINED_ORPHANS_ROOT}/${id}`;
}

export function inspectRetainedOrphanId(id: string): string {
  const value = nonEmpty(id, 'retained orphan id');
  if (!RETAINED_ID.test(value)) throw new TypeError(`retained orphan id is unknown: ${value}`);
  return value;
}

export function inspectRetainedOrphanPath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('retained orphan path must be a non-empty relative POSIX path');
  }
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('//') ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new TypeError(`retained orphan path is invalid: ${path}`);
  }
  return path;
}

export function isUnjournaledOrphanScratch(
  authority: OwnerVfsAuthority,
  catalog: StoredCatalog,
): boolean {
  if (catalog.scratch !== null) return false;
  if (authority.statSyncOrNull(PLAYGROUND_TRANSACTION_FILE)?.isFile === true) return false;
  return authority.statSyncOrNull(SCRATCH_CONTAINER)?.isDirectory === true;
}

export function assertRetainOrphanPreconditions(authority: OwnerVfsAuthority, id: string): void {
  inspectRetainedOrphanId(id);
  if (authority.statSyncOrNull(SCRATCH_CONTAINER)?.isDirectory !== true) {
    throw new TypeError('Catalog mutation target is missing: scratch');
  }
  if (authority.statSyncOrNull(retainedOrphanRoot(id)) !== null) {
    throw new TypeError(`Catalog mutation target already exists: ${id}`);
  }
}

export function catalogRetainedOrphans(catalog: StoredCatalog): readonly StoredRetainedOrphan[] {
  return catalog.retainedOrphans ?? [];
}

export function requireRetainedOrphan(catalog: StoredCatalog, id: string): StoredRetainedOrphan {
  const token = inspectRetainedOrphanId(id);
  const found = catalogRetainedOrphans(catalog).find((entry) => entry.id === token);
  if (found === undefined) throw new TypeError(`retained orphan is absent: ${token}`);
  return found;
}

function walkFiles(authority: OwnerVfsAuthority, root: string): readonly string[] {
  const files: string[] = [];
  const visit = (directory: string, relative: string): void => {
    for (const entry of authority.readdirSync(directory)) {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) visit(path, child);
      else files.push(child);
    }
  };
  visit(root, '');
  return Object.freeze(files.sort(compareCodeUnits));
}

export function listRetainedOrphanEntries(
  authority: OwnerVfsAuthority,
  catalog: StoredCatalog,
  id: string,
): readonly PlaygroundRetainedOrphanEntry[] {
  const found = requireRetainedOrphan(catalog, id);
  const root = retainedOrphanRoot(found.id);
  if (authority.statSyncOrNull(root)?.isDirectory !== true) {
    throw new TypeError(`retained orphan is absent: ${found.id}`);
  }
  return Object.freeze(walkFiles(authority, root).map((path) => Object.freeze({ path })));
}

export function readRetainedOrphanFile(
  authority: OwnerVfsAuthority,
  catalog: StoredCatalog,
  id: string,
  path: string,
): Uint8Array {
  const found = requireRetainedOrphan(catalog, id);
  const relative = inspectRetainedOrphanPath(path);
  const root = retainedOrphanRoot(found.id);
  const file = `${root}/${relative}`;
  if (authority.statSyncOrNull(file)?.isFile !== true) {
    throw new TypeError(`retained orphan file is absent: ${relative}`);
  }
  return authority.readFileBytesSync(file);
}

export function publicRetainedOrphans(catalog: StoredCatalog): readonly PlaygroundRetainedOrphan[] {
  return Object.freeze(
    catalogRetainedOrphans(catalog).map((entry) =>
      Object.freeze({ id: entry.id, retainedAt: entry.retainedAt }),
    ),
  );
}
