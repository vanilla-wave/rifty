import { canonicalShadowJson, decodeDenseDataArray } from '@riftydev/shadow-registry/internal';
import { type ShadowAssetPlan, decodeShadowAssetPlan } from './planner.ts';

export const SHADOW_ASSET_PORT_CAPABILITY = 'rifty.shadow-assets.ready/v1' as const;

export interface ShadowAssetPortDescriptor {
  readonly plan: ShadowAssetPlan;
  readonly bindings: ShadowAssetPlan['bindings'];
}

export interface ReadyShadowAssetReader {
  readonly plan: ShadowAssetPlan;
  read(assetId: string): Promise<Uint8Array>;
}

export interface ShadowAssetPortServer {
  dispose(): void;
}

export interface ShadowAssetPortClient {
  readonly ready: Promise<ShadowAssetPortDescriptor>;
  read(assetId: string): Promise<Uint8Array>;
  dispose(): void;
}

export class ShadowAssetPortError extends Error {
  readonly code = 'ESHADOWASSETPORT' as const;
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'ShadowAssetPortError';
  }
}

function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ShadowAssetPortError(`${label} must be a plain object`, false);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new ShadowAssetPortError(`${label} has symbols`, false);
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ShadowAssetPortError(`${label} has extra or missing fields`, false);
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!('value' in descriptor)) throw new ShadowAssetPortError(`${label} has accessors`, false);
  }
  return value as Record<string, unknown>;
}

function frameRecord(value: unknown, label: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ShadowAssetPortError(`${label} must be a plain object`, false);
  }
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new ShadowAssetPortError(`${label} has symbols`, false);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const descriptor of Object.values(descriptors)) {
    if (!('value' in descriptor)) throw new ShadowAssetPortError(`${label} has accessors`, false);
  }
  return value as Record<string, unknown>;
}

function descriptorFromFrame(frame: Record<string, unknown>): ShadowAssetPortDescriptor {
  const plan = decodeShadowAssetPlan(frame.plan);
  let bindingValues: readonly unknown[];
  try {
    bindingValues = decodeDenseDataArray(frame.bindings, 'ready handshake bindings');
  } catch (error) {
    throw new ShadowAssetPortError(
      error instanceof Error ? error.message : 'ready handshake bindings are invalid',
      false,
    );
  }
  const bindings = bindingValues.map((value, index) => {
    const binding = exact(value, ['adapterId', 'assets'], `ready binding ${index}`);
    if (typeof binding.adapterId !== 'string') {
      throw new ShadowAssetPortError(`ready binding ${index} is invalid`, false);
    }
    let assetValues: readonly unknown[];
    try {
      assetValues = decodeDenseDataArray(binding.assets, `ready binding ${index} assets`);
    } catch (error) {
      throw new ShadowAssetPortError(
        error instanceof Error ? error.message : `ready binding ${index} assets are invalid`,
        false,
      );
    }
    const assets = assetValues.map((asset, assetIndex) => {
      if (typeof asset !== 'string') {
        throw new ShadowAssetPortError(
          `ready binding ${index} asset ${assetIndex} is invalid`,
          false,
        );
      }
      return asset;
    });
    return { adapterId: binding.adapterId, assets };
  });
  if (canonicalShadowJson(bindings) !== canonicalShadowJson(plan.bindings)) {
    throw new ShadowAssetPortError('ready handshake bindings drifted from plan', false);
  }
  return Object.freeze({ plan, bindings: plan.bindings });
}

