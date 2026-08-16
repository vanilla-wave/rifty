import type { PtyPreview, PtyPreviewReq } from '../glue/pty-protocol.ts';
import type { OwnerStorageSnapshot } from '../workers/owner-storage.ts';
import type { SerializedWorkbenchOwnerError } from './errors.ts';
import {
  absoluteHttpUrl,
  copyStringMap,
  exact,
  exactMatch,
  invalid,
  nonEmptyString,
  optionalKeys,
  own,
  port,
  positiveFinite,
  progressCount,
  record,
  string,
} from './owner-protocol-inspect.ts';
import {
  type OwnerProjectPtyFrame,
  type PageProjectPtyFrame,
  inspectOwnerPtyFrame,
  inspectPagePtyFrame,
} from './owner-protocol-pty.ts';
import {
  type ProjectDefinitionWire,
  inspectProjectDefinitionWire,
  projectDefinitionWire,
} from './project-definition.ts';
import {
  type OwnerProjectVfsFrame,
  type PageProjectVfsFrame,
  inspectOwnerProjectVfsFrame,
  inspectPageProjectVfsFrame,
} from './project-vfs-protocol.ts';

declare const ownerProjectTokenBrand: unique symbol;

/** Owner-minted lifecycle correlation; not auth, never host/env configuration. */
export type OwnerProjectToken = string & { readonly [ownerProjectTokenBrand]: true };

/** Clone-safe owner boot input; the physical owner script URL/SW stay page-side. */
export interface WorkbenchOwnerBootConfig {
  readonly deployment: {
    readonly workers: {
      readonly kernel: string;
      readonly node: string;
      readonly devServer: string;
      readonly typescript?: string;
    };
    readonly wasm: { readonly sqlite: string };
    readonly previewProbeTimeoutMs: number;
  };
  readonly packageAcquisition: {
    readonly registryUrl: string;
    readonly eddy?: {
      readonly resolverUrl: string;
      readonly bundleBaseUrl: string;
      readonly presetPins: Readonly<Record<string, string>>;
    };
  };
  readonly storage: { readonly persistence: 'required' | 'preferred' | 'ephemeral' };
  readonly legacyWorkspacePrefix?: string;
  readonly playgroundUrlContext?: {
    readonly apiBaseUrl: string;
    readonly clientUrl: string;
  };
}

export type PageToWorkbenchOwnerMessage =
  | { readonly type: 'workbench:initialize'; readonly config: WorkbenchOwnerBootConfig }
  | {
      readonly type: 'workbench:open-project';
      readonly opId: string;
      readonly definition: ProjectDefinitionWire;
    }
  | {
      readonly type: 'workbench:project-pty';
      readonly projectToken: OwnerProjectToken;
      readonly frame: PageProjectPtyFrame;
    }
  | {
      readonly type: 'workbench:project-preview';
      readonly projectToken: OwnerProjectToken;
      readonly frame: PtyPreviewReq;
    }
  | {
      readonly type: 'workbench:project-vfs';
      readonly projectToken: OwnerProjectToken;
      readonly frame: PageProjectVfsFrame;
    }
  | {
      readonly type: 'workbench:close-project';
      readonly opId: string;
      readonly projectToken: OwnerProjectToken;
    }
  | { readonly type: 'workbench:delete-project'; readonly opId: string; readonly id: string }
  | { readonly type: 'workbench:shutdown' };

export type WorkbenchOwnerFailure =
  | {
      readonly type: 'workbench:failure';
      readonly opId: string;
      readonly error: SerializedWorkbenchOwnerError;
    }
  | {
      readonly type: 'workbench:failure';
      readonly error: SerializedWorkbenchOwnerError;
    };

