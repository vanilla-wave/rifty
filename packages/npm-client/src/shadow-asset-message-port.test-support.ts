import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { TAR_TRAILER, buildHeader, concat, padToBlock } from './_test-fixtures/tar-builder.ts';
import { canonicalShadowDigest } from './canonical-shadow-json.ts';
import * as npmClient from './index.ts';
import type {
  ShadowAssetPlan,
  ShadowAssetRuntimeReader,
  ShadowAssetSource,
  ShadowAssetSourceRequest,
} from './shadow-assets.ts';

export const SHADOW_ASSET_PROTOCOL = 'rifty.shadow-assets/v1' as const;

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

export interface ShadowAssetPortErrorLike extends Error {
  readonly code: 'ESHADOWASSETPORT';
  readonly phase: ShadowAssetPortFailurePhase;
  readonly assetId?: string;
  readonly cause?: unknown;
}

export interface ShadowAssetPortServerLike {
  dispose(): Promise<void>;
}

export interface ShadowAssetPortClientLike extends ShadowAssetRuntimeReader {
  dispose(): Promise<void>;
}

interface ShadowAssetPortApi {
  readonly SHADOW_ASSET_CAPABILITY: 'rifty.shadow-assets.v1';
  readonly ShadowAssetPortError: new (failure: ShadowAssetPortFailure) => ShadowAssetPortErrorLike;
  readonly startShadowAssetPortServer: (
    options: Readonly<{
      port: MessagePort;
      plan: ShadowAssetPlan;
      reader: ShadowAssetRuntimeReader;
    }>,
  ) => ShadowAssetPortServerLike;
  readonly createShadowAssetPortClient: (
    options: Readonly<{
      port: MessagePort;
      plan: ShadowAssetPlan;
    }>,
  ) => ShadowAssetPortClientLike;
}

export function shadowAssetPortExports(): Readonly<Record<string, unknown>> {
  return npmClient as unknown as Readonly<Record<string, unknown>>;
}

export function shadowAssetPortApi(): ShadowAssetPortApi {
  const candidate = shadowAssetPortExports();
  const missing = [
    'SHADOW_ASSET_CAPABILITY',
    'ShadowAssetPortError',
    'startShadowAssetPortServer',
    'createShadowAssetPortClient',
  ].filter((key) => !(key in candidate));
  if (missing.length !== 0) {
    throw new Error(`shadow asset MessagePort public API is missing: ${missing.join(', ')}`);
  }
  return candidate as unknown as ShadowAssetPortApi;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sri(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function planFor(
  member: Uint8Array,
  tarball: Uint8Array = member,
  maxUnpackedBytes = member.byteLength,
): ShadowAssetPlan {
  const substitutions: ShadowAssetPlan['substitutions'] = [
    {
      catalog: { id: 'test.message-port.catalog', digest: '2'.repeat(64) },
      publicName: 'esbuild',
      requestedRange: '0.28.0',
      resolvedPublicVersion: '0.28.0',
      substitutionId: 'test.message-port.substitution',
      runtimeAdapterId: 'test.message-port.adapter',
      builtin: true,
    },
  ];
  const assets: ShadowAssetPlan['assets'] = [
    {
      id: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
      source: {
        name: 'esbuild-wasm',
        version: '0.28.0',
        integrity: sri(tarball),
      },
      member: 'package/esbuild.wasm',
      memberSha256: sha256(member),
      memberSize: member.byteLength,
      maxTarballBytes: tarball.byteLength,
      maxUnpackedBytes,
    },
  ];
  return {
    requiredSetDigest: canonicalShadowDigest({ schema: 1, substitutions, assets }),
    substitutions,
    assets,
  };
}

export function smallPortFixture(bytes = new TextEncoder().encode('verified-runtime')): Readonly<{
  bytes: Uint8Array;
  plan: ShadowAssetPlan;
}> {
  const owned = bytes.slice();
  return Object.freeze({ bytes: owned, plan: planFor(owned) });
}

export function tarballPortFixture(bytes: Uint8Array): Readonly<{
  bytes: Uint8Array;
  plan: ShadowAssetPlan;
  source: ShadowAssetSource;
  acquisitionCount(): number;
}> {
  const owned = bytes.slice();
  const tar = concat(
    buildHeader('package/esbuild.wasm', owned.byteLength),
    padToBlock(owned),
    TAR_TRAILER,
  );
  const compressed = new Uint8Array(gzipSync(tar));
  const plan = planFor(owned, compressed, tar.byteLength);
  let acquisitions = 0;
  const source: ShadowAssetSource = {
    acquire: async (requests: readonly ShadowAssetSourceRequest[]) => {
      acquisitions += 1;
      return requests.map((request) => ({
        request,
        bytes: compressed.slice(),
        fillTransport: 'standard' as const,
        fillCache: 'network' as const,
      }));
    },
    close: async () => undefined,
  };
  return Object.freeze({
    bytes: owned,
    plan,
    source,
    acquisitionCount: () => acquisitions,
  });
}

export function realEsbuildWasmBytes(): Uint8Array {
  const shadowRegistryRequire = createRequire(
    new URL('../../../tools/shadow-registry/package.json', import.meta.url),
  );
  const file = readFileSync(shadowRegistryRequire.resolve('esbuild-wasm/esbuild.wasm'));
  return new Uint8Array(file.buffer, file.byteOffset, file.byteLength).slice();
}

interface InboxWaiter {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class PortInbox {
  readonly #port: MessagePort;
  readonly #queue: unknown[] = [];
  readonly #waiters: InboxWaiter[] = [];
  readonly #onMessage: (event: MessageEvent<unknown>) => void;

  constructor(port: MessagePort) {
    this.#port = port;
    this.#onMessage = (event) => {
      const waiter = this.#waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(event.data);
      } else {
        this.#queue.push(event.data);
      }
    };
    port.addEventListener('message', this.#onMessage);
    port.start();
  }

  next(timeoutMs = 1_000): Promise<unknown> {
    const queued = this.#queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const waiter: InboxWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.#waiters.indexOf(waiter);
          if (index >= 0) this.#waiters.splice(index, 1);
          reject(new Error(`MessagePort frame did not arrive within ${timeoutMs}ms`));
        }, timeoutMs),
      };
      this.#waiters.push(waiter);
    });
  }

  async until(
    predicate: (frame: unknown) => boolean,
    maxFrames = 16,
    timeoutMs = 1_000,
  ): Promise<unknown> {
    for (let index = 0; index < maxFrames; index += 1) {
      const frame = await this.next(timeoutMs);
      if (predicate(frame)) return frame;
    }
    throw new Error(`MessagePort predicate did not match within ${maxFrames} frames`);
  }

  dispose(): void {
    this.#port.removeEventListener('message', this.#onMessage);
    for (const waiter of this.#waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('MessagePort inbox disposed'));
    }
  }
}

export function frameType(frame: unknown): string | undefined {
  if (frame === null || typeof frame !== 'object') return undefined;
  return (frame as { type?: unknown }).type as string | undefined;
}

export function closeChannel(channel: MessageChannel): void {
  channel.port1.close();
  channel.port2.close();
}
