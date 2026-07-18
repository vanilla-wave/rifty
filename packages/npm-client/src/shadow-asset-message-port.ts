import { sha256Hex } from './canonical-shadow-json.ts';
import type { ShadowAssetDescriptor, ShadowAssetPlan } from './shadow-asset-plan.ts';
import {
  SHADOW_ASSET_MAX_READ_DEADLINE_MS,
  ShadowAssetError,
  type ShadowAssetFailurePhase,
  ShadowAssetInstallError,
  type ShadowAssetProgress,
  ShadowAssetReadError,
  type ShadowAssetReadOptions,
  type ShadowAssetRuntimeReader,
  type ShadowAssetStorageClass,
  ShadowAssetStoreError,
  type ShadowAssetTransportFailure,
  snapshotShadowAssetPlan,
} from './shadow-assets.ts';

export const SHADOW_ASSET_CAPABILITY = 'rifty.shadow-assets.v1';

const SHADOW_ASSET_PROTOCOL = 'rifty.shadow-assets/v1' as const;
const SHA256 = /^[0-9a-f]{64}$/;
const PORT_FAILURE_PHASES = new Set<ShadowAssetPortFailurePhase>([
  'send',
  'receive',
  'decode',
  'deadline',
  'closed',
  'dispose',
]);
const ASSET_FAILURE_PHASES = new Set<ShadowAssetFailurePhase>([
  'cache-check',
  'fetch',
  'verify',
  'persist',
  'ready',
]);
const STORAGE_CLASSES = new Set<ShadowAssetStorageClass>([
  'opfs-persisted',
  'opfs-best-effort',
  'memory-session',
]);

export type ShadowAssetPortFailurePhase =
  | 'send'
  | 'receive'
  | 'decode'
  | 'deadline'
  | 'closed'
  | 'dispose';

export interface ShadowAssetPortFailure {
  readonly message: string;
  readonly phase: ShadowAssetPortFailurePhase;
  readonly assetId?: string;
  readonly cause?: unknown;
}

export class ShadowAssetPortError extends Error {
  readonly code = 'ESHADOWASSETPORT' as const;
  readonly phase: ShadowAssetPortFailurePhase;
  readonly assetId?: string;
  override readonly cause?: unknown;

  constructor(failure: ShadowAssetPortFailure) {
    exactPlainObject(failure, ['message', 'phase'], ['assetId', 'cause'], 'ShadowAssetPortFailure');
    assertNonEmptyString(failure.message, 'ShadowAssetPortFailure.message');
    if (!PORT_FAILURE_PHASES.has(failure.phase)) {
      throw new TypeError('ShadowAssetPortFailure.phase is invalid');
    }
    if (failure.assetId !== undefined) {
      assertNonEmptyString(failure.assetId, 'ShadowAssetPortFailure.assetId');
    }
    super(failure.message);
    this.name = 'ShadowAssetPortError';
    this.phase = failure.phase;
    this.assetId = failure.assetId;
    this.cause = failure.cause;
  }
}

export interface ShadowAssetPortServer {
  dispose(): Promise<void>;
}

export interface ShadowAssetPortClient extends ShadowAssetRuntimeReader {
  dispose(): Promise<void>;
}

interface ShadowAssetCauseEnvelope {
  readonly name: string;
  readonly code?: string;
  readonly message: string;
}

type ShadowAssetPortErrorEnvelope =
  | Readonly<{
      name: 'ShadowAssetError';
      code: 'ESHADOWASSET';
      message: string;
      requiredSetDigest: string;
      assetId?: string;
      phase: ShadowAssetFailurePhase;
      transports: readonly ShadowAssetTransportFailure[];
      recovery: 'retry' | 'clear-and-retry' | 'none';
      usedBytes?: number;
      requiredBytes?: number;
      cause?: ShadowAssetCauseEnvelope;
    }>
  | Readonly<{
      name: 'ShadowAssetReadError';
      code: 'ESHADOWASSETREAD';
      message: string;
      assetId: string;
      reason: 'unknown-asset';
      cause?: ShadowAssetCauseEnvelope;
    }>
  | Readonly<{
      name: 'ShadowAssetPortError';
      code: 'ESHADOWASSETPORT';
      message: string;
      phase: ShadowAssetPortFailurePhase;
      assetId?: string;
      cause?: ShadowAssetCauseEnvelope;
    }>;

interface ReadFrame {
  readonly protocol: typeof SHADOW_ASSET_PROTOCOL;
  readonly type: 'read';
  readonly requestId: number;
  readonly assetId: string;
  readonly deadlineMs: number;
}

interface ProgressFrame {
  readonly protocol: typeof SHADOW_ASSET_PROTOCOL;
  readonly type: 'progress';
  readonly requestId: number;
  readonly progress: ShadowAssetProgress;
}

interface ResultFrame {
  readonly protocol: typeof SHADOW_ASSET_PROTOCOL;
  readonly type: 'result';
  readonly requestId: number;
  readonly assetId: string;
  readonly sha256: string;
  readonly bytes: ArrayBuffer;
}