export type WorkbenchOwnerToPageMessage =
  | { readonly type: 'workbench:owner-ready'; readonly storage: OwnerStorageSnapshot }
  | {
      readonly type: 'workbench:project-opened';
      readonly opId: string;
      readonly projectToken: OwnerProjectToken;
      /** Owner-born cwd; page must not reproduce the private project layout. */
      readonly projectRoot: string;
    }
  | {
      readonly type: 'workbench:project-pty';
      readonly projectToken: OwnerProjectToken;
      readonly frame: OwnerProjectPtyFrame;
    }
  | {
      readonly type: 'workbench:project-preview';
      readonly projectToken: OwnerProjectToken;
      readonly frame: PtyPreview;
    }
  | {
      readonly type: 'workbench:project-vfs';
      readonly projectToken: OwnerProjectToken;
      readonly frame: OwnerProjectVfsFrame;
    }
  | {
      readonly type: 'workbench:project-closed';
      readonly opId: string;
      readonly projectToken: OwnerProjectToken;
    }
  | { readonly type: 'workbench:project-deleted'; readonly opId: string; readonly id: string }
  /** ADR-0359 (corrected 2026-08-16): owner-LEVEL drain progress — durability
   * is owner-scoped and the first-open drain predates any project token. */
  | {
      readonly type: 'workbench:durability-progress';
      readonly persisted: number;
      readonly total: number;
    }
  | WorkbenchOwnerFailure;

export function createOwnerProjectToken(generate: () => string): OwnerProjectToken {
  return ownerProjectToken(generate());
}

export function inspectPageToWorkbenchOwnerMessage(value: unknown): PageToWorkbenchOwnerMessage {
  const message = record(value, 'page-to-owner message');
  switch (message.type) {
    case 'workbench:initialize': {
      exact(message, ['type', 'config'], 'initialize message');
      return Object.freeze({ type: message.type, config: inspectBootConfig(message.config) });
    }
    case 'workbench:open-project': {
      exact(message, ['type', 'opId', 'definition'], 'open-project message');
      const opId = nonEmptyString(message.opId, 'open-project opId');
      const definition = projectDefinitionWire(inspectProjectDefinitionWire(message.definition));
      return Object.freeze({ type: message.type, opId, definition });
    }
    case 'workbench:project-pty': {
      exact(message, ['type', 'projectToken', 'frame'], 'project-pty message');
      return Object.freeze({
        type: message.type,
        projectToken: ownerProjectToken(message.projectToken),
        frame: inspectPagePtyFrame(message.frame),
      });
    }
    case 'workbench:project-preview': {
      exact(message, ['type', 'projectToken', 'frame'], 'project-preview request');
      return Object.freeze({
        type: message.type,
        projectToken: ownerProjectToken(message.projectToken),
        frame: inspectPreviewRequest(message.frame),
      });
    }
    case 'workbench:project-vfs': {
      exact(message, ['type', 'projectToken', 'frame'], 'project-vfs message');
      return Object.freeze({
        type: message.type,
        projectToken: ownerProjectToken(message.projectToken),
        frame: inspectPageProjectVfsFrame(message.frame),
      });
    }
    case 'workbench:close-project': {
      exact(message, ['type', 'opId', 'projectToken'], 'close-project message');
      return Object.freeze({
        type: message.type,
        opId: nonEmptyString(message.opId, 'close-project opId'),
        projectToken: ownerProjectToken(message.projectToken),
      });
    }
    case 'workbench:delete-project': {
      exact(message, ['type', 'opId', 'id'], 'delete-project message');
      return Object.freeze({
        type: message.type,
        opId: nonEmptyString(message.opId, 'delete-project opId'),
        id: nonEmptyString(message.id, 'delete-project id'),
      });
    }
    case 'workbench:shutdown':
      exact(message, ['type'], 'shutdown message');
      return Object.freeze({ type: message.type });
    default:
      throw invalid('page-to-owner message');
  }
}

