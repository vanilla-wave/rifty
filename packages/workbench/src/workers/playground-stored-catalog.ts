import type { PlaygroundCatalogSnapshot, PlaygroundProjectRef } from '../workbench/playground.ts';
import { type CatalogAdoption, parseAdoption } from './playground-catalog-adoption.ts';
import { booleanValue, exactObject, nonEmpty } from './playground-catalog-json.ts';

export interface StoredScratch {
  readonly starterId: string;
  readonly dirty: boolean;
  readonly editedAt: string;
  readonly adoption: CatalogAdoption;
}

export interface StoredProject {
  readonly id: string;
  readonly name: string;
  readonly starterId: string;
  readonly editedAt: string;
  readonly adoption: CatalogAdoption;
}

export interface StoredRetainedOrphan {
  readonly id: string;
  readonly retainedAt: string;
}

export interface StoredCatalog {
  readonly version: 1;
  readonly active: PlaygroundProjectRef | null;
  readonly scratch: StoredScratch | null;
  readonly projects: readonly StoredProject[];
  readonly retainedOrphans?: readonly StoredRetainedOrphan[];
}

function parseActive(value: unknown, label: string): PlaygroundProjectRef | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be null or an object`);
  }
  const kind = (value as Readonly<Record<string, unknown>>).kind;
  if (kind === 'scratch') {
    exactObject(value, ['kind'], label);
    return Object.freeze({ kind });
  }
  if (kind === 'project') {
    const record = exactObject(value, ['kind', 'id'], label);
    return Object.freeze({ kind, id: nonEmpty(record.id, `${label}.id`) });
  }
  throw new TypeError(`${label}.kind is invalid`);
}

function parseRetainedOrphans(value: unknown): readonly StoredRetainedOrphan[] {
  if (!Array.isArray(value)) throw new TypeError('catalog.retainedOrphans must be an array');
  const ids = new Set<string>();
  return Object.freeze(
    value.map((entry, index): StoredRetainedOrphan => {
      const record = exactObject(
        entry,
        ['id', 'retainedAt'],
        `catalog.retainedOrphans[${String(index)}]`,
      );
      const id = nonEmpty(record.id, `catalog.retainedOrphans[${String(index)}].id`);
      if (ids.has(id)) throw new TypeError(`catalog retained orphan id is duplicated: ${id}`);
      ids.add(id);
      return Object.freeze({
        id,
        retainedAt: nonEmpty(
          record.retainedAt,
          `catalog.retainedOrphans[${String(index)}].retainedAt`,
        ),
      });
    }),
  );
}

export function parseStoredCatalog(value: unknown): StoredCatalog {
  const keys =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'retainedOrphans' in value
      ? (['version', 'active', 'scratch', 'projects', 'retainedOrphans'] as const)
      : (['version', 'active', 'scratch', 'projects'] as const);
  const catalog = exactObject(value, keys, 'catalog');
  if (catalog.version !== 1) throw new TypeError('catalog.version must be 1');
  const active = parseActive(catalog.active, 'catalog.active');
  let scratch: StoredScratch | null = null;
  if (catalog.scratch !== null) {
    const record = exactObject(
      catalog.scratch,
      ['starterId', 'dirty', 'editedAt', 'adoption'],
      'catalog.scratch',
    );
    scratch = Object.freeze({
      starterId: nonEmpty(record.starterId, 'catalog.scratch.starterId'),
      dirty: booleanValue(record.dirty, 'catalog.scratch.dirty'),
      editedAt: nonEmpty(record.editedAt, 'catalog.scratch.editedAt'),
      adoption: parseAdoption(record.adoption, 'catalog.scratch.adoption'),
    });
  }
  if (!Array.isArray(catalog.projects)) throw new TypeError('catalog.projects must be an array');
  const ids = new Set<string>();
  const projects = catalog.projects.map((entry, index): StoredProject => {
    const record = exactObject(
      entry,
      ['id', 'name', 'starterId', 'editedAt', 'adoption'],
      `catalog.projects[${String(index)}]`,
    );
    const id = nonEmpty(record.id, `catalog.projects[${String(index)}].id`);
    if (id === 'scratch' || ids.has(id))
      throw new TypeError(`catalog project id is invalid: ${id}`);
    ids.add(id);
    return Object.freeze({
      id,
      name: nonEmpty(record.name, `catalog.projects[${String(index)}].name`),
      starterId: nonEmpty(record.starterId, `catalog.projects[${String(index)}].starterId`),
      editedAt: nonEmpty(record.editedAt, `catalog.projects[${String(index)}].editedAt`),
      adoption: parseAdoption(record.adoption, `catalog.projects[${String(index)}].adoption`),
    });
  });
  if (active?.kind === 'scratch' && scratch === null) {
    throw new TypeError('catalog active Scratch is absent');
  }
  if (active?.kind === 'project' && !ids.has(active.id)) {
    throw new TypeError(`catalog active project is absent: ${active.id}`);
  }
  const retainedOrphans =
    catalog.retainedOrphans === undefined
      ? undefined
      : parseRetainedOrphans(catalog.retainedOrphans);
  return Object.freeze({
    version: 1,
    active,
    scratch,
    projects: Object.freeze(projects),
    ...(retainedOrphans === undefined || retainedOrphans.length === 0 ? {} : { retainedOrphans }),
  });
}

export function publicSnapshot(catalog: StoredCatalog): PlaygroundCatalogSnapshot {
  return Object.freeze({
    active:
      catalog.active === null
        ? null
        : catalog.active.kind === 'scratch'
          ? Object.freeze({ kind: 'scratch' as const })
          : Object.freeze({ kind: 'project' as const, id: catalog.active.id }),
    scratch:
      catalog.scratch === null
        ? null
        : Object.freeze({
            starterId: catalog.scratch.starterId,
            dirty: catalog.scratch.dirty,
            editedAt: catalog.scratch.editedAt,
          }),
    projects: Object.freeze(
      catalog.projects.map((project) =>
        Object.freeze({
          id: project.id,
          name: project.name,
          starterId: project.starterId,
          editedAt: project.editedAt,
        }),
      ),
    ),
  });
}

export function emptyCatalog(): StoredCatalog {
  return Object.freeze({ version: 1, active: null, scratch: null, projects: Object.freeze([]) });
}