interface ErrorFrame {
  readonly protocol: typeof SHADOW_ASSET_PROTOCOL;
  readonly type: 'error';
  readonly requestId: number;
  readonly error: ShadowAssetPortErrorEnvelope;
}

interface CancelFrame {
  readonly protocol: typeof SHADOW_ASSET_PROTOCOL;
  readonly type: 'cancel';
  readonly requestId: number;
}

interface DisposeFrame {
  readonly protocol: typeof SHADOW_ASSET_PROTOCOL;
  readonly type: 'dispose';
}

type DataDescriptors = Record<string, PropertyDescriptor>;

function plainObjectDescriptors(value: unknown, label: string): DataDescriptors {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} has symbol keys`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${key} must be an enumerable data property`);
    }
  }
  return descriptors;
}

function exactPlainObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  const descriptors = plainObjectDescriptors(value, label);
  const actual = Object.keys(descriptors).sort();
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in descriptors)) throw new TypeError(`${label} is missing ${key}`);
  }
  for (const key of actual) {
    if (!allowed.has(key)) throw new TypeError(`${label} has unexpected ${key}`);
  }
}

function frameDiscriminator(value: unknown): unknown {
  const descriptors = plainObjectDescriptors(value, 'shadow asset frame');
  const descriptor = descriptors.type;
  if (!descriptor || !('value' in descriptor)) {
    throw new TypeError('shadow asset frame is missing type');
  }
  return descriptor.value;
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new TypeError(`${label} must be a lowercase sha256`);
  }
}

function assertRequestId(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError('shadow asset requestId must be a positive safe integer');
  }
}

function assertDeadline(value: unknown): asserts value is number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > SHADOW_ASSET_MAX_READ_DEADLINE_MS
  ) {
    throw new TypeError(
      `deadlineMs must be a positive safe integer <= ${SHADOW_ASSET_MAX_READ_DEADLINE_MS}`,
    );
  }
}

