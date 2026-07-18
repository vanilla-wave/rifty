import { describe, expect, it, vi } from 'vitest';
import {
  PortInbox,
  closeChannel,
  frameType,
  realEsbuildWasmBytes,
  shadowAssetPortApi,
  shadowAssetPortExports,
  smallPortFixture,
  tarballPortFixture,
} from './shadow-asset-message-port.test-support.ts';
import {
  SHADOW_ASSET_MAX_READ_DEADLINE_MS,
  ShadowAssetError,
  type ShadowAssetProgress,
  ShadowAssetReadError,
  type ShadowAssetReadOptions,
  type ShadowAssetRuntimeReader,
  type ShadowAssetSourceRequest,
  ShadowAssetStoreError,
  createMemoryShadowAssetStorage,
  createShadowAssetManager,
} from './shadow-assets.ts';

function successfulReader(bytes: Uint8Array): ShadowAssetRuntimeReader {
  return Object.freeze({ readVerified: async () => bytes.slice() });
}

describe('shadow asset MessagePort public contract', () => {
  it('exports only the named capability, factories, and nominal port error adapter surface', () => {
    const exports = shadowAssetPortExports();

    expect(exports.SHADOW_ASSET_CAPABILITY).toBe('rifty.shadow-assets.v1');
    expect(exports.ShadowAssetPortError).toBeTypeOf('function');
    expect(exports.startShadowAssetPortServer).toBeTypeOf('function');
    expect(exports.createShadowAssetPortClient).toBeTypeOf('function');
  });

  it('constructs one exact snapshotted ShadowAssetPortError shape', () => {
    const api = shadowAssetPortApi();
    const cause = Object.assign(new Error('peer reset'), { code: 'ECONNRESET' });
    const failure = {
      message: 'asset channel closed',
      phase: 'closed' as const,
      assetId: 'runtime',
      cause,
    };
    const error = new api.ShadowAssetPortError(failure);
    failure.message = 'mutated after construction';

    expect(error).toMatchObject({
      name: 'ShadowAssetPortError',
      code: 'ESHADOWASSETPORT',
      message: 'asset channel closed',
      phase: 'closed',
      assetId: 'runtime',
      cause,
    });
    expect(
      () =>
        new api.ShadowAssetPortError({
          message: 'bad',
          phase: 'closed',
          extra: true,
        } as never),
    ).toThrowError(TypeError);
    expect(
      () =>
        new api.ShadowAssetPortError(
          Object.defineProperty({ message: 'bad', phase: 'closed' }, 'assetId', {
            enumerable: true,
            get: () => 'runtime',
          }),
        ),
    ).toThrowError(TypeError);
  });

  it('validates and snapshots the exact plan and starts both ports before returning', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const serverStart = vi.spyOn(channel.port1, 'start');
    const clientStart = vi.spyOn(channel.port2, 'start');
    try {
      const server = api.startShadowAssetPortServer({
        port: channel.port1,
        plan: fixture.plan,
        reader: successfulReader(fixture.bytes),
      });
      const client = api.createShadowAssetPortClient({ port: channel.port2, plan: fixture.plan });

      expect(serverStart).toHaveBeenCalledTimes(1);
      expect(clientStart).toHaveBeenCalledTimes(1);
      (fixture.plan.assets as unknown as Array<{ id: string }>)[0]!.id = 'mutated';
      await expect(
        client.readVerified('esbuild-wasm@0.28.0/package/esbuild.wasm'),
      ).resolves.toEqual(fixture.bytes);
      await Promise.all([client.dispose(), server.dispose()]);
    } finally {
      closeChannel(channel);
    }
  });

  it('rejects malformed factory options and plans synchronously before adopting a port', () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const malformedPlan = { ...fixture.plan, extra: true };
    const channel = new MessageChannel();
    const start = vi.spyOn(channel.port1, 'start');
    try {
      expect(() =>
        api.startShadowAssetPortServer({
          port: channel.port1,
          plan: malformedPlan as never,
          reader: successfulReader(fixture.bytes),
        }),
      ).toThrowError(TypeError);
      expect(start).not.toHaveBeenCalled();
      expect(() =>
        api.createShadowAssetPortClient({
          port: channel.port1,
          plan: fixture.plan,
          extra: true,
        } as never),
      ).toThrowError(TypeError);
      expect(start).not.toHaveBeenCalled();
    } finally {
      closeChannel(channel);
    }
  });
});

