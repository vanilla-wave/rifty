import type { PlaygroundProjectAuthority } from '../../workers/playground-project-authority.ts';
import type {
  PlaygroundCatalogSnapshot,
  PlaygroundProjectCatalog,
  PlaygroundProjectRef,
} from '../playground.ts';

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    throw new TypeError(`${label} has invalid keys`);
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      throw new TypeError(`${label}.${key} must be an enumerable data property`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function densePlainArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be a plain array`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    lengthDescriptor.enumerable !== false ||
    lengthDescriptor.get !== undefined ||
    lengthDescriptor.set !== undefined ||
    !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new TypeError(`${label}.length is invalid`);
  }
  const length = lengthDescriptor.value as number;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1 || ownKeys.some((key) => typeof key !== 'string')) {
    throw new TypeError(`${label} must be dense and have no extra keys`);
  }
  const entries: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      throw new TypeError(`${label}[${String(index)}] must be an enumerable data property`);
    }
    entries.push(descriptor.value);
  }
  return entries;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError(`${label} must be a non-empty NUL-free string`);
  }
  return value;
}

function activeRef(value: unknown): PlaygroundProjectRef | null {
  if (value === null) return null;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('catalog.active must be null or an object');
  }
  const kind = Object.getOwnPropertyDescriptor(value, 'kind')?.value;
  if (kind === 'scratch') {
    exactRecord(value, ['kind'], 'catalog.active');
    return Object.freeze({ kind });
  }
  if (kind === 'project') {
    const record = exactRecord(value, ['kind', 'id'], 'catalog.active');
    return Object.freeze({ kind, id: nonEmpty(record.id, 'catalog.active.id') });
  }
  throw new TypeError('catalog.active.kind is invalid');
}

/** Exact clone-safe page ingress for owner catalog replay/update values. */
export function inspectPlaygroundCatalogSnapshot(value: unknown): PlaygroundCatalogSnapshot {
  const record = exactRecord(value, ['active', 'scratch', 'projects'], 'catalog');
  const active = activeRef(record.active);
  let scratch: PlaygroundCatalogSnapshot['scratch'] = null;
  if (record.scratch !== null) {
    const candidate = exactRecord(
      record.scratch,
      ['starterId', 'dirty', 'editedAt'],
      'catalog.scratch',
    );
    if (typeof candidate.dirty !== 'boolean') {
      throw new TypeError('catalog.scratch.dirty must be boolean');
    }
    scratch = Object.freeze({
      starterId: nonEmpty(candidate.starterId, 'catalog.scratch.starterId'),
      dirty: candidate.dirty,
      editedAt: nonEmpty(candidate.editedAt, 'catalog.scratch.editedAt'),
    });
  }
  const projects = densePlainArray(record.projects, 'catalog.projects').map((entry, index) => {
    const candidate = exactRecord(
      entry,
      ['id', 'name', 'starterId', 'editedAt'],
      `catalog.projects[${String(index)}]`,
    );
    return Object.freeze({
      id: nonEmpty(candidate.id, `catalog.projects[${String(index)}].id`),
      name: nonEmpty(candidate.name, `catalog.projects[${String(index)}].name`),
      starterId: nonEmpty(candidate.starterId, `catalog.projects[${String(index)}].starterId`),
      editedAt: nonEmpty(candidate.editedAt, `catalog.projects[${String(index)}].editedAt`),
    });
  });
  const ids = new Set(projects.map((project) => project.id));
  if (ids.size !== projects.length || ids.has('scratch')) {
    throw new TypeError('catalog.projects contains a duplicate or reserved id');
  }
  if (active?.kind === 'scratch' && scratch === null) {
    throw new TypeError('catalog active Scratch is absent');
  }
  if (active?.kind === 'project' && !ids.has(active.id)) {
    throw new TypeError('catalog active project is absent');
  }
  return Object.freeze({ active, scratch, projects: Object.freeze(projects) });
}

/** Public semantic view of the owner-resident catalog authority. */
export function createPlaygroundProjectCatalog(
  authority: PlaygroundProjectAuthority,
): PlaygroundProjectCatalog {
  return Object.freeze({
    snapshot: () => authority.catalogSnapshot(),
    subscribe: (listener: Parameters<PlaygroundProjectCatalog['subscribe']>[0]) =>
      authority.subscribeCatalog(listener),
    createScratch: (input: Parameters<PlaygroundProjectCatalog['createScratch']>[0]) =>
      authority.createScratch(input),
    saveScratch: (input: Parameters<PlaygroundProjectCatalog['saveScratch']>[0]) =>
      authority.saveScratch(input),
    activate: (target: Parameters<PlaygroundProjectCatalog['activate']>[0]) =>
      authority.activate(target),
    rename: (...input: Parameters<PlaygroundProjectCatalog['rename']>) =>
      authority.rename(...input),
    reset: (input: Parameters<PlaygroundProjectCatalog['reset']>[0]) => authority.reset(input),
    delete: (id: string) => authority.delete(id),
  });
}