function assertOptionalNonNegativeInteger(value: unknown, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0)) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function assertPort(value: unknown): asserts value is MessagePort {
  if (typeof MessagePort === 'undefined' || !(value instanceof MessagePort)) {
    throw new TypeError('shadow asset port must be a MessagePort');
  }
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

function decodeReadFrame(value: unknown): ReadFrame {
  exactPlainObject(
    value,
    ['assetId', 'deadlineMs', 'protocol', 'requestId', 'type'],
    [],
    'shadow asset read frame',
  );
  if (value.protocol !== SHADOW_ASSET_PROTOCOL || value.type !== 'read') {
    throw new TypeError('invalid shadow asset read protocol');
  }
  assertRequestId(value.requestId);
  assertNonEmptyString(value.assetId, 'shadow asset read assetId');
  assertDeadline(value.deadlineMs);
  return {
    protocol: SHADOW_ASSET_PROTOCOL,
    type: 'read',
    requestId: value.requestId,
    assetId: value.assetId,
    deadlineMs: value.deadlineMs,
  };
}

function decodeCancelFrame(value: unknown): CancelFrame {
  exactPlainObject(value, ['protocol', 'requestId', 'type'], [], 'shadow asset cancel frame');
  if (value.protocol !== SHADOW_ASSET_PROTOCOL || value.type !== 'cancel') {
    throw new TypeError('invalid shadow asset cancel protocol');
  }
  assertRequestId(value.requestId);
  return { protocol: SHADOW_ASSET_PROTOCOL, type: 'cancel', requestId: value.requestId };
}

function decodeDisposeFrame(value: unknown): DisposeFrame {
  exactPlainObject(value, ['protocol', 'type'], [], 'shadow asset dispose frame');
  if (value.protocol !== SHADOW_ASSET_PROTOCOL || value.type !== 'dispose') {
    throw new TypeError('invalid shadow asset dispose protocol');
  }
  return { protocol: SHADOW_ASSET_PROTOCOL, type: 'dispose' };
}

function decodeTerminalHeader(
  value: unknown,
  type: 'result' | 'error',
): Readonly<{ requestId: number; record: Record<string, unknown> }> {
  exactPlainObject(
    value,
    type === 'result'
      ? ['assetId', 'bytes', 'protocol', 'requestId', 'sha256', 'type']
      : ['error', 'protocol', 'requestId', 'type'],
    [],
    `shadow asset ${type} frame`,
  );
  if (value.protocol !== SHADOW_ASSET_PROTOCOL || value.type !== type) {
    throw new TypeError(`invalid shadow asset ${type} protocol`);
  }
  assertRequestId(value.requestId);
  return { requestId: value.requestId, record: value };
}

function snapshotProgress(value: unknown, plan: ShadowAssetPlan): ShadowAssetProgress {
  exactPlainObject(
    value,
    ['assetCount', 'phase'],
    ['assetId', 'assetIndex', 'requiredSetDigest', 'storageClass'],
    'shadow asset progress',
  );
  if (value.phase === 'ready') {
    exactPlainObject(
      value,
      ['assetCount', 'phase', 'requiredSetDigest', 'storageClass'],
      [],
      'shadow asset ready progress',
    );
    if (value.requiredSetDigest !== plan.requiredSetDigest) {
      throw new TypeError('shadow asset ready progress has a drifted digest');
    }
    if (value.assetCount !== plan.assets.length) {
      throw new TypeError('shadow asset ready progress has a drifted asset count');
    }
    if (
      typeof value.storageClass !== 'string' ||
      !STORAGE_CLASSES.has(value.storageClass as never)
    ) {
      throw new TypeError('shadow asset ready progress has invalid storage class');
    }
    return Object.freeze({
      phase: 'ready',
      requiredSetDigest: value.requiredSetDigest,
      assetCount: value.assetCount,
      storageClass: value.storageClass as ShadowAssetStorageClass,
    });
  }
  exactPlainObject(
    value,
    ['assetCount', 'assetId', 'assetIndex', 'phase'],
    [],
    'shadow asset item progress',
  );
  if (
    value.phase !== 'cache-check' &&
    value.phase !== 'fetch' &&
    value.phase !== 'verify' &&
    value.phase !== 'persist'
  ) {
    throw new TypeError('shadow asset progress has invalid phase');
  }
  if (value.assetCount !== plan.assets.length) {
    throw new TypeError('shadow asset progress has a drifted asset count');
  }
  if (
    !Number.isSafeInteger(value.assetIndex) ||
    (value.assetIndex as number) < 0 ||
    (value.assetIndex as number) >= plan.assets.length
  ) {
    throw new TypeError('shadow asset progress has invalid asset index');
  }
  const descriptor = plan.assets[value.assetIndex as number];
  if (!descriptor || value.assetId !== descriptor.id) {
    throw new TypeError('shadow asset progress has a drifted asset id');
  }
  return Object.freeze({
    phase: value.phase,
    assetId: descriptor.id,
    assetIndex: value.assetIndex as number,
    assetCount: plan.assets.length,
  });
}

function decodeProgressFrame(value: unknown, plan: ShadowAssetPlan): ProgressFrame {
  exactPlainObject(
    value,
    ['progress', 'protocol', 'requestId', 'type'],
    [],
    'shadow asset progress frame',
  );
  if (value.protocol !== SHADOW_ASSET_PROTOCOL || value.type !== 'progress') {
    throw new TypeError('invalid shadow asset progress protocol');
  }
  assertRequestId(value.requestId);
  return {
    protocol: SHADOW_ASSET_PROTOCOL,
    type: 'progress',
    requestId: value.requestId,
    progress: snapshotProgress(value.progress, plan),
  };
}

function safeCauseString(value: unknown, field: 'name' | 'message' | 'code'): string | undefined {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined;
  }
  try {
    const candidate = (value as Readonly<Record<string, unknown>>)[field];
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeCause(value: unknown): ShadowAssetCauseEnvelope | undefined {
  if (value === undefined) return undefined;
  const name = safeCauseString(value, 'name') ?? 'Error';
  let message = safeCauseString(value, 'message');
  if (message === undefined) {
    try {
      message = String(value);
    } catch {
      message = 'Unknown failure';
    }
  }
  if (message.length === 0) message = 'Unknown failure';
  const code = safeCauseString(value, 'code');
  return Object.freeze({ name, ...(code === undefined ? {} : { code }), message });
}

function decodeCause(value: unknown): ShadowAssetCauseEnvelope {
  exactPlainObject(value, ['message', 'name'], ['code'], 'shadow asset cause envelope');
  assertNonEmptyString(value.name, 'shadow asset cause name');
  assertNonEmptyString(value.message, 'shadow asset cause message');
  if (value.code !== undefined) assertNonEmptyString(value.code, 'shadow asset cause code');
  return Object.freeze({
    name: value.name,
    ...(value.code === undefined ? {} : { code: value.code }),
    message: value.message,
  });
}

function snapshotTransportEnvelope(value: unknown): ShadowAssetTransportFailure {
  exactPlainObject(value, ['message', 'transport'], [], 'shadow asset transport envelope');
  if (value.transport !== 'standard' && value.transport !== 'eddy') {
    throw new TypeError('shadow asset transport envelope has invalid transport');
  }
  assertNonEmptyString(value.message, 'shadow asset transport message');
  return Object.freeze({ transport: value.transport, message: value.message });
}

function snapshotTransportEnvelopes(value: unknown): readonly ShadowAssetTransportFailure[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError('shadow asset transports must be an array');
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError('shadow asset transports have symbol keys');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expected = new Set(['length', ...value.map((_entry, index) => String(index))]);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!expected.has(key) || !('value' in descriptor)) {
      throw new TypeError('shadow asset transports have invalid array properties');
    }
  }
  if (Object.keys(descriptors).length !== value.length + 1) {
    throw new TypeError('shadow asset transports are sparse');
  }
  return Object.freeze(value.map(snapshotTransportEnvelope));
}

