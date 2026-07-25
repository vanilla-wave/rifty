import { isAbsolute, normalizePath } from '@riftydev/vfs';
import type { OwnerProjectToken } from '../owner-protocol.ts';
import type { PlaygroundCatalogSnapshot, PlaygroundProjectRef } from '../playground.ts';
import type {
  ProjectAcquisitionPlan,
  ProjectAcquisitionProvenance,
} from '../project-materialization.ts';
import {
  type ProjectTerminalSnapshot,
  ownProjectTerminalSnapshot,
} from '../project-terminal-state.ts';
import { inspectPlaygroundCatalogSnapshot } from './playground-project-catalog.ts';
import {
  type CapturedPlaygroundUrlContext,
  type InspectedPlaygroundProjectDefinition,
  type PlaygroundProjectDefinitionWire,
  playgroundProjectDefinitionWire,
  recreatePlaygroundProjectDefinition,
} from './playground-project-definition.ts';
import {
  type OwnerPlaygroundSessionToolsFrame,
  type PagePlaygroundSessionToolsFrame,
  inspectOwnerPlaygroundSessionToolsFrame,
  inspectPagePlaygroundSessionToolsFrame,
  inspectPlaygroundScmSnapshot,
} from './playground-session-tools-transport.ts';

export type PlaygroundCatalogCommand =
  | {
      readonly kind: 'create-scratch';
      readonly definition: PlaygroundProjectDefinitionWire;
      readonly preserveDirtySameStarter?: boolean;
    }
  | {
      readonly kind: 'save-scratch';
      readonly id: string;
      readonly name: string;
      readonly definition: PlaygroundProjectDefinitionWire;
    }
  | { readonly kind: 'activate'; readonly target: PlaygroundProjectRef }
  | { readonly kind: 'rename'; readonly id: string; readonly name: string }
  | {
      readonly kind: 'reset';
      readonly target: PlaygroundProjectRef;
      readonly definition: PlaygroundProjectDefinitionWire;
    }
  | { readonly kind: 'delete'; readonly id: string };

export type PageToPlaygroundOwnerMessage =
  | {
      readonly type: 'workbench:playground-open-project';
      readonly opId: string;
      readonly definition: PlaygroundProjectDefinitionWire;
      readonly initialTerminalState?: ProjectTerminalSnapshot;
    }
  | {
      readonly type: 'workbench:playground-catalog';
      readonly opId: string;
      readonly command: PlaygroundCatalogCommand;
    }
  | {
      readonly type: 'workbench:playground-project-tools';
      readonly projectToken: OwnerProjectToken;
      readonly frame: PagePlaygroundSessionToolsFrame;
    };

export type PlaygroundProjectRuntimeDecision =
  | { readonly kind: 'vite'; readonly port: number }
  | { readonly kind: 'node-server' }
  | { readonly kind: 'node-cli' };

/** Concrete runtime projection owned beside its clone-safe protocol shape. */
export function playgroundProjectRuntimeDecision(
  definition: Pick<InspectedPlaygroundProjectDefinition, 'kind' | 'port'>,
): PlaygroundProjectRuntimeDecision {
  if (definition.kind === 'vite') {
    if (definition.port === undefined) {
      throw new TypeError('Playground Vite definition is missing its owner port');
    }
    return Object.freeze({ kind: 'vite', port: definition.port });
  }
  return Object.freeze({ kind: definition.kind });
}

export type PlaygroundOwnerToPageMessage =
  | { readonly type: 'workbench:playground-ready'; readonly catalog: PlaygroundCatalogSnapshot }
  | {
      readonly type: 'workbench:playground-catalog-updated';
      readonly catalog: PlaygroundCatalogSnapshot;
    }
  | { readonly type: 'workbench:playground-catalog-completed'; readonly opId: string }
  | {
      readonly type: 'workbench:playground-project-opened';
      readonly opId: string;
      readonly projectToken: OwnerProjectToken;
      readonly projectRoot: string;
      readonly acquisition: ProjectAcquisitionPlan;
      readonly runtime: PlaygroundProjectRuntimeDecision;
      readonly initialScmSnapshot: ReturnType<typeof inspectPlaygroundScmSnapshot>;
      readonly initialTerminalState?: ProjectTerminalSnapshot;
    }
  | {
      readonly type: 'workbench:playground-project-tools';
      readonly projectToken: OwnerProjectToken;
      readonly frame: OwnerPlaygroundSessionToolsFrame;
    };

