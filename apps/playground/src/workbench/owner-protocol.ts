import type {
  OwnerToPageFrame,
  PageToOwnerFrame,
  PtyPreview,
  PtyPreviewReq,
} from '../glue/pty-protocol.ts';
import type { OwnerStorageSnapshot } from '../workers/owner-storage.ts';
import {
  type RuntimeAssetCacheInspection,
  type RuntimeAssetFailurePhase,
  type RuntimeAssetProgress,
  type RuntimeAssetRecovery,
  type RuntimeAssetStorageClass,
  type SerializedWorkbenchOwnerError,
  runtimeAssetMessage,
} from './errors.ts';
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
    readonly wasm: { readonly sqlite: string; readonly esbuild: string };
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

type PageProjectPtyFrame = Exclude<PageToOwnerFrame, PtyPreviewReq>;
type OwnerProjectPtyFrame = Exclude<OwnerToPageFrame, PtyPreview>;

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
  | { readonly type: 'workbench:runtime-assets-inspect'; readonly opId: string }
  | { readonly type: 'workbench:runtime-assets-clear'; readonly opId: string }
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
  | {
      readonly type: 'workbench:runtime-assets-progress';
      readonly opId: string;
      readonly progress: RuntimeAssetProgress;
    }
  | {
      readonly type: 'workbench:runtime-assets-inspected';
      readonly opId: string;
      readonly inspection: RuntimeAssetCacheInspection;
    }
  | {
      readonly type: 'workbench:runtime-assets-cleared';
      readonly opId: string;
      readonly inspection: RuntimeAssetCacheInspection;
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
    case 'workbench:runtime-assets-inspect':
    case 'workbench:runtime-assets-clear': {
      exact(message, ['type', 'opId'], `${message.type} message`);
      return Object.freeze({
        type: message.type,
        opId: nonEmptyString(message.opId, `${message.type} opId`),
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
  exact(wasm, ['sqlite', 'esbuild'], 'owner boot wasm');
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
      esbuild: nonEmptyString(wasm.esbuild, 'owner boot esbuild wasm'),
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
    case 'workbench:runtime-assets-progress': {
      exactDataProperties(message, ['type', 'opId', 'progress'], 'runtime-assets-progress message');
      return Object.freeze({
        type: message.type,
        opId: nonEmptyString(message.opId, 'runtime-assets-progress opId'),
        progress: inspectRuntimeAssetProgress(message.progress),
      });
    }
    case 'workbench:runtime-assets-inspected':
    case 'workbench:runtime-assets-cleared': {
      exact(message, ['type', 'opId', 'inspection'], `${message.type} message`);
      const inspection = inspectRuntimeAssetInspection(message.inspection);
      if (
        message.type === 'workbench:runtime-assets-cleared' &&
        (inspection.entryCount !== 0 ||
          inspection.storedBytes !== 0 ||
          inspection.verifiedObjectCount !== 0 ||
          inspection.verifiedObjectBytes !== 0 ||
          inspection.readySetCount !== 0)
      ) {
        throw invalid('runtime-assets-cleared acknowledgement');
      }
      return Object.freeze({
        type: message.type,
        opId: nonEmptyString(message.opId, `${message.type} opId`),
        inspection,
      });
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

function inspectPagePtyFrame(value: unknown): PageProjectPtyFrame {
  const frame = record(value, 'page PTY frame');
  switch (frame.type) {
    case 'pty:open': {
      const keys = optionalKeys(frame, ['type', 'sid'], ['cwd', 'env']);
      exact(frame, keys, 'pty:open frame');
      nonEmptyString(frame.sid, 'pty:open sid');
      if (own(frame, 'cwd')) nonEmptyString(frame.cwd, 'pty:open cwd');
      if (own(frame, 'env')) inspectStringMap(frame.env, 'pty:open env');
      break;
    }
    case 'pty:exec':
      exact(frame, ['type', 'sid', 'rid', 'line', 'cols', 'rows', 'isTTY'], 'pty:exec frame');
      nonEmptyString(frame.sid, 'pty:exec sid');
      nonEmptyString(frame.rid, 'pty:exec rid');
      string(frame.line, 'pty:exec line');
      dimension(frame.cols, 'pty:exec cols');
      dimension(frame.rows, 'pty:exec rows');
      boolean(frame.isTTY, 'pty:exec isTTY');
      break;
    case 'pty:stdin':
      exact(frame, ['type', 'sid', 'rid', 'opId', 'data'], 'pty:stdin frame');
      runOperation(frame, 'pty:stdin');
      bytes(frame.data, 'pty:stdin data');
      break;
    case 'pty:stdin-eof':
      exact(frame, ['type', 'sid', 'rid', 'opId'], 'pty:stdin-eof frame');
      runOperation(frame, 'pty:stdin-eof');
      break;
    case 'pty:signal':
      exact(frame, ['type', 'sid', 'rid', 'signal'], 'pty:signal frame');
      nonEmptyString(frame.sid, 'pty:signal sid');
      nonEmptyString(frame.rid, 'pty:signal rid');
      if (frame.signal !== 'SIGINT') throw invalid('pty:signal signal');
      break;
    case 'pty:resize':
      exact(frame, ['type', 'sid', 'rid', 'opId', 'cols', 'rows'], 'pty:resize frame');
      runOperation(frame, 'pty:resize');
      dimension(frame.cols, 'pty:resize cols');
      dimension(frame.rows, 'pty:resize rows');
      break;
    case 'pty:session-resize':
      exact(frame, ['type', 'sid', 'opId', 'cols', 'rows'], 'pty:session-resize frame');
      sessionOperation(frame, 'pty:session-resize');
      dimension(frame.cols, 'pty:session-resize cols');
      dimension(frame.rows, 'pty:session-resize rows');
      break;
    case 'pty:close':
      exact(frame, ['type', 'sid', 'opId'], 'pty:close frame');
      sessionOperation(frame, 'pty:close');
      break;
    case 'pty:dev-server-req':
      exact(frame, ['type'], 'pty:dev-server-req frame');
      break;
    case 'pty:dev-config':
      exact(frame, ['type', 'id', 'templateId', 'slug', 'setup'], 'pty:dev-config frame');
      nonEmptyString(frame.id, 'pty:dev-config id');
      nonEmptyString(frame.templateId, 'pty:dev-config templateId');
      nonEmptyString(frame.slug, 'pty:dev-config slug');
      if (frame.setup !== 'instant' && frame.setup !== 'from-scratch') {
        throw invalid('pty:dev-config setup');
      }
      break;
    default:
      throw invalid('page PTY frame');
  }
  return Object.freeze(frame) as unknown as PageProjectPtyFrame;
}

function inspectOwnerPtyFrame(value: unknown): OwnerProjectPtyFrame {
  const frame = record(value, 'owner PTY frame');
  switch (frame.type) {
    case 'pty:ready': {
      exact(frame, optionalKeys(frame, ['type', 'sid'], ['error']), 'pty:ready frame');
      nonEmptyString(frame.sid, 'pty:ready sid');
      if (own(frame, 'error')) string(frame.error, 'pty:ready error');
      break;
    }
    case 'pty:run-ready':
      exact(frame, ['type', 'sid', 'rid'], 'pty:run-ready frame');
      nonEmptyString(frame.sid, 'pty:run-ready sid');
      nonEmptyString(frame.rid, 'pty:run-ready rid');
      break;
    case 'pty:chunk':
      exact(frame, ['type', 'sid', 'rid', 'stream', 'seq', 'data'], 'pty:chunk frame');
      nonEmptyString(frame.sid, 'pty:chunk sid');
      nonEmptyString(frame.rid, 'pty:chunk rid');
      if (frame.stream !== 'stdout' && frame.stream !== 'stderr') {
        throw invalid('pty:chunk stream');
      }
      nonNegativeInteger(frame.seq, 'pty:chunk seq');
      bytes(frame.data, 'pty:chunk data');
      break;
    case 'pty:exit': {
      exact(
        frame,
        optionalKeys(frame, ['type', 'sid', 'rid', 'code', 'exit', 'cwd', 'env'], ['error']),
        'pty:exit frame',
      );
      nonEmptyString(frame.sid, 'pty:exit sid');
      nonEmptyString(frame.rid, 'pty:exit rid');
      integer(frame.code, 'pty:exit code');
      inspectProcessExit(frame.exit);
      nonEmptyString(frame.cwd, 'pty:exit cwd');
      inspectStringMap(frame.env, 'pty:exit env');
      if (own(frame, 'error')) string(frame.error, 'pty:exit error');
      break;
    }
    case 'pty:resize-ack':
      inspectAck(frame, ['type', 'sid', 'rid', 'opId'], 'pty:resize-ack');
      nonEmptyString(frame.sid, 'pty:resize-ack sid');
      nonEmptyString(frame.rid, 'pty:resize-ack rid');
      nonEmptyString(frame.opId, 'pty:resize-ack opId');
      break;
    case 'pty:session-resize-ack':
      inspectAck(frame, ['type', 'sid', 'opId'], 'pty:session-resize-ack');
      nonEmptyString(frame.sid, 'pty:session-resize-ack sid');
      nonEmptyString(frame.opId, 'pty:session-resize-ack opId');
      break;
    case 'pty:stdin-ack':
      inspectAck(frame, ['type', 'sid', 'rid', 'opId'], 'pty:stdin-ack');
      nonEmptyString(frame.sid, 'pty:stdin-ack sid');
      nonEmptyString(frame.rid, 'pty:stdin-ack rid');
      nonEmptyString(frame.opId, 'pty:stdin-ack opId');
      break;
    case 'pty:close-ack':
      inspectAck(frame, ['type', 'sid', 'opId'], 'pty:close-ack');
      nonEmptyString(frame.sid, 'pty:close-ack sid');
      nonEmptyString(frame.opId, 'pty:close-ack opId');
      break;
    case 'pty:dev-server':
      inspectDevServer(frame);
      break;
    case 'pty:dev-config-ready':
      exact(frame, optionalKeys(frame, ['type', 'id'], ['error']), 'pty:dev-config-ready frame');
      nonEmptyString(frame.id, 'pty:dev-config-ready id');
      if (own(frame, 'error')) string(frame.error, 'pty:dev-config-ready error');
      break;
    default:
      throw invalid('owner PTY frame');
  }
  return Object.freeze(frame) as unknown as OwnerProjectPtyFrame;
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
  if (error.name === 'RuntimeAssetError') {
    const keys = optionalKeys(
      error,
      ['name', 'code', 'message', 'phase', 'recovery'],
      ['requiredSetDigest', 'assetId', 'usedBytes', 'requiredBytes'],
    );
    exact(error, keys, 'serialized runtime asset error');
    if (error.code !== 'ESHADOWASSET') throw invalid('serialized runtime asset error code');
    const phase = runtimeAssetPhase(error.phase);
    const recovery = runtimeAssetRecovery(error.recovery);
    const message = runtimeAssetMessage(phase);
    if (error.message !== message) throw invalid('serialized runtime asset error message');
    return Object.freeze({
      name: error.name,
      code: error.code,
      message,
      phase,
      recovery,
      ...(own(error, 'requiredSetDigest')
        ? {
            requiredSetDigest: nonEmptyString(
              error.requiredSetDigest,
              'serialized runtime asset requiredSetDigest',
            ),
          }
        : {}),
      ...(own(error, 'assetId')
        ? { assetId: nonEmptyString(error.assetId, 'serialized runtime asset assetId') }
        : {}),
      ...(own(error, 'usedBytes')
        ? { usedBytes: nonNegativeInteger(error.usedBytes, 'serialized runtime asset usedBytes') }
        : {}),
      ...(own(error, 'requiredBytes')
        ? {
            requiredBytes: nonNegativeInteger(
              error.requiredBytes,
              'serialized runtime asset requiredBytes',
            ),
          }
        : {}),
    });
  }
  exact(error, ['name', 'message'], 'serialized owner error');
  return Object.freeze({
    name: nonEmptyString(error.name, 'serialized owner error name'),
    message: string(error.message, 'serialized owner error message'),
  });
}

function inspectRuntimeAssetInspection(value: unknown): RuntimeAssetCacheInspection {
  const inspection = record(value, 'runtime asset cache inspection');
  exact(
    inspection,
    [
      'storageClass',
      'entryCount',
      'storedBytes',
      'verifiedObjectCount',
      'verifiedObjectBytes',
      'readySetCount',
    ],
    'runtime asset cache inspection',
  );
  const storageClass = runtimeAssetStorageClass(inspection.storageClass);
  return Object.freeze({
    storageClass,
    entryCount: nonNegativeInteger(inspection.entryCount, 'runtime asset entryCount'),
    storedBytes: nonNegativeInteger(inspection.storedBytes, 'runtime asset storedBytes'),
    verifiedObjectCount: nonNegativeInteger(
      inspection.verifiedObjectCount,
      'runtime asset verifiedObjectCount',
    ),
    verifiedObjectBytes: nonNegativeInteger(
      inspection.verifiedObjectBytes,
      'runtime asset verifiedObjectBytes',
    ),
    readySetCount: nonNegativeInteger(inspection.readySetCount, 'runtime asset readySetCount'),
  });
}

function inspectRuntimeAssetProgress(value: unknown): RuntimeAssetProgress {
  const progress = record(value, 'runtime asset progress');
  const phase = dataProperty(progress, 'phase', 'runtime asset progress');
  if (phase === 'cache-check' || phase === 'fetch' || phase === 'verify' || phase === 'persist') {
    exactDataProperties(
      progress,
      ['phase', 'assetId', 'assetIndex', 'assetCount'],
      'runtime asset progress',
    );
    const assetCount = positiveInteger(progress.assetCount, 'runtime asset progress assetCount');
    const assetIndex = nonNegativeInteger(progress.assetIndex, 'runtime asset progress assetIndex');
    if (assetIndex >= assetCount) throw invalid('runtime asset progress assetIndex');
    return Object.freeze({
      phase,
      assetId: nonEmptyString(progress.assetId, 'runtime asset progress assetId'),
      assetIndex,
      assetCount,
    });
  }
  if (phase === 'ready') {
    exactDataProperties(
      progress,
      ['phase', 'requiredSetDigest', 'assetCount', 'storageClass'],
      'runtime asset progress',
    );
    const requiredSetDigest = nonEmptyString(
      progress.requiredSetDigest,
      'runtime asset progress requiredSetDigest',
    );
    if (!/^[a-f0-9]{64}$/.test(requiredSetDigest)) {
      throw invalid('runtime asset progress requiredSetDigest');
    }
    return Object.freeze({
      phase,
      requiredSetDigest,
      assetCount: positiveInteger(progress.assetCount, 'runtime asset progress assetCount'),
      storageClass: runtimeAssetStorageClass(progress.storageClass),
    });
  }
  throw invalid('runtime asset progress phase');
}

function runtimeAssetStorageClass(value: unknown): RuntimeAssetStorageClass {
  if (value === 'opfs-persisted' || value === 'opfs-best-effort' || value === 'memory-session') {
    return value;
  }
  throw invalid('runtime asset storage class');
}

function runtimeAssetPhase(value: unknown): RuntimeAssetFailurePhase {
  switch (value) {
    case 'cache-check':
    case 'fetch':
    case 'verify':
    case 'persist':
    case 'ready':
    case 'inspect':
    case 'clear':
    case 'close':
      return value;
    default:
      throw invalid('serialized runtime asset phase');
  }
}

function runtimeAssetRecovery(value: unknown): RuntimeAssetRecovery {
  if (value === 'retry' || value === 'clear-and-retry' || value === 'none') return value;
  throw invalid('serialized runtime asset recovery');
}

function inspectProcessExit(value: unknown): void {
  const exit = record(value, 'physical process exit');
  exact(exit, ['code', 'signal'], 'physical process exit');
  if (exit.code === null && (exit.signal === 'SIGINT' || exit.signal === 'SIGTERM')) return;
  if (exit.signal === null && Number.isSafeInteger(exit.code)) return;
  throw invalid('physical process exit');
}

function inspectDevServer(frame: Record<string, unknown>): void {
  exact(
    frame,
    optionalKeys(frame, ['type', 'status'], ['sid', 'cwd', 'port', 'previewScope', 'url', 'error']),
    'pty:dev-server frame',
  );
  if (frame.status !== 'starting' && frame.status !== 'running' && frame.status !== 'stopped') {
    throw invalid('pty:dev-server status');
  }
  for (const field of ['sid', 'cwd', 'previewScope', 'url'] as const) {
    if (own(frame, field)) nonEmptyString(frame[field], `pty:dev-server ${field}`);
  }
  if (own(frame, 'port')) port(frame.port, 'pty:dev-server port');
  if (own(frame, 'error')) string(frame.error, 'pty:dev-server error');
}

function inspectAck(
  frame: Record<string, unknown>,
  baseKeys: readonly string[],
  label: string,
): void {
  if (frame.ok === true) {
    exact(frame, [...baseKeys, 'ok'], `${label} success frame`);
    return;
  }
  if (frame.ok === false) {
    exact(frame, [...baseKeys, 'ok', 'error'], `${label} failure frame`);
    string(frame.error, `${label} error`);
    return;
  }
  throw invalid(`${label} result`);
}

function runOperation(frame: Record<string, unknown>, label: string): void {
  nonEmptyString(frame.sid, `${label} sid`);
  nonEmptyString(frame.rid, `${label} rid`);
  nonEmptyString(frame.opId, `${label} opId`);
}

function sessionOperation(frame: Record<string, unknown>, label: string): void {
  nonEmptyString(frame.sid, `${label} sid`);
  nonEmptyString(frame.opId, `${label} opId`);
}

function inspectStringMap(value: unknown, label: string): void {
  const map = record(value, label);
  for (const [key, entry] of Object.entries(map)) {
    if (key.length === 0 || typeof entry !== 'string') throw invalid(label);
  }
}

function copyStringMap(value: unknown, label: string): Readonly<Record<string, string>> {
  inspectStringMap(value, label);
  const map = value as Record<string, string>;
  return Object.freeze(Object.fromEntries(Object.entries(map)));
}

function optionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): string[] {
  return [...required, ...optional.filter((key) => own(value, key))];
}

function exact(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (!exactMatch(value, expected)) throw invalid(label);
}

function exactDataProperties(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== 'string' || !expected.includes(key))
  ) {
    throw invalid(label);
  }
  for (const key of expected) dataProperty(value, key, label);
}

function dataProperty(value: Record<string, unknown>, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    descriptor.get !== undefined ||
    descriptor.set !== undefined ||
    !Object.hasOwn(descriptor, 'value')
  ) {
    throw invalid(label);
  }
  return descriptor.value;
}

function exactMatch(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(label);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid(label);
  return value as Record<string, unknown>;
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

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw invalid(label);
  return value;
}

function absoluteHttpUrl(value: unknown, label: string): string {
  const candidate = nonEmptyString(value, label);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw invalid(label);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw invalid(label);
  }
  return url.href;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalid(label);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw invalid(label);
  return value;
}

function bytes(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw invalid(label);
  return value;
}

function dimension(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw invalid(label);
  return value as number;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid(label);
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw invalid(label);
  return value as number;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw invalid(label);
  return value as number;
}

function port(value: unknown, label: string): number {
  const number = dimension(value, label);
  if (number > 65_535) throw invalid(label);
  return number;
}

function positiveFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw invalid(label);
  return value;
}

function invalid(label: string): TypeError {
  return new TypeError(`Invalid ${label}`);
}