function encodePortError(error: ShadowAssetPortError): ShadowAssetPortErrorEnvelope {
  const cause = sanitizeCause(error.cause);
  return {
    name: 'ShadowAssetPortError',
    code: 'ESHADOWASSETPORT',
    message: error.message,
    phase: error.phase,
    ...(error.assetId === undefined ? {} : { assetId: error.assetId }),
    ...(cause === undefined ? {} : { cause }),
  };
}

function portError(
  phase: ShadowAssetPortFailurePhase,
  message: string,
  assetId?: string,
  cause?: unknown,
): ShadowAssetPortError {
  return new ShadowAssetPortError({
    message,
    phase,
    ...(assetId === undefined ? {} : { assetId }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function envelopeForReaderError(error: unknown, assetId: string): ShadowAssetPortErrorEnvelope {
  if (error instanceof ShadowAssetPortError) return encodePortError(error);
  if (error instanceof ShadowAssetReadError) {
    if (error.reason === 'deadline') {
      return encodePortError(portError('deadline', 'Shadow asset read deadline exceeded', assetId));
    }
    const cause = sanitizeCause(error.cause);
    return {
      name: 'ShadowAssetReadError',
      code: 'ESHADOWASSETREAD',
      message: error.message,
      assetId: error.assetId,
      reason: 'unknown-asset',
      ...(cause === undefined ? {} : { cause }),
    };
  }
  if (error instanceof ShadowAssetStoreError) {
    return encodePortError(portError('closed', 'Shadow asset authority is unavailable', assetId));
  }
  if (error instanceof ShadowAssetError && !(error instanceof ShadowAssetInstallError)) {
    const cause = sanitizeCause(error.cause);
    return {
      name: 'ShadowAssetError',
      code: 'ESHADOWASSET',
      message: error.message,
      requiredSetDigest: error.requiredSetDigest,
      ...(error.assetId === undefined ? {} : { assetId: error.assetId }),
      phase: error.phase,
      transports: error.transports.map((failure) => ({
        transport: failure.transport,
        message: failure.message,
      })),
      recovery: error.recovery,
      ...(error.usedBytes === undefined ? {} : { usedBytes: error.usedBytes }),
      ...(error.requiredBytes === undefined ? {} : { requiredBytes: error.requiredBytes }),
      ...(cause === undefined ? {} : { cause }),
    };
  }
  return encodePortError(portError('receive', 'Shadow asset reader failed', assetId, error));
}

function decodeErrorEnvelope(value: unknown): Error {
  const descriptors = plainObjectDescriptors(value, 'shadow asset error envelope');
  const nameDescriptor = descriptors.name;
  if (!nameDescriptor || !('value' in nameDescriptor)) {
    throw new TypeError('shadow asset error envelope is missing name');
  }
  if (nameDescriptor.value === 'ShadowAssetPortError') {
    exactPlainObject(
      value,
      ['code', 'message', 'name', 'phase'],
      ['assetId', 'cause'],
      'shadow asset port error envelope',
    );
    if (value.code !== 'ESHADOWASSETPORT') throw new TypeError('invalid port error code');
    assertNonEmptyString(value.message, 'shadow asset port error message');
    if (typeof value.phase !== 'string' || !PORT_FAILURE_PHASES.has(value.phase as never)) {
      throw new TypeError('invalid port error phase');
    }
    if (value.assetId !== undefined) {
      assertNonEmptyString(value.assetId, 'shadow asset port error assetId');
    }
    const cause = value.cause === undefined ? undefined : decodeCause(value.cause);
    return new ShadowAssetPortError({
      message: value.message,
      phase: value.phase as ShadowAssetPortFailurePhase,
      ...(value.assetId === undefined ? {} : { assetId: value.assetId }),
      ...(cause === undefined ? {} : { cause }),
    });
  }
  if (nameDescriptor.value === 'ShadowAssetReadError') {
    exactPlainObject(
      value,
      ['assetId', 'code', 'message', 'name', 'reason'],
      ['cause'],
      'shadow asset read error envelope',
    );
    if (value.code !== 'ESHADOWASSETREAD' || value.reason !== 'unknown-asset') {
      throw new TypeError('invalid shadow asset read error envelope');
    }
    assertNonEmptyString(value.message, 'shadow asset read error message');
    assertNonEmptyString(value.assetId, 'shadow asset read error assetId');
    const cause = value.cause === undefined ? undefined : decodeCause(value.cause);
    return new ShadowAssetReadError({
      message: value.message,
      assetId: value.assetId,
      reason: 'unknown-asset',
      ...(cause === undefined ? {} : { cause }),
    });
  }
  if (nameDescriptor.value === 'ShadowAssetError') {
    exactPlainObject(
      value,
      ['code', 'message', 'name', 'phase', 'recovery', 'requiredSetDigest', 'transports'],
      ['assetId', 'cause', 'requiredBytes', 'usedBytes'],
      'shadow asset error envelope',
    );
    if (value.code !== 'ESHADOWASSET') throw new TypeError('invalid shadow asset error code');
    assertNonEmptyString(value.message, 'shadow asset error message');
    assertSha256(value.requiredSetDigest, 'shadow asset error requiredSetDigest');
    if (typeof value.phase !== 'string' || !ASSET_FAILURE_PHASES.has(value.phase as never)) {
      throw new TypeError('invalid shadow asset error phase');
    }
    if (
      value.recovery !== 'retry' &&
      value.recovery !== 'clear-and-retry' &&
      value.recovery !== 'none'
    ) {
      throw new TypeError('invalid shadow asset error recovery');
    }
    if (value.assetId !== undefined)
      assertNonEmptyString(value.assetId, 'shadow asset error assetId');
    assertOptionalNonNegativeInteger(value.usedBytes, 'shadow asset error usedBytes');
    assertOptionalNonNegativeInteger(value.requiredBytes, 'shadow asset error requiredBytes');
    const transports = snapshotTransportEnvelopes(value.transports);
    const cause = value.cause === undefined ? undefined : decodeCause(value.cause);
    return new ShadowAssetError({
      message: value.message,
      requiredSetDigest: value.requiredSetDigest,
      ...(value.assetId === undefined ? {} : { assetId: value.assetId }),
      phase: value.phase as ShadowAssetFailurePhase,
      transports,
      recovery: value.recovery,
      ...(value.usedBytes === undefined ? {} : { usedBytes: value.usedBytes as number }),
      ...(value.requiredBytes === undefined
        ? {}
        : { requiredBytes: value.requiredBytes as number }),
      ...(cause === undefined ? {} : { cause }),
    });
  }
  throw new TypeError('unsupported shadow asset error envelope');
}

function validateReadOptions(options: ShadowAssetReadOptions | undefined): Readonly<{
  deadlineMs: number;
  signal?: AbortSignal;
  onProgress?: (progress: ShadowAssetProgress) => void;
}> {
  const candidate = options === undefined ? {} : options;
  exactPlainObject(candidate, [], ['deadlineMs', 'onProgress', 'signal'], 'ShadowAssetReadOptions');
  const deadlineMs = candidate.deadlineMs ?? SHADOW_ASSET_MAX_READ_DEADLINE_MS;
  assertDeadline(deadlineMs);
  if (candidate.signal !== undefined && !(candidate.signal instanceof AbortSignal)) {
    throw new TypeError('ShadowAssetReadOptions.signal must be AbortSignal');
  }
  if (candidate.onProgress !== undefined && typeof candidate.onProgress !== 'function') {
    throw new TypeError('ShadowAssetReadOptions.onProgress must be a function');
  }
  const onProgress = candidate.onProgress as ((progress: ShadowAssetProgress) => void) | undefined;
  return {
    deadlineMs,
    ...(candidate.signal === undefined ? {} : { signal: candidate.signal }),
    ...(onProgress === undefined ? {} : { onProgress }),
  };
}

interface ClientPending {
  readonly requestId: number;
  readonly descriptor: ShadowAssetDescriptor;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
  readonly onProgress?: (progress: ShadowAssetProgress) => void;
  readonly resolve: (bytes: Uint8Array) => void;
  readonly reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

class ShadowAssetPortClientImpl implements ShadowAssetPortClient {
  readonly #port: MessagePort;
  readonly #plan: ShadowAssetPlan;
  readonly #assets: ReadonlyMap<string, ShadowAssetDescriptor>;
  readonly #pending = new Map<number, ClientPending>();
  #lastIssued = 0;
  #terminalError: ShadowAssetPortError | null = null;
  #disposePromise: Promise<void> | null = null;
  #closed = false;

  readonly #onMessage = (event: MessageEvent<unknown>): void => {
    if (this.#terminalError) return;
    try {
      const type = frameDiscriminator(event.data);
      if (type === 'progress') {
        this.#handleProgress(decodeProgressFrame(event.data, this.#plan));
        return;
      }
      if (type === 'result' || type === 'error') {
        this.#handleTerminal(event.data, type);
        return;
      }
      throw new TypeError('server sent a forbidden shadow asset frame');
    } catch (error) {
      this.#failSession(
        portError('decode', 'Shadow asset port received a malformed frame', undefined, error),
      );
    }
  };

  readonly #onMessageError = (event: MessageEvent<unknown>): void => {
    this.#failSession(
      portError('decode', 'Shadow asset port could not decode a peer frame', undefined, event),
    );
  };

  readonly #onClose = (): void => {
    if (this.#closed) return;
    this.#failSession(portError('closed', 'Shadow asset port closed'));
  };

  constructor(port: MessagePort, plan: ShadowAssetPlan) {
    this.#port = port;
    this.#plan = plan;
    this.#assets = new Map(plan.assets.map((asset) => [asset.id, asset]));
    port.addEventListener('message', this.#onMessage);
    port.addEventListener('messageerror', this.#onMessageError);
    port.addEventListener('close', this.#onClose);
    port.start();
  }

  readVerified(assetId: string, options?: ShadowAssetReadOptions): Promise<Uint8Array> {
    if (this.#terminalError) return Promise.reject(this.#terminalError);
    if (typeof assetId !== 'string' || assetId.length === 0) {
      return Promise.reject(new TypeError('assetId must be a non-empty string'));
    }
    let readOptions: ReturnType<typeof validateReadOptions>;
    try {
      readOptions = validateReadOptions(options);
    } catch (error) {
      return Promise.reject(error);
    }
    const descriptor = this.#assets.get(assetId);
    if (!descriptor) {
      return Promise.reject(
        new ShadowAssetReadError({
          message: `unknown shadow asset ${assetId}`,
          assetId,
          reason: 'unknown-asset',
        }),
      );
    }
    if (readOptions.signal?.aborted) return Promise.reject(abortError());
    if (this.#lastIssued === Number.MAX_SAFE_INTEGER) {
      return Promise.reject(
        portError('send', 'Shadow asset request id space is exhausted', descriptor.id),
      );
    }
    const requestId = this.#lastIssued + 1;
    this.#lastIssued = requestId;
    return new Promise<Uint8Array>((resolve, reject) => {
      const onAbort = readOptions.signal
        ? () => {
            const pending = this.#pending.get(requestId);
            if (!pending) return;
            this.#settlePending(pending, { reject: abortError() });
            this.#postBestEffort({
              protocol: SHADOW_ASSET_PROTOCOL,
              type: 'cancel',
              requestId,
            });
          }
        : undefined;
      const pending: ClientPending = {
        requestId,
        descriptor,
        ...(readOptions.signal === undefined ? {} : { signal: readOptions.signal }),
        ...(onAbort === undefined ? {} : { onAbort }),
        ...(readOptions.onProgress === undefined ? {} : { onProgress: readOptions.onProgress }),
        resolve,
        reject,
        timer: setTimeout(() => {
          const current = this.#pending.get(requestId);
          if (!current) return;
          this.#settlePending(current, {
            reject: portError('deadline', 'Shadow asset read deadline exceeded', descriptor.id),
          });
          this.#postBestEffort({
            protocol: SHADOW_ASSET_PROTOCOL,
            type: 'cancel',
            requestId,
          });
        }, readOptions.deadlineMs),
      };
      this.#pending.set(requestId, pending);
      if (onAbort && readOptions.signal) {
        readOptions.signal.addEventListener('abort', onAbort, { once: true });
        if (readOptions.signal.aborted) onAbort();
      }
      if (!this.#pending.has(requestId)) return;
      try {
        this.#port.postMessage({
          protocol: SHADOW_ASSET_PROTOCOL,
          type: 'read',
          requestId,
          assetId: descriptor.id,
          deadlineMs: readOptions.deadlineMs,
        } satisfies ReadFrame);
      } catch (error) {
        const current = this.#pending.get(requestId);
        if (current) {
          this.#settlePending(current, {
            reject: portError('send', 'Shadow asset read could not be sent', descriptor.id, error),
          });
        }
      }
    });
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposePromise = Promise.resolve();
    if (this.#closed) return this.#disposePromise;
    const failure = portError('dispose', 'Shadow asset port client was disposed');
    this.#terminalError = failure;
    for (const pending of [...this.#pending.values()]) {
      this.#settlePending(pending, {
        reject: portError(
          'dispose',
          'Shadow asset port client was disposed',
          pending.descriptor.id,
        ),
      });
    }
    this.#postBestEffort({ protocol: SHADOW_ASSET_PROTOCOL, type: 'dispose' });
    this.#detachAndClose();
    return this.#disposePromise;
  }

  #handleProgress(frame: ProgressFrame): void {
    if (frame.requestId > this.#lastIssued) {
      throw new TypeError('progress names a request id that was never issued');
    }
    const pending = this.#pending.get(frame.requestId);
    if (!pending) return;
    if (!pending.onProgress) return;
    try {
      pending.onProgress(frame.progress);
    } catch (error) {
      try {
        console.warn(
          `shadow asset progress observer threw: ${error instanceof Error ? error.message : String(error)}`,
        );
      } catch {
        // Presentation cannot become a reader lifecycle owner.
      }
    }
  }

  #handleTerminal(value: unknown, type: 'result' | 'error'): void {
    const { requestId, record } = decodeTerminalHeader(value, type);
    if (requestId > this.#lastIssued) {
      throw new TypeError('terminal frame names a request id that was never issued');
    }
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    if (type === 'error') {
      const error = decodeErrorEnvelope(record.error);
      this.#settlePending(pending, { reject: error });
      return;
    }
    assertNonEmptyString(record.assetId, 'shadow asset result assetId');
    assertSha256(record.sha256, 'shadow asset result sha256');
    if (record.assetId !== pending.descriptor.id) {
      throw new TypeError('shadow asset result has a drifted asset id');
    }
    if (record.sha256 !== pending.descriptor.memberSha256) {
      throw new TypeError('shadow asset result has a drifted descriptor hash');
    }
    if (!(record.bytes instanceof ArrayBuffer)) {
      throw new TypeError('shadow asset result bytes must be an ArrayBuffer');
    }
    if (record.bytes.byteLength !== pending.descriptor.memberSize) {
      throw new TypeError('shadow asset result has a drifted byte length');
    }
    const bytes = new Uint8Array(record.bytes);
    if (sha256Hex(bytes) !== pending.descriptor.memberSha256) {
      throw new TypeError('shadow asset result bytes failed verification');
    }
    this.#settlePending(pending, { resolve: bytes });
  }

  #settlePending(
    pending: ClientPending,
    outcome: Readonly<{ resolve: Uint8Array } | { reject: unknown }>,
  ): void {
    if (this.#pending.get(pending.requestId) !== pending) return;
    this.#pending.delete(pending.requestId);
    clearTimeout(pending.timer);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener('abort', pending.onAbort);
    }
    if ('resolve' in outcome) pending.resolve(outcome.resolve);
    else pending.reject(outcome.reject);
  }

  #postBestEffort(frame: CancelFrame | DisposeFrame): void {
    try {
      this.#port.postMessage(frame);
    } catch {
      // Best effort is the protocol contract for cancellation and disposal.
    }
  }

  #failSession(error: ShadowAssetPortError): void {
    if (this.#terminalError) return;
    this.#terminalError = error;
    for (const pending of [...this.#pending.values()])
      this.#settlePending(pending, { reject: error });
    this.#detachAndClose();
  }

  #detachAndClose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#port.removeEventListener('message', this.#onMessage);
    this.#port.removeEventListener('messageerror', this.#onMessageError);
    this.#port.removeEventListener('close', this.#onClose);
    this.#port.close();
  }
}