const PAGE_TYPES = new Set([
  'workbench:playground-open-project',
  'workbench:playground-catalog',
  'workbench:playground-project-tools',
]);
const OWNER_TYPES = new Set([
  'workbench:playground-ready',
  'workbench:playground-catalog-updated',
  'workbench:playground-catalog-completed',
  'workbench:playground-project-opened',
  'workbench:playground-project-tools',
]);

function typeOf(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.getOwnPropertyDescriptor(value, 'type')?.value;
}

export function isPageToPlaygroundOwnerMessage(value: unknown): boolean {
  const type = typeOf(value);
  return typeof type === 'string' && PAGE_TYPES.has(type);
}

export function isPlaygroundOwnerToPageMessage(value: unknown): boolean {
  const type = typeOf(value);
  return typeof type === 'string' && OWNER_TYPES.has(type);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
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
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${label}.${key} must be an enumerable data property`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function optionalRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const keys = [...required, ...optional.filter((key) => Object.hasOwn(value, key))];
  return exactRecord(value, keys, label);
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError(`${label} must be a non-empty NUL-free string`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function port(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new TypeError('Playground runtime port must be an integer from 1 to 65535');
  }
  return value as number;
}

function projectRoot(value: unknown): string {
  const candidate = nonEmpty(value, 'Playground project root');
  if (!isAbsolute(candidate) || candidate === '/' || normalizePath(candidate) !== candidate) {
    throw new TypeError('Playground project root must be an absolute normalized non-root path');
  }
  return candidate;
}

function definitionWire(
  value: unknown,
  urlContext: CapturedPlaygroundUrlContext,
): PlaygroundProjectDefinitionWire {
  return playgroundProjectDefinitionWire(recreatePlaygroundProjectDefinition(value, urlContext));
}

function projectRef(value: unknown): PlaygroundProjectRef {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Playground project ref must be an object');
  }
  const kind = Object.getOwnPropertyDescriptor(value, 'kind')?.value;
  if (kind === 'scratch') {
    exactRecord(value, ['kind'], 'Playground Scratch ref');
    return Object.freeze({ kind });
  }
  if (kind === 'project') {
    const record = exactRecord(value, ['kind', 'id'], 'Playground project ref');
    return Object.freeze({ kind, id: nonEmpty(record.id, 'Playground project id') });
  }
  throw new TypeError('Playground project ref kind is invalid');
}

function catalogCommand(
  value: unknown,
  urlContext: CapturedPlaygroundUrlContext,
): PlaygroundCatalogCommand {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Playground catalog command must be an object');
  }
  const kind = Object.getOwnPropertyDescriptor(value, 'kind')?.value;
  switch (kind) {
    case 'create-scratch': {
      const command = optionalRecord(
        value,
        ['kind', 'definition'],
        ['preserveDirtySameStarter'],
        'create-scratch command',
      );
      const preserve = command.preserveDirtySameStarter;
      if (preserve !== undefined && typeof preserve !== 'boolean') {
        throw new TypeError('preserveDirtySameStarter must be boolean');
      }
      return Object.freeze({
        kind,
        definition: definitionWire(command.definition, urlContext),
        ...(preserve === undefined ? {} : { preserveDirtySameStarter: preserve }),
      });
    }
    case 'save-scratch': {
      const command = exactRecord(
        value,
        ['kind', 'id', 'name', 'definition'],
        'save-scratch command',
      );
      return Object.freeze({
        kind,
        id: nonEmpty(command.id, 'save-scratch id'),
        name: nonEmpty(command.name, 'save-scratch name'),
        definition: definitionWire(command.definition, urlContext),
      });
    }
    case 'activate': {
      const command = exactRecord(value, ['kind', 'target'], 'activate command');
      return Object.freeze({ kind, target: projectRef(command.target) });
    }
    case 'rename': {
      const command = exactRecord(value, ['kind', 'id', 'name'], 'rename command');
      return Object.freeze({
        kind,
        id: nonEmpty(command.id, 'rename id'),
        name: nonEmpty(command.name, 'rename name'),
      });
    }
    case 'reset': {
      const command = exactRecord(value, ['kind', 'target', 'definition'], 'reset command');
      return Object.freeze({
        kind,
        target: projectRef(command.target),
        definition: definitionWire(command.definition, urlContext),
      });
    }
    case 'delete': {
      const command = exactRecord(value, ['kind', 'id'], 'delete command');
      return Object.freeze({ kind, id: nonEmpty(command.id, 'delete id') });
    }
    default:
      throw new TypeError('Playground catalog command kind is invalid');
  }
}

export function inspectPageToPlaygroundOwnerMessage(
  value: unknown,
  urlContext: CapturedPlaygroundUrlContext,
): PageToPlaygroundOwnerMessage {
  if (!isPageToPlaygroundOwnerMessage(value)) {
    throw new TypeError('Invalid page-to-Playground-owner message');
  }
  const type = typeOf(value);
  if (type === 'workbench:playground-project-tools') {
    const message = exactRecord(
      value,
      ['type', 'projectToken', 'frame'],
      'Playground project-tools message',
    );
    return Object.freeze({
      type,
      projectToken: nonEmpty(
        message.projectToken,
        'Playground project-tools token',
      ) as OwnerProjectToken,
      frame: inspectPagePlaygroundSessionToolsFrame(message.frame),
    });
  }
  if (type === 'workbench:playground-open-project') {
    const message = optionalRecord(
      value,
      ['type', 'opId', 'definition'],
      ['initialTerminalState'],
      'Playground open message',
    );
    const initialTerminalState =
      message.initialTerminalState === undefined
        ? undefined
        : ownProjectTerminalSnapshot(message.initialTerminalState);
    return Object.freeze({
      type,
      opId: nonEmpty(message.opId, 'Playground open opId'),
      definition: definitionWire(message.definition, urlContext),
      ...(initialTerminalState === undefined ? {} : { initialTerminalState }),
    });
  }
  const message = exactRecord(value, ['type', 'opId', 'command'], 'Playground catalog message');
  return Object.freeze({
    type: 'workbench:playground-catalog',
    opId: nonEmpty(message.opId, 'Playground catalog opId'),
    command: catalogCommand(message.command, urlContext),
  });
}

function plainArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be a plain array`);
  }
  const expectedKeys = [...value.keys()].map(String);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length + 1 ||
    !ownKeys.includes('length') ||
    expectedKeys.some((key) => !ownKeys.includes(key))
  ) {
    throw new TypeError(`${label} must be dense`);
  }
  return expectedKeys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new TypeError(`${label}[${key}] must be a data property`);
    }
    return descriptor.value;
  });
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 identity`);
  }
  return value;
}

function provenance(value: unknown): ProjectAcquisitionProvenance {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Playground acquisition provenance must be an object');
  }
  const outcome = Object.getOwnPropertyDescriptor(value, 'outcome')?.value;
  if (outcome === 'existing') {
    const record = exactRecord(value, ['outcome', 'identity', 'packages'], 'existing provenance');
    return Object.freeze({
      outcome,
      identity: nonEmpty(record.identity, 'existing identity'),
      packages: nonNegativeInteger(record.packages, 'existing package count'),
    });
  }
  if (outcome === 'snapshot') {
    const record = exactRecord(
      value,
      ['outcome', 'snapshotId', 'identity', 'packages'],
      'snapshot provenance',
    );
    return Object.freeze({
      outcome,
      snapshotId: sha256(record.snapshotId, 'snapshot provenance id'),
      identity: nonEmpty(record.identity, 'snapshot identity'),
      packages: nonNegativeInteger(record.packages, 'snapshot package count'),
    });
  }
  if (outcome !== 'installed') {
    throw new TypeError('Playground acquisition provenance outcome is invalid');
  }
  const record = optionalRecord(
    value,
    ['outcome', 'resolution', 'packages'],
    ['eddyFallback'],
    'installed provenance',
  );
  if (record.resolution !== 'lockfile' && record.resolution !== 'metadata') {
    throw new TypeError('installed provenance resolution is invalid');
  }
  const packages = plainArray(record.packages, 'installed provenance packages').map(
    (entry, index) => {
      const candidate = exactRecord(
        entry,
        ['name', 'version', 'transport'],
        `installed provenance packages[${String(index)}]`,
      );
      if (
        candidate.transport !== 'cache' &&
        candidate.transport !== 'eddy' &&
        candidate.transport !== 'registry'
      ) {
        throw new TypeError('installed package transport is invalid');
      }
      return Object.freeze({
        name: nonEmpty(candidate.name, 'installed package name'),
        version: nonEmpty(candidate.version, 'installed package version'),
        transport: candidate.transport,
      });
    },
  );
  let eddyFallback: { readonly reason: string } | undefined;
  if (record.eddyFallback !== undefined) {
    const fallback = exactRecord(record.eddyFallback, ['reason'], 'installed Eddy fallback');
    eddyFallback = Object.freeze({ reason: nonEmpty(fallback.reason, 'Eddy fallback reason') });
  }
  return Object.freeze({
    outcome,
    resolution: record.resolution,
    packages: Object.freeze(packages),
    ...(eddyFallback === undefined ? {} : { eddyFallback }),
  });
}

function acquisition(value: unknown): ProjectAcquisitionPlan {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Playground acquisition must be an object');
  }
  const kind = Object.getOwnPropertyDescriptor(value, 'kind')?.value;
  if (kind === 'ready') {
    const record = exactRecord(value, ['kind', 'provenance'], 'ready acquisition');
    return Object.freeze({ kind, provenance: provenance(record.provenance) });
  }
  if (kind === 'install') {
    const record = exactRecord(value, ['kind', 'snapshotFailures'], 'install acquisition');
    const failures = plainArray(record.snapshotFailures, 'snapshot failures').map(
      (entry, index) => {
        const failure = exactRecord(
          entry,
          ['snapshotId', 'reason'],
          `snapshot failure ${String(index)}`,
        );
        return Object.freeze({
          snapshotId: sha256(failure.snapshotId, 'snapshot failure id'),
          reason: nonEmpty(failure.reason, 'snapshot failure reason'),
        });
      },
    );
    return Object.freeze({ kind, snapshotFailures: Object.freeze(failures) });
  }
  throw new TypeError('Playground acquisition kind is invalid');
}

function runtime(value: unknown): PlaygroundProjectRuntimeDecision {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Playground runtime decision must be an object');
  }
  const kind = Object.getOwnPropertyDescriptor(value, 'kind')?.value;
  if (kind === 'vite') {
    const record = exactRecord(value, ['kind', 'port'], 'Vite runtime decision');
    return Object.freeze({ kind, port: port(record.port) });
  }
  if (kind === 'node-server' || kind === 'node-cli') {
    exactRecord(value, ['kind'], 'Node runtime decision');
    return Object.freeze({ kind });
  }
  throw new TypeError('Playground runtime decision kind is invalid');
}

export function inspectPlaygroundOwnerToPageMessage(value: unknown): PlaygroundOwnerToPageMessage {
  if (!isPlaygroundOwnerToPageMessage(value)) {
    throw new TypeError('Invalid Playground-owner-to-page message');
  }
  const type = typeOf(value);
  if (type === 'workbench:playground-ready' || type === 'workbench:playground-catalog-updated') {
    const message = exactRecord(value, ['type', 'catalog'], 'Playground catalog update');
    return Object.freeze({ type, catalog: inspectPlaygroundCatalogSnapshot(message.catalog) });
  }
  if (type === 'workbench:playground-catalog-completed') {
    const message = exactRecord(value, ['type', 'opId'], 'Playground catalog completion');
    return Object.freeze({ type, opId: nonEmpty(message.opId, 'Playground catalog opId') });
  }
  if (type === 'workbench:playground-project-tools') {
    const message = exactRecord(
      value,
      ['type', 'projectToken', 'frame'],
      'Playground project-tools message',
    );
    return Object.freeze({
      type,
      projectToken: nonEmpty(
        message.projectToken,
        'Playground project-tools token',
      ) as OwnerProjectToken,
      frame: inspectOwnerPlaygroundSessionToolsFrame(message.frame),
    });
  }
  const message = optionalRecord(
    value,
    ['type', 'opId', 'projectToken', 'projectRoot', 'acquisition', 'runtime', 'initialScmSnapshot'],
    ['initialTerminalState'],
    'Playground project-opened message',
  );
  const initialTerminalState =
    message.initialTerminalState === undefined
      ? undefined
      : ownProjectTerminalSnapshot(message.initialTerminalState);
  return Object.freeze({
    type: 'workbench:playground-project-opened',
    opId: nonEmpty(message.opId, 'Playground open opId'),
    projectToken: nonEmpty(message.projectToken, 'Playground project token') as OwnerProjectToken,
    projectRoot: projectRoot(message.projectRoot),
    acquisition: acquisition(message.acquisition),
    runtime: runtime(message.runtime),
    initialScmSnapshot: inspectPlaygroundScmSnapshot(message.initialScmSnapshot),
    ...(initialTerminalState === undefined ? {} : { initialTerminalState }),
  });
}