function inspectBootConfig(value: unknown): WorkbenchOwnerBootConfig {
  const config = record(value, 'owner boot config');
  exact(
    config,
    optionalKeys(
      config,
      ['deployment', 'packageAcquisition', 'storage'],
      ['legacyWorkspacePrefix', 'playgroundUrlContext'],
    ),
    'owner boot config',
  );

  const deployment = record(config.deployment, 'owner boot deployment');
  exact(deployment, ['workers', 'wasm', 'previewProbeTimeoutMs'], 'owner boot deployment');
  const workers = record(deployment.workers, 'owner boot workers');
  exact(
    workers,
    optionalKeys(workers, ['kernel', 'node', 'devServer'], ['typescript']),
    'owner boot workers',
  );
  const wasm = record(deployment.wasm, 'owner boot wasm');
  exact(wasm, ['sqlite'], 'owner boot wasm');
  const previewProbeTimeoutMs = positiveFinite(
    deployment.previewProbeTimeoutMs,
    'owner boot preview proof timeout',
  );

  const packageAcquisition = record(config.packageAcquisition, 'owner boot package acquisition');
  exact(
    packageAcquisition,
    optionalKeys(packageAcquisition, ['registryUrl'], ['eddy']),
    'owner boot package acquisition',
  );
  let eddy: WorkbenchOwnerBootConfig['packageAcquisition']['eddy'];
  if (own(packageAcquisition, 'eddy')) {
    const candidate = record(packageAcquisition.eddy, 'owner boot Eddy config');
    exact(candidate, ['resolverUrl', 'bundleBaseUrl', 'presetPins'], 'owner boot Eddy config');
    eddy = Object.freeze({
      resolverUrl: nonEmptyString(candidate.resolverUrl, 'owner boot Eddy resolverUrl'),
      bundleBaseUrl: nonEmptyString(candidate.bundleBaseUrl, 'owner boot Eddy bundleBaseUrl'),
      presetPins: copyStringMap(candidate.presetPins, 'owner boot Eddy presetPins'),
    });
  }

  const storage = record(config.storage, 'owner boot storage policy');
  exact(storage, ['persistence'], 'owner boot storage policy');
  if (
    storage.persistence !== 'required' &&
    storage.persistence !== 'preferred' &&
    storage.persistence !== 'ephemeral'
  ) {
    throw invalid('owner boot storage policy');
  }

  const frozenDeployment = Object.freeze({
    workers: Object.freeze({
      kernel: nonEmptyString(workers.kernel, 'owner boot kernel worker'),
      node: nonEmptyString(workers.node, 'owner boot node worker'),
      devServer: nonEmptyString(workers.devServer, 'owner boot dev-server worker'),
      ...(own(workers, 'typescript')
        ? { typescript: nonEmptyString(workers.typescript, 'owner boot TypeScript worker') }
        : {}),
    }),
    wasm: Object.freeze({
      sqlite: nonEmptyString(wasm.sqlite, 'owner boot sqlite wasm'),
    }),
    previewProbeTimeoutMs,
  });
  const frozenAcquisition = Object.freeze({
    registryUrl: nonEmptyString(packageAcquisition.registryUrl, 'owner boot registryUrl'),
    ...(eddy === undefined ? {} : { eddy }),
  });
  let legacyWorkspacePrefix: string | undefined;
  if (own(config, 'legacyWorkspacePrefix')) {
    const candidate = nonEmptyString(
      config.legacyWorkspacePrefix,
      'owner boot legacy workspace prefix',
    );
    if (!/^\/workspaces\/[A-Za-z0-9._-]+$/.test(candidate)) {
      throw invalid('owner boot legacy workspace prefix');
    }
    legacyWorkspacePrefix = candidate;
  }
  let playgroundUrlContext: WorkbenchOwnerBootConfig['playgroundUrlContext'];
  if (own(config, 'playgroundUrlContext')) {
    const context = record(config.playgroundUrlContext, 'owner boot Playground URL context');
    exact(context, ['apiBaseUrl', 'clientUrl'], 'owner boot Playground URL context');
    const apiBaseUrl = absoluteHttpUrl(context.apiBaseUrl, 'owner boot Playground API base URL');
    const clientUrl = absoluteHttpUrl(context.clientUrl, 'owner boot Playground client URL');
    playgroundUrlContext = Object.freeze({ apiBaseUrl, clientUrl });
  }
  return Object.freeze({
    deployment: frozenDeployment,
    packageAcquisition: frozenAcquisition,
    storage: Object.freeze({ persistence: storage.persistence }),
    ...(legacyWorkspacePrefix === undefined ? {} : { legacyWorkspacePrefix }),
    ...(playgroundUrlContext === undefined ? {} : { playgroundUrlContext }),
  });
}

