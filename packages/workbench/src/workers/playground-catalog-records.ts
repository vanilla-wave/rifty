/** Persisted catalog schema and projections; no mutation or lifecycle state. */
import {
  inspectPlaygroundRetainedScratchId,
  inspectPlaygroundRetainedScratchRecords,
} from '../workbench/internal/playground-project-catalog.ts';
import type {
  PlaygroundCatalogSnapshot,
  PlaygroundProjectRef,
  PlaygroundRetainedScratch,
} from '../workbench/playground.ts';
import { compareCodeUnits } from './playground-catalog-tree.ts';

export type CatalogAdoption =
  | { readonly kind: 'pending-adoption'; readonly sourceRoot: string }
  | {
      readonly kind: 'adopted';
      readonly definitionIdentity: string;
      readonly baselineFingerprint: string;
      readonly firstMaterialization?: 'pending';
    };

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

export interface StoredCatalog {
  readonly version: 1;
  readonly transactionId?: string;
  readonly active: PlaygroundProjectRef | null;
  readonly scratch: StoredScratch | null;
  readonly projects: readonly StoredProject[];
  readonly retainedScratch?: readonly PlaygroundRetainedScratch[];
}

function ownKeys(value: object): readonly string[] {
  return Object.keys(value).sort(compareCodeUnits);
}

export function exactObject(
  value: unknown,
  expected: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const actual = ownKeys(record);
  const wanted = [...expected].sort(compareCodeUnits);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} has invalid keys`);
  }
  return record;
}

export function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError(`${label} must be a non-empty NUL-free string`);
  }
  return value;
}

export function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

export function validateStageId(value: string): string {
  try {
    return inspectPlaygroundRetainedScratchId(value);
  } catch {
    throw new TypeError('Playground migration stage id must be an alphanumeric token');
  }
}

function parseAdoption(value: unknown, label: string): CatalogAdoption {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const kind = (value as Readonly<Record<string, unknown>>).kind;
  if (kind === 'pending-adoption') {
    const record = exactObject(value, ['kind', 'sourceRoot'], label);
    return Object.freeze({
      kind,
      sourceRoot: nonEmpty(record.sourceRoot, `${label}.sourceRoot`),
    });
  }
  if (kind === 'adopted') {
    const record = exactObject(
      value,
      [
        'kind',
        'definitionIdentity',
        'baselineFingerprint',
        ...(Object.hasOwn(value, 'firstMaterialization') ? ['firstMaterialization'] : []),
      ],
      label,
    );
    if (
      Object.hasOwn(record, 'firstMaterialization') &&
      record.firstMaterialization !== 'pending'
    ) {
      throw new TypeError(`${label}.firstMaterialization is invalid`);
    }
    return Object.freeze({
      kind,
      definitionIdentity: nonEmpty(record.definitionIdentity, `${label}.definitionIdentity`),
      baselineFingerprint: nonEmpty(record.baselineFingerprint, `${label}.baselineFingerprint`),
      ...(record.firstMaterialization === 'pending'
        ? { firstMaterialization: 'pending' as const }
        : {}),
    });
  }
  throw new TypeError(`${label}.kind is invalid`);
}

function parseActive(value: unknown, label: string): PlaygroundProjectRef | null {
  if (value === null) return null;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
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

export function parseStoredCatalog(value: unknown): StoredCatalog {
  const catalog = exactObject(
    value,
    [
      'version',
      'active',
      'scratch',
      'projects',
      ...(value !== null && typeof value === 'object' && Object.hasOwn(value, 'retainedScratch')
        ? ['retainedScratch']
        : []),
      ...(value !== null && typeof value === 'object' && Object.hasOwn(value, 'transactionId')
        ? ['transactionId']
        : []),
    ],
    'catalog',
  );
  if (catalog.version !== 1) throw new TypeError('catalog.version must be 1');
  const active = parseActive(catalog.active, 'catalog.active');
  let scratch: StoredScratch | null = null;
  if (catalog.scratch !== null) {
    const value = exactObject(
      catalog.scratch,
      ['starterId', 'dirty', 'editedAt', 'adoption'],
      'catalog.scratch',
    );
    scratch = Object.freeze({
      starterId: nonEmpty(value.starterId, 'catalog.scratch.starterId'),
      dirty: booleanValue(value.dirty, 'catalog.scratch.dirty'),
      editedAt: nonEmpty(value.editedAt, 'catalog.scratch.editedAt'),
      adoption: parseAdoption(value.adoption, 'catalog.scratch.adoption'),
    });
  }
  if (!Array.isArray(catalog.projects)) throw new TypeError('catalog.projects must be an array');
  const ids = new Set<string>();
  const projects = catalog.projects.map((entry, index): StoredProject => {
    const value = exactObject(
      entry,
      ['id', 'name', 'starterId', 'editedAt', 'adoption'],
      `catalog.projects[${String(index)}]`,
    );
    const id = nonEmpty(value.id, `catalog.projects[${String(index)}].id`);
    if (id === 'scratch' || ids.has(id))
      throw new TypeError(`catalog project id is invalid: ${id}`);
    ids.add(id);
    return Object.freeze({
      id,
      name: nonEmpty(value.name, `catalog.projects[${String(index)}].name`),
      starterId: nonEmpty(value.starterId, `catalog.projects[${String(index)}].starterId`),
      editedAt: nonEmpty(value.editedAt, `catalog.projects[${String(index)}].editedAt`),
      adoption: parseAdoption(value.adoption, `catalog.projects[${String(index)}].adoption`),
    });
  });
  if (active?.kind === 'scratch' && scratch === null) {
    throw new TypeError('catalog active Scratch is absent');
  }
  if (active?.kind === 'project' && !ids.has(active.id)) {
    throw new TypeError(`catalog active project is absent: ${active.id}`);
  }
  return Object.freeze({
    version: 1,
    active,
    scratch,
    projects: Object.freeze(projects),
    ...(Object.hasOwn(catalog, 'retainedScratch')
      ? { retainedScratch: inspectPlaygroundRetainedScratchRecords(catalog.retainedScratch) }
      : {}),
    ...(Object.hasOwn(catalog, 'transactionId')
      ? { transactionId: validateStageId(nonEmpty(catalog.transactionId, 'catalog.transactionId')) }
      : {}),
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

/** A retention journal can own only one new retained root, never a runnable project. */
export function assertRetainedScratchTransition(
  before: StoredCatalog | null,
  after: StoredCatalog,
  id: string,
  txId: string,
): void {
  const prior = before ?? emptyCatalog();
  const records = prior.retainedScratch ?? [];
  if (
    prior.scratch !== null ||
    after.scratch !== null ||
    after.transactionId !== txId ||
    records.some((record) => record.id === id) ||
    JSON.stringify(after.active) !== JSON.stringify(prior.active) ||
    JSON.stringify(after.projects) !== JSON.stringify(prior.projects) ||
    JSON.stringify(after.retainedScratch) !== JSON.stringify([...records, { id }])
  )
    throw new TypeError('Retained Scratch transaction disagrees with its catalog ownership');
}
