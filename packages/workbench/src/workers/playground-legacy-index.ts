/** Legacy (pre-catalog) project index: parse and project to the stored catalog (moved from `playground-project-authority.ts`). */
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';
import {
  type StoredCatalog,
  booleanValue,
  exactObject,
  nonEmpty,
} from './playground-catalog-records.ts';
import { isDirectory } from './playground-catalog-tree.ts';

export interface LegacyIndexScratch {
  readonly starter: string;
  readonly dirty: boolean;
  readonly editedAt: string;
}

export interface LegacyIndexProject {
  readonly id: string;
  readonly name: string;
  readonly starter: string;
  readonly editedAt: string;
}

export interface LegacyIndex {
  readonly activeId: string;
  readonly scratch: LegacyIndexScratch | null;
  readonly projects: readonly LegacyIndexProject[];
}

export function parseLegacyIndex(
  value: unknown,
  authority: OwnerVfsAuthority,
  prefix: string,
): LegacyIndex {
  const index = exactObject(value, ['activeId', 'scratch', 'projects'], 'legacy project index');
  const activeId = nonEmpty(index.activeId, 'legacy project index activeId');
  let scratch: LegacyIndexScratch | null = null;
  if (index.scratch !== null) {
    const record = exactObject(
      index.scratch,
      ['starter', 'dirty', 'editedAt'],
      'legacy project index scratch',
    );
    scratch = Object.freeze({
      starter: nonEmpty(record.starter, 'legacy project index scratch starter'),
      dirty: booleanValue(record.dirty, 'legacy project index scratch dirty'),
      editedAt: nonEmpty(record.editedAt, 'legacy project index scratch editedAt'),
    });
  }
  if (!Array.isArray(index.projects))
    throw new TypeError('legacy project index projects is invalid');
  const ids = new Set<string>();
  const projects = index.projects.map((entry, position): LegacyIndexProject => {
    const record = exactObject(
      entry,
      ['id', 'name', 'starter', 'editedAt'],
      `legacy project index project ${String(position)}`,
    );
    const id = nonEmpty(record.id, `legacy project index project ${String(position)} id`);
    if (id === 'scratch' || ids.has(id)) throw new TypeError(`legacy project id is invalid: ${id}`);
    ids.add(id);
    return Object.freeze({
      id,
      name: nonEmpty(record.name, `legacy project index project ${String(position)} name`),
      starter: nonEmpty(record.starter, `legacy project index project ${String(position)} starter`),
      editedAt: nonEmpty(
        record.editedAt,
        `legacy project index project ${String(position)} editedAt`,
      ),
    });
  });
  const scratchRoot = `${prefix}/scratch`;
  if ((scratch !== null) !== isDirectory(authority, scratchRoot)) {
    throw new TypeError('legacy Scratch metadata/tree state disagrees');
  }
  for (const project of projects) {
    if (!isDirectory(authority, `${prefix}/projects/${project.id}`)) {
      throw new TypeError(`legacy project source is missing: ${project.id}`);
    }
  }
  if (activeId === 'scratch') {
    if (scratch === null) throw new TypeError('legacy active Scratch metadata is absent');
  } else if (!ids.has(activeId)) {
    throw new TypeError(`legacy active project is absent: ${activeId}`);
  }
  return Object.freeze({ activeId, scratch, projects: Object.freeze(projects) });
}

export function legacyCatalog(index: LegacyIndex, prefix: string): StoredCatalog {
  return Object.freeze({
    version: 1,
    active:
      index.activeId === 'scratch'
        ? Object.freeze({ kind: 'scratch' as const })
        : Object.freeze({ kind: 'project' as const, id: index.activeId }),
    scratch:
      index.scratch === null
        ? null
        : Object.freeze({
            starterId: index.scratch.starter,
            dirty: index.scratch.dirty,
            editedAt: index.scratch.editedAt,
            adoption: Object.freeze({
              kind: 'pending-adoption' as const,
              sourceRoot: `${prefix}/scratch`,
            }),
          }),
    projects: Object.freeze(
      index.projects.map((project) =>
        Object.freeze({
          id: project.id,
          name: project.name,
          starterId: project.starter,
          editedAt: project.editedAt,
          adoption: Object.freeze({
            kind: 'pending-adoption' as const,
            sourceRoot: `${prefix}/projects/${project.id}`,
          }),
        }),
      ),
    ),
  });
}