export function inspectWorkbenchOwnerToPageMessage(value: unknown): WorkbenchOwnerToPageMessage {
  const message = record(value, 'owner-to-page message');
  switch (message.type) {
    case 'workbench:owner-ready': {
      exact(message, ['type', 'storage'], 'owner-ready message');
      return Object.freeze({ type: message.type, storage: inspectStorage(message.storage) });
    }
    case 'workbench:project-opened': {
      exact(message, ['type', 'opId', 'projectToken', 'projectRoot'], 'project-opened message');
      return Object.freeze({
        type: message.type,
        opId: nonEmptyString(message.opId, 'project-opened opId'),
        projectToken: ownerProjectToken(message.projectToken),
        projectRoot: absoluteProjectRoot(message.projectRoot),
      });
    }
    case 'workbench:project-pty': {
      exact(message, ['type', 'projectToken', 'frame'], 'project-pty message');
      return Object.freeze({
        type: message.type,
        projectToken: ownerProjectToken(message.projectToken),
        frame: inspectOwnerPtyFrame(message.frame),
      });
    }
    case 'workbench:project-preview': {
      exact(message, ['type', 'projectToken', 'frame'], 'project-preview snapshot');
      return Object.freeze({
        type: message.type,
        projectToken: ownerProjectToken(message.projectToken),
        frame: inspectPreviewSnapshot(message.frame),
      });
    }
    case 'workbench:project-vfs': {
      exact(message, ['type', 'projectToken', 'frame'], 'project-vfs message');
      return Object.freeze({
        type: message.type,
        projectToken: ownerProjectToken(message.projectToken),
        frame: inspectOwnerProjectVfsFrame(message.frame),
      });
    }
    case 'workbench:project-closed': {
      exact(message, ['type', 'opId', 'projectToken'], 'project-closed message');
      return Object.freeze({
        type: message.type,
        opId: nonEmptyString(message.opId, 'project-closed opId'),
        projectToken: ownerProjectToken(message.projectToken),
      });
    }
    case 'workbench:project-deleted': {
      exact(message, ['type', 'opId', 'id'], 'project-deleted message');
      return Object.freeze({
        type: message.type,
        opId: nonEmptyString(message.opId, 'project-deleted opId'),
        id: nonEmptyString(message.id, 'project-deleted id'),
      });
    }
    case 'workbench:durability-progress': {
      exact(message, ['type', 'persisted', 'total'], 'durability-progress message');
      const persisted = progressCount(message.persisted, 'durability-progress persisted');
      const total = progressCount(message.total, 'durability-progress total');
      if (persisted > total) throw invalid('durability-progress counts');
      return Object.freeze({ type: message.type, persisted, total });
    }
    case 'workbench:failure': {
      exact(message, optionalKeys(message, ['type', 'error'], ['opId']), 'failure message');
      const error = inspectSerializedError(message.error);
      if (!own(message, 'opId')) return Object.freeze({ type: message.type, error });
      return Object.freeze({
        type: message.type,
        opId: nonEmptyString(message.opId, 'failure opId'),
        error,
      });
    }
    default:
      throw invalid('owner-to-page message');
  }
}

function inspectPreviewRequest(value: unknown): PtyPreviewReq {
  const frame = record(value, 'preview request frame');
  exact(frame, ['type'], 'preview request frame');
  if (frame.type !== 'pty:preview-req') throw invalid('preview request frame');
  return Object.freeze({ type: frame.type });
}

function inspectPreviewSnapshot(value: unknown): PtyPreview {
  const frame = record(value, 'preview snapshot frame');
  exact(frame, ['type', 'ports'], 'preview snapshot frame');
  if (frame.type !== 'pty:preview' || !Array.isArray(frame.ports)) {
    throw invalid('preview snapshot frame');
  }
  const ports = frame.ports.map(inspectPreviewEntry);
  return Object.freeze({ type: frame.type, ports });
}