interface ServerPending {
  readonly requestId: number;
  readonly assetId: string;
  readonly controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
}

class ShadowAssetPortServerImpl implements ShadowAssetPortServer {
  readonly #port: MessagePort;
  readonly #plan: ShadowAssetPlan;
  readonly #assets: ReadonlyMap<string, ShadowAssetDescriptor>;
  readonly #reader: ShadowAssetRuntimeReader;
  readonly #pending = new Map<number, ServerPending>();
  readonly #seenRequestIds = new Set<number>();
  #highestRequestId = 0;
  #disposePromise: Promise<void> | null = null;
  #closed = false;

  readonly #onMessage = (event: MessageEvent<unknown>): void => {
    if (this.#closed) return;
    try {
      const type = frameDiscriminator(event.data);
      if (type === 'read') {
        this.#admitRead(decodeReadFrame(event.data));
        return;
      }
      if (type === 'cancel') {
        this.#cancel(decodeCancelFrame(event.data));
        return;
      }
      if (type === 'dispose') {
        decodeDisposeFrame(event.data);
        this.#shutdown('dispose', 'Shadow asset port peer was disposed', true);
        return;
      }
      throw new TypeError('client sent a forbidden shadow asset frame');
    } catch (error) {
      this.#failDecode(error);
    }
  };