describe('shadow asset MessagePort parity', () => {
  it('transfers the real 13,918,738-byte esbuild member through one real MessageChannel', async () => {
    const api = shadowAssetPortApi();
    const fixture = tarballPortFixture(realEsbuildWasmBytes());
    expect(fixture.bytes.byteLength).toBe(13_918_738);
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: fixture.source,
    });
    await manager.installer.ensure(fixture.plan);
    const directReader = manager.runtimeReader(fixture.plan);
    const direct = await directReader.readVerified(fixture.plan.assets[0]!.id);
    let responseOwnedBytes: Uint8Array | undefined;
    const reader: ShadowAssetRuntimeReader = {
      readVerified: async (assetId, options) => {
        responseOwnedBytes = await directReader.readVerified(assetId, options);
        return responseOwnedBytes;
      },
    };
    const channel = new MessageChannel();
    const post = vi.spyOn(channel.port1, 'postMessage');
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader,
    });
    const client = api.createShadowAssetPortClient({ port: channel.port2, plan: fixture.plan });
    try {
      const received = await client.readVerified(fixture.plan.assets[0]!.id);
      expect(received).toEqual(direct);
      expect(received.byteLength).toBe(13_918_738);
      expect(responseOwnedBytes?.byteLength).toBe(13_918_738);
      expect(fixture.acquisitionCount()).toBe(1);

      const resultCall = post.mock.calls.find(([frame]) => frameType(frame) === 'result');
      expect(resultCall).toBeDefined();
      const resultFrame = resultCall?.[0] as { bytes?: unknown } | undefined;
      const transferArgument = resultCall?.[1] as unknown;
      const transferList = Array.isArray(transferArgument)
        ? transferArgument
        : (transferArgument as { transfer?: unknown } | undefined)?.transfer;
      expect(Array.isArray(transferList)).toBe(true);
      expect(transferList).toHaveLength(1);
      expect((transferList as readonly unknown[])[0]).toBe(resultFrame?.bytes);
      expect(resultFrame?.bytes).toBeInstanceOf(ArrayBuffer);
    } finally {
      await Promise.all([client.dispose(), server.dispose(), manager.close()]);
      closeChannel(channel);
    }
  }, 20_000);

  it('keeps local signal/progress objects off-wire and forwards their behavior', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const clientPost = vi.spyOn(channel.port2, 'postMessage');
    const serverPost = vi.spyOn(channel.port1, 'postMessage');
    let receivedOptions: ShadowAssetReadOptions | undefined;
    const reader: ShadowAssetRuntimeReader = {
      readVerified: async (_assetId, options) => {
        receivedOptions = options;
        options?.onProgress?.({
          phase: 'verify',
          assetId: fixture.plan.assets[0]!.id,
          assetIndex: 0,
          assetCount: 1,
        });
        return fixture.bytes.slice();
      },
    };
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader,
    });
    const client = api.createShadowAssetPortClient({ port: channel.port2, plan: fixture.plan });
    const progress: ShadowAssetProgress[] = [];
    const controller = new AbortController();
    try {
      await expect(
        client.readVerified(fixture.plan.assets[0]!.id, {
          deadlineMs: 37,
          signal: controller.signal,
          onProgress: (event) => progress.push(event),
        }),
      ).resolves.toEqual(fixture.bytes);

      expect(receivedOptions?.deadlineMs).toBe(37);
      expect(receivedOptions?.signal).toBeInstanceOf(AbortSignal);
      expect(receivedOptions?.signal).not.toBe(controller.signal);
      expect(receivedOptions?.onProgress).toBeTypeOf('function');
      expect(progress.map((event) => event.phase)).toEqual(['verify']);

      const readFrame = clientPost.mock.calls.find(([frame]) => frameType(frame) === 'read')?.[0];
      expect(Object.keys(readFrame as object).sort()).toEqual([
        'assetId',
        'deadlineMs',
        'protocol',
        'requestId',
        'type',
      ]);
      expect(readFrame).toMatchObject({
        protocol: 'rifty.shadow-assets/v1',
        type: 'read',
        deadlineMs: 37,
      });
      const progressFrame = serverPost.mock.calls.find(
        ([frame]) => frameType(frame) === 'progress',
      )?.[0];
      expect(Object.keys(progressFrame as object).sort()).toEqual([
        'progress',
        'protocol',
        'requestId',
        'type',
      ]);
    } finally {
      await Promise.all([client.dispose(), server.dispose()]);
      closeChannel(channel);
    }
  });

  it('uses the one exported deadline default and positive smaller call deadlines', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const inbox = new PortInbox(channel.port2);
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader: successfulReader(fixture.bytes),
    });
    try {
      channel.port2.postMessage({
        protocol: 'rifty.shadow-assets/v1',
        type: 'read',
        requestId: 1,
        assetId: fixture.plan.assets[0]!.id,
        deadlineMs: SHADOW_ASSET_MAX_READ_DEADLINE_MS,
      });
      await expect(inbox.until((frame) => frameType(frame) === 'result')).resolves.toMatchObject({
        requestId: 1,
        type: 'result',
      });

      const clientChannel = new MessageChannel();
      const raw = new PortInbox(clientChannel.port2);
      const client = api.createShadowAssetPortClient({
        port: clientChannel.port1,
        plan: fixture.plan,
      });
      try {
        const defaultRead = client.readVerified(fixture.plan.assets[0]!.id);
        const defaultFrame = await raw.next();
        expect(defaultFrame).toMatchObject({ deadlineMs: SHADOW_ASSET_MAX_READ_DEADLINE_MS });
        const defaultRequestId = (defaultFrame as { requestId: number }).requestId;
        clientChannel.port2.postMessage(
          {
            protocol: 'rifty.shadow-assets/v1',
            type: 'result',
            requestId: defaultRequestId,
            assetId: fixture.plan.assets[0]!.id,
            sha256: fixture.plan.assets[0]!.memberSha256,
            bytes: fixture.bytes.slice().buffer,
          },
          [],
        );
        await expect(defaultRead).resolves.toEqual(fixture.bytes);

        await expect(
          client.readVerified(fixture.plan.assets[0]!.id, {
            deadlineMs: SHADOW_ASSET_MAX_READ_DEADLINE_MS + 1,
          }),
        ).rejects.toBeInstanceOf(TypeError);
        await client.dispose();
      } finally {
        raw.dispose();
        closeChannel(clientChannel);
      }
    } finally {
      await server.dispose();
      inbox.dispose();
      closeChannel(channel);
    }
  });

  it('keeps monotonic positive request ids and ignores a late terminal for a settled id', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const inbox = new PortInbox(channel.port2);
    const client = api.createShadowAssetPortClient({ port: channel.port1, plan: fixture.plan });
    try {
      const first = client.readVerified(fixture.plan.assets[0]!.id);
      const firstFrame = (await inbox.next()) as { requestId: number };
      channel.port2.postMessage({
        protocol: 'rifty.shadow-assets/v1',
        type: 'error',
        requestId: firstFrame.requestId,
        error: {
          name: 'ShadowAssetReadError',
          code: 'ESHADOWASSETREAD',
          message: 'unknown shadow asset',
          assetId: fixture.plan.assets[0]!.id,
          reason: 'unknown-asset',
        },
      });
      await expect(first).rejects.toBeInstanceOf(ShadowAssetReadError);

      channel.port2.postMessage({
        protocol: 'rifty.shadow-assets/v1',
        type: 'error',
        requestId: firstFrame.requestId,
        error: {
          name: 'ShadowAssetPortError',
          code: 'ESHADOWASSETPORT',
          message: 'late frame',
          phase: 'receive',
        },
      });
      const second = client.readVerified(fixture.plan.assets[0]!.id);
      const secondFrame = (await inbox.next()) as { requestId: number };
      expect(firstFrame.requestId).toBe(1);
      expect(secondFrame.requestId).toBe(2);
      channel.port2.postMessage(
        {
          protocol: 'rifty.shadow-assets/v1',
          type: 'result',
          requestId: secondFrame.requestId,
          assetId: fixture.plan.assets[0]!.id,
          sha256: fixture.plan.assets[0]!.memberSha256,
          bytes: fixture.bytes.slice().buffer,
        },
        [],
      );
      await expect(second).resolves.toEqual(fixture.bytes);
    } finally {
      await client.dispose();
      inbox.dispose();
      closeChannel(channel);
    }
  });

  it('returns the manager-owned unknown-asset class without calling a broader authority', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const reader = { readVerified: vi.fn(async () => fixture.bytes.slice()) };
    const channel = new MessageChannel();
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader,
    });
    const client = api.createShadowAssetPortClient({ port: channel.port2, plan: fixture.plan });
    try {
      await expect(client.readVerified('foreign-asset')).rejects.toMatchObject({
        name: 'ShadowAssetReadError',
        code: 'ESHADOWASSETREAD',
        assetId: 'foreign-asset',
        reason: 'unknown-asset',
      });
      expect(reader.readVerified).not.toHaveBeenCalled();
    } finally {
      await Promise.all([client.dispose(), server.dispose()]);
      closeChannel(channel);
    }
  });

  it('reconstructs direct ShadowAssetError with every public field and one sanitized cause', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const direct = new ShadowAssetError({
      message: 'verified object changed',
      requiredSetDigest: fixture.plan.requiredSetDigest,
      assetId: fixture.plan.assets[0]!.id,
      phase: 'verify',
      transports: [{ transport: 'standard', message: 'digest mismatch' }],
      recovery: 'clear-and-retry',
      usedBytes: 41,
      requiredBytes: 42,
      cause: Object.assign(new Error('upstream detail'), { code: 'EBADMSG' }),
    });
    const reader: ShadowAssetRuntimeReader = {
      readVerified: async () => {
        throw direct;
      },
    };
    const channel = new MessageChannel();
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader,
    });
    const client = api.createShadowAssetPortClient({ port: channel.port2, plan: fixture.plan });
    try {
      const failure = await client.readVerified(fixture.plan.assets[0]!.id).catch((error) => error);
      expect(failure).toBeInstanceOf(ShadowAssetError);
      expect(failure).toMatchObject({
        name: 'ShadowAssetError',
        code: 'ESHADOWASSET',
        message: direct.message,
        requiredSetDigest: direct.requiredSetDigest,
        assetId: direct.assetId,
        phase: direct.phase,
        transports: direct.transports,
        recovery: direct.recovery,
        usedBytes: direct.usedBytes,
        requiredBytes: direct.requiredBytes,
        cause: { name: 'Error', code: 'EBADMSG', message: 'upstream detail' },
      });
      expect((failure as { cause?: unknown }).cause).not.toBeInstanceOf(Error);
      expect((failure as { cause?: { stack?: unknown } }).cause?.stack).toBeUndefined();
    } finally {
      await Promise.all([client.dispose(), server.dispose()]);
      closeChannel(channel);
    }
  });

  it('reconstructs direct unknown-asset failures with the same nominal prototype', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const direct = new ShadowAssetReadError({
      message: 'unknown shadow asset runtime',
      assetId: 'runtime',
      reason: 'unknown-asset',
      cause: Object.assign(new Error('catalog detail'), { code: 'ENOENT' }),
    });
    const channel = new MessageChannel();
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader: {
        readVerified: async () => {
          throw direct;
        },
      },
    });
    const client = api.createShadowAssetPortClient({ port: channel.port2, plan: fixture.plan });
    try {
      const failure = await client.readVerified(fixture.plan.assets[0]!.id).catch((error) => error);
      expect(failure).toBeInstanceOf(ShadowAssetReadError);
      expect(failure).toMatchObject({
        name: 'ShadowAssetReadError',
        code: 'ESHADOWASSETREAD',
        message: direct.message,
        assetId: direct.assetId,
        reason: 'unknown-asset',
        cause: { name: 'Error', code: 'ENOENT', message: 'catalog detail' },
      });
    } finally {
      await Promise.all([client.dispose(), server.dispose()]);
      closeChannel(channel);
    }
  });

  it.each([
    [
      'direct deadline',
      new ShadowAssetReadError({
        message: 'internal deadline detail',
        assetId: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
        reason: 'deadline',
        deadlineMs: 5,
      }),
      'deadline',
      'Shadow asset read deadline exceeded',
    ],
    [
      'manager lifecycle',
      new ShadowAssetStoreError({
        message: 'shadow asset manager is clearing',
        phase: 'inspect',
        recovery: 'retry',
      }),
      'closed',
      'Shadow asset authority is unavailable',
    ],
  ] as const)(
    'maps %s to the exact port-lifecycle error without leaking internal fields',
    async (_label, direct, phase, message) => {
      const api = shadowAssetPortApi();
      const fixture = smallPortFixture();
      const channel = new MessageChannel();
      const server = api.startShadowAssetPortServer({
        port: channel.port1,
        plan: fixture.plan,
        reader: {
          readVerified: async () => {
            throw direct;
          },
        },
      });
      const client = api.createShadowAssetPortClient({ port: channel.port2, plan: fixture.plan });
      try {
        const failure = await client
          .readVerified(fixture.plan.assets[0]!.id)
          .catch((error) => error);
        expect(failure).toBeInstanceOf(api.ShadowAssetPortError);
        expect(failure).toMatchObject({
          name: 'ShadowAssetPortError',
          code: 'ESHADOWASSETPORT',
          phase,
          assetId: fixture.plan.assets[0]!.id,
          message,
        });
        expect((failure as { cause?: unknown }).cause).toBeUndefined();
        expect(failure).not.toHaveProperty('reason');
        expect(failure).not.toHaveProperty('recovery');
      } finally {
        await Promise.all([client.dispose(), server.dispose()]);
        closeChannel(channel);
      }
    },
  );

  it('joins one real manager flight across sessions while one local caller cancels', async () => {
    const api = shadowAssetPortApi();
    const fixture = tarballPortFixture(new TextEncoder().encode('shared-runtime'));
    let admit!: () => void;
    let release!: () => void;
    const admitted = new Promise<void>((resolve) => {
      admit = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sourceCalls = 0;
    const source = {
      acquire: async (requests: readonly ShadowAssetSourceRequest[]) => {
        sourceCalls += 1;
        admit();
        await gate;
        return await fixture.source.acquire(requests, {
          signal: new AbortController().signal,
        });
      },
      close: async () => undefined,
    };
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source,
    });
    const ensure = manager.installer.ensure(fixture.plan);
    await admitted;
    const firstChannel = new MessageChannel();
    const secondChannel = new MessageChannel();
    const firstServer = api.startShadowAssetPortServer({
      port: firstChannel.port1,
      plan: fixture.plan,
      reader: manager.runtimeReader(fixture.plan),
    });
    const secondServer = api.startShadowAssetPortServer({
      port: secondChannel.port1,
      plan: fixture.plan,
      reader: manager.runtimeReader(fixture.plan),
    });
    const firstClient = api.createShadowAssetPortClient({
      port: firstChannel.port2,
      plan: fixture.plan,
    });
    const secondClient = api.createShadowAssetPortClient({
      port: secondChannel.port2,
      plan: fixture.plan,
    });
    const controller = new AbortController();
    try {
      const cancelled = firstClient.readVerified(fixture.plan.assets[0]!.id, {
        signal: controller.signal,
      });
      const survivor = secondClient.readVerified(fixture.plan.assets[0]!.id);
      controller.abort();
      await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
      release();
      await expect(ensure).resolves.toMatchObject({ kind: 'ready' });
      await expect(survivor).resolves.toEqual(fixture.bytes);
      expect(sourceCalls).toBe(1);
      expect(fixture.acquisitionCount()).toBe(1);
    } finally {
      release();
      await Promise.allSettled([
        ensure,
        firstClient.dispose(),
        secondClient.dispose(),
        firstServer.dispose(),
        secondServer.dispose(),
        manager.close(),
      ]);
      closeChannel(firstChannel);
      closeChannel(secondChannel);
    }
  });
});