/** Package-private core for owner-held decoded/frozen readiness. */
export function serveTrustedReadyShadowAssets(
  port: MessagePort,
  reader: ReadyShadowAssetReader,
): ShadowAssetPortServer {
  const plan = reader.plan;
  if (!Object.isFrozen(plan) || !Object.isFrozen(plan.assets)) {
    throw new TypeError('trusted ready shadow plan invariant failed');
  }
  const admitted = new Set(plan.assets.map((asset) => asset.id));
  const active = new Set<number>();
  let disposed = false;
  const terminate = () => {
    if (disposed) return;
    disposed = true;
    active.clear();
    port.removeEventListener('message', onMessage);
    port.close();
  };
  const post = (frame: unknown, transfer?: Transferable[]): ShadowAssetPortError | null => {
    try {
      if (transfer) port.postMessage(frame, transfer);
      else port.postMessage(frame);
      return null;
    } catch (error) {
      const failure = new ShadowAssetPortError(
        `shadow asset server post failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      terminate();
      return failure;
    }
  };
  const replyError = (id: number, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = error instanceof ShadowAssetPortError ? error.retryable : true;
    post({ type: 'error', id, message, retryable });
  };
  function onMessage(event: MessageEvent<unknown>): void {
    if (disposed) return;
    let frame: Record<string, unknown>;
    try {
      const candidate = frameRecord(event.data, 'shadow request');
      if (candidate.type === 'cancel') {
        frame = exact(event.data, ['id', 'type'], 'shadow cancel');
        if (
          frame.type !== 'cancel' ||
          !Number.isSafeInteger(frame.id) ||
          (frame.id as number) < 0
        ) {
          throw new ShadowAssetPortError('invalid shadow cancel frame', false);
        }
        active.delete(frame.id as number);
        return;
      }
      frame = exact(event.data, ['assetId', 'id', 'type'], 'shadow read');
      if (frame.type !== 'read' || !Number.isSafeInteger(frame.id) || (frame.id as number) < 0) {
        throw new ShadowAssetPortError('invalid shadow read frame', false);
      }
      const id = frame.id as number;
      const assetId = typeof frame.assetId === 'string' ? frame.assetId : '';
      if (!admitted.has(assetId)) {
        replyError(id, new ShadowAssetPortError(`asset ${assetId} is not admitted`, false));
        return;
      }
      if (active.has(id)) {
        replyError(id, new ShadowAssetPortError(`duplicate active correlation ${id}`, false));
        return;
      }
      active.add(id);
      void Promise.resolve()
        .then(() => reader.read(assetId))
        .then(
          (bytes) => {
            if (!active.delete(id) || disposed) return;
            if (!(bytes instanceof Uint8Array)) {
              replyError(
                id,
                new ShadowAssetPortError(
                  `ready shadow reader returned non-Uint8Array for ${assetId}`,
                  false,
                ),
              );
              return;
            }
            const copy = new Uint8Array(bytes);
            post({ type: 'result', id, bytes: copy }, [copy.buffer]);
          },
          (error: unknown) => {
            if (!active.delete(id) || disposed) return;
            replyError(id, error);
          },
        );
    } catch {
      // A malformed frame has no trustworthy correlation id; close loudly.
      terminate();
    }
  }
  port.addEventListener('message', onMessage);
  try {
    port.start();
  } catch (error) {
    terminate();
    throw new ShadowAssetPortError(
      `shadow asset server start failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const readyPostError = post({ type: 'ready', plan, bindings: plan.bindings });
  if (readyPostError) throw readyPostError;
  return Object.freeze({
    dispose() {
      terminate();
    },
  });
}

export function createShadowAssetPortClient(
  port: MessagePort,
  options: Readonly<{ deadlineMs?: number }> = {},
): ShadowAssetPortClient {
  const deadlineMs = options.deadlineMs ?? 30_000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0)
    throw new TypeError('shadow port deadlineMs must be a positive safe integer');
  let nextId = 0;
  let terminalError: unknown;
  let readySettled = false;
  let resolveReady!: (value: ShadowAssetPortDescriptor) => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<ShadowAssetPortDescriptor>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const pending = new Map<
    number,
    {
      resolve(value: Uint8Array): void;
      reject(error: unknown): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const terminate = (error: unknown) => {
    if (terminalError !== undefined) return;
    terminalError = error;
    if (!readySettled) {
      readySettled = true;
      clearTimeout(readyTimer);
      rejectReady(error);
    }
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    port.removeEventListener('message', onMessage);
    port.removeEventListener('messageerror', onDead);
    port.removeEventListener('close', onDead);
    port.close();
  };
  const readyTimer = setTimeout(
    () => terminate(new ShadowAssetPortError(`ready handshake exceeded ${deadlineMs}ms`)),
    deadlineMs,
  );
  function onMessage(event: MessageEvent<unknown>): void {
    try {
      if (!readySettled) {
        const frame = exact(event.data, ['bindings', 'plan', 'type'], 'shadow ready handshake');
        if (frame.type !== 'ready')
          throw new ShadowAssetPortError('first shadow port frame is not ready', false);
        const descriptor = descriptorFromFrame(frame);
        readySettled = true;
        clearTimeout(readyTimer);
        resolveReady(descriptor);
        return;
      }
      const candidate = frameRecord(event.data, 'shadow response');
      const type = candidate.type;
      let frame: Record<string, unknown>;
      if (type === 'result') {
        frame = exact(event.data, ['bytes', 'id', 'type'], 'shadow result');
        if (!(frame.bytes instanceof Uint8Array)) {
          throw new ShadowAssetPortError('shadow result bytes must be Uint8Array', false);
        }
      } else if (type === 'error') {
        frame = exact(event.data, ['id', 'message', 'retryable', 'type'], 'shadow error');
        if (typeof frame.message !== 'string' || typeof frame.retryable !== 'boolean') {
          throw new ShadowAssetPortError('shadow error frame fields are invalid', false);
        }
      } else {
        throw new ShadowAssetPortError('shadow response type is unsupported', false);
      }
      if (!Number.isSafeInteger(frame.id) || (frame.id as number) < 0) {
        throw new ShadowAssetPortError('invalid shadow response correlation', false);
      }
      const request = pending.get(frame.id as number);
      if (!request) return;
      pending.delete(frame.id as number);
      clearTimeout(request.timer);
      if (type === 'result') request.resolve((frame.bytes as Uint8Array).slice());
      else
        request.reject(new ShadowAssetPortError(String(frame.message), frame.retryable === true));
    } catch (error) {
      terminate(error);
    }
  }
  function onDead(): void {
    terminate(new ShadowAssetPortError('shadow asset port peer died'));
  }
  port.addEventListener('message', onMessage);
  port.addEventListener('messageerror', onDead);
  port.addEventListener('close', onDead);
  port.start();
  const client: ShadowAssetPortClient = {
    ready,
    async read(assetId) {
      if (terminalError !== undefined) throw terminalError;
      await ready;
      if (terminalError !== undefined) throw terminalError;
      if (typeof assetId !== 'string' || assetId.length === 0)
        throw new TypeError('assetId must be non-empty');
      if (!Number.isSafeInteger(nextId)) {
        throw new ShadowAssetPortError('shadow asset correlation space exhausted', false);
      }
      const id = nextId++;
      return await new Promise<Uint8Array>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          try {
            port.postMessage({ type: 'cancel', id });
          } catch {
            // Peer death is reported by the same client-owned deadline.
          }
          reject(new ShadowAssetPortError(`shadow asset read exceeded ${deadlineMs}ms`));
        }, deadlineMs);
        pending.set(id, { resolve, reject, timer });
        try {
          port.postMessage({ type: 'read', id, assetId });
        } catch (error) {
          terminate(
            new ShadowAssetPortError(
              `shadow asset port post failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
      });
    },
    dispose() {
      terminate(new ShadowAssetPortError('shadow asset port disposed', false));
    },
  };
  return Object.freeze(client);
}