function inspectPreviewEntry(value: unknown) {
  const entry = record(value, 'preview entry');
  const hasPtySid = own(entry, 'ptySid');
  const hasPtyRid = own(entry, 'ptyRid');
  if (hasPtySid !== hasPtyRid) throw invalid('preview PTY provenance');
  const keys = optionalKeys(
    entry,
    ['port', 'url', 'label', 'source', 'sid'],
    ['previewScope', 'ptySid', 'ptyRid'],
  );
  exact(entry, keys, 'preview entry');
  port(entry.port, 'preview port');
  nonEmptyString(entry.url, 'preview url');
  nonEmptyString(entry.label, 'preview label');
  if (entry.source !== 'dev-server' && entry.source !== 'preview' && entry.source !== 'node') {
    throw invalid('preview source');
  }
  nonEmptyString(entry.sid, 'preview sid');
  if (own(entry, 'previewScope')) {
    nonEmptyString(entry.previewScope, 'preview scope');
  }
  if (hasPtySid) {
    nonEmptyString(entry.ptySid, 'preview ptySid');
    nonEmptyString(entry.ptyRid, 'preview ptyRid');
  }
  return Object.freeze(entry) as unknown as PtyPreview['ports'][number];
}

function inspectStorage(value: unknown): OwnerStorageSnapshot {
  const storage = record(value, 'owner storage snapshot');
  if (
    exactMatch(storage, ['policy', 'backend', 'durability']) &&
    storage.policy === 'required' &&
    storage.backend === 'opfs' &&
    storage.durability === 'durable'
  ) {
    return Object.freeze({
      policy: storage.policy,
      backend: storage.backend,
      durability: storage.durability,
    });
  }
  if (
    exactMatch(storage, ['policy', 'backend', 'durability']) &&
    storage.policy === 'preferred' &&
    storage.backend === 'opfs' &&
    storage.durability === 'durable'
  ) {
    return Object.freeze({
      policy: storage.policy,
      backend: storage.backend,
      durability: storage.durability,
    });
  }
  if (
    exactMatch(storage, ['policy', 'backend', 'durability']) &&
    storage.policy === 'ephemeral' &&
    storage.backend === 'memory' &&
    storage.durability === 'ephemeral'
  ) {
    return Object.freeze({
      policy: storage.policy,
      backend: storage.backend,
      durability: storage.durability,
    });
  }
  if (
    exactMatch(storage, ['policy', 'backend', 'durability', 'fallback']) &&
    storage.policy === 'preferred' &&
    storage.backend === 'memory' &&
    storage.durability === 'ephemeral'
  ) {
    const fallback = record(storage.fallback, 'owner storage fallback');
    exact(fallback, ['reason'], 'owner storage fallback');
    return Object.freeze({
      policy: storage.policy,
      backend: storage.backend,
      durability: storage.durability,
      fallback: Object.freeze({ reason: string(fallback.reason, 'owner storage fallback reason') }),
    });
  }
  throw invalid('owner storage snapshot');
}

function inspectSerializedError(value: unknown): WorkbenchOwnerFailure['error'] {
  const error = record(value, 'serialized owner error');
  exact(error, ['name', 'message'], 'serialized owner error');
  return Object.freeze({
    name: nonEmptyString(error.name, 'serialized owner error name'),
    message: string(error.message, 'serialized owner error message'),
  });
}

function ownerProjectToken(value: unknown): OwnerProjectToken {
  return nonEmptyString(value, 'owner project token') as OwnerProjectToken;
}

function absoluteProjectRoot(value: unknown): string {
  const root = nonEmptyString(value, 'owner project root');
  if (!root.startsWith('/') || root === '/' || root.includes('\0')) {
    throw invalid('owner project root');
  }
  const segments = root.slice(1).split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw invalid('owner project root');
  }
  return root;
}