  readonly #onMessageError = (event: MessageEvent<unknown>): void => {
    this.#failDecode(event);
  };

  readonly #onClose = (): void => {
    if (this.#closed) return;
    this.#shutdown('closed', 'Shadow asset port closed', false);
  };

  constructor(port: MessagePort, plan: ShadowAssetPlan, reader: ShadowAssetRuntimeReader) {
    this.#port = port;
    this.#plan = plan;
    this.#assets = new Map(plan.assets.map((asset) => [asset.id, asset]));
    this.#reader = reader;
    port.addEventListener('message', this.#onMessage);
    port.addEventListener('messageerror', this.#onMessageError);
    port.addEventListener('close', this.#onClose);
    port.start();
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposePromise = Promise.resolve();
    this.#shutdown('dispose', 'Shadow asset port server was disposed', true);
    return this.#disposePromise;
  }

  #admitRead(frame: ReadFrame): void {
    if (frame.requestId <= this.#highestRequestId) {
      throw new TypeError('shadow asset request id was reused or moved backwards');
    }
    this.#highestRequestId = frame.requestId;
    this.#seenRequestIds.add(frame.requestId);
    const descriptor = this.#assets.get(frame.assetId);
    if (!descriptor) {
      this.#postTerminal({
        protocol: SHADOW_ASSET_PROTOCOL,
        type: 'error',
        requestId: frame.requestId,
        error: {
          name: 'ShadowAssetReadError',
          code: 'ESHADOWASSETREAD',
          message: `unknown shadow asset ${frame.assetId}`,
          assetId: frame.assetId,
          reason: 'unknown-asset',
        },
      });
      return;
    }
    const controller = new AbortController();
    const pending: ServerPending = {
      requestId: frame.requestId,
      assetId: descriptor.id,
      controller,
      timer: setTimeout(() => {
        const current = this.#pending.get(frame.requestId);
        if (!current) return;
        this.#pending.delete(frame.requestId);
        current.controller.abort();
        this.#postTerminal({
          protocol: SHADOW_ASSET_PROTOCOL,
          type: 'error',
          requestId: frame.requestId,
          error: encodePortError(
            portError('deadline', 'Shadow asset read deadline exceeded', descriptor.id),
          ),
        });
      }, frame.deadlineMs),
    };
    this.#pending.set(frame.requestId, pending);
    void this.#runRead(pending, descriptor, frame.deadlineMs);
  }

  async #runRead(
    pending: ServerPending,
    descriptor: ShadowAssetDescriptor,
    deadlineMs: number,
  ): Promise<void> {
    try {
      const bytes = await this.#reader.readVerified(descriptor.id, {
        deadlineMs,
        signal: pending.controller.signal,
        onProgress: (progress) => {
          if (this.#pending.get(pending.requestId) !== pending) return;
          const snapshot = snapshotProgress(progress, this.#plan);
          this.#port.postMessage({
            protocol: SHADOW_ASSET_PROTOCOL,
            type: 'progress',
            requestId: pending.requestId,
            progress: snapshot,
          } satisfies ProgressFrame);
        },
      });
      if (this.#pending.get(pending.requestId) !== pending) return;
      if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer)) {
        throw new TypeError('shadow asset reader returned non-owned bytes');
      }
      if (bytes.byteLength !== descriptor.memberSize) {
        throw new TypeError('shadow asset reader returned a drifted byte length');
      }
      if (sha256Hex(bytes) !== descriptor.memberSha256) {
        throw new TypeError('shadow asset reader returned unverified bytes');
      }
      const responseBytes = new Uint8Array(bytes.byteLength);
      responseBytes.set(bytes);
      const buffer = responseBytes.buffer;
      this.#pending.delete(pending.requestId);
      clearTimeout(pending.timer);
      try {
        this.#port.postMessage(
          {
            protocol: SHADOW_ASSET_PROTOCOL,
            type: 'result',
            requestId: pending.requestId,
            assetId: descriptor.id,
            sha256: descriptor.memberSha256,
            bytes: buffer,
          } satisfies ResultFrame,
          [buffer],
        );
      } catch (error) {
        this.#shutdown('closed', 'Shadow asset result could not be sent', false, error);
      }
    } catch (error) {
      if (this.#pending.get(pending.requestId) !== pending) return;
      this.#pending.delete(pending.requestId);
      clearTimeout(pending.timer);
      this.#postTerminal({
        protocol: SHADOW_ASSET_PROTOCOL,
        type: 'error',
        requestId: pending.requestId,
        error: envelopeForReaderError(error, descriptor.id),
      });
    }
  }

  #cancel(frame: CancelFrame): void {
    if (!this.#seenRequestIds.has(frame.requestId)) {
      throw new TypeError('cancel names a request id that was never admitted');
    }
    const pending = this.#pending.get(frame.requestId);
    if (!pending) return;
    this.#pending.delete(frame.requestId);
    clearTimeout(pending.timer);
    pending.controller.abort();
  }

  #postTerminal(frame: ErrorFrame): void {
    if (this.#closed) return;
    try {
      this.#port.postMessage(frame);
    } catch (error) {
      this.#shutdown('closed', 'Shadow asset terminal frame could not be sent', false, error);
    }
  }

  #failDecode(cause: unknown): void {
    if (this.#closed) return;
    this.#shutdown('decode', 'Shadow asset port received a malformed frame', true, cause);
  }

  #shutdown(
    phase: ShadowAssetPortFailurePhase,
    message: string,
    notify: boolean,
    cause?: unknown,
  ): void {
    if (this.#closed) return;
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    if (notify) {
      for (const request of pending) {
        try {
          this.#port.postMessage({
            protocol: SHADOW_ASSET_PROTOCOL,
            type: 'error',
            requestId: request.requestId,
            error: encodePortError(portError(phase, message, request.assetId, cause)),
          } satisfies ErrorFrame);
        } catch {
          // Closing the session remains the bounded settlement when posting fails.
        }
      }
    }
    for (const request of pending) {
      clearTimeout(request.timer);
      request.controller.abort();
    }
    this.#closed = true;
    this.#port.removeEventListener('message', this.#onMessage);
    this.#port.removeEventListener('messageerror', this.#onMessageError);
    this.#port.removeEventListener('close', this.#onClose);
    this.#port.close();
  }
}

export function startShadowAssetPortServer(
  options: Readonly<{
    port: MessagePort;
    plan: ShadowAssetPlan;
    reader: ShadowAssetRuntimeReader;
  }>,
): ShadowAssetPortServer {
  exactPlainObject(options, ['plan', 'port', 'reader'], [], 'startShadowAssetPortServer options');
  assertPort(options.port);
  const plan = snapshotShadowAssetPlan(options.plan);
  if (
    options.reader === null ||
    typeof options.reader !== 'object' ||
    typeof options.reader.readVerified !== 'function'
  ) {
    throw new TypeError('shadow asset server reader must implement readVerified');
  }
  return new ShadowAssetPortServerImpl(options.port, plan, options.reader);
}

export function createShadowAssetPortClient(
  options: Readonly<{ port: MessagePort; plan: ShadowAssetPlan }>,
): ShadowAssetPortClient {
  exactPlainObject(options, ['plan', 'port'], [], 'createShadowAssetPortClient options');
  assertPort(options.port);
  const plan = snapshotShadowAssetPlan(options.plan);
  return new ShadowAssetPortClientImpl(options.port, plan);
}
