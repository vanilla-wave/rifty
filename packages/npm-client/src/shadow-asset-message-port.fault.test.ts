import { describe, expect, it, vi } from 'vitest';
import {
  PortInbox,
  closeChannel,
  frameType,
  shadowAssetPortApi,
  smallPortFixture,
} from './shadow-asset-message-port.test-support.ts';
import {
  SHADOW_ASSET_MAX_READ_DEADLINE_MS,
  type ShadowAssetReadOptions,
  type ShadowAssetRuntimeReader,
} from './shadow-assets.ts';

function resultFrame(
  requestId: number,
  fixture: ReturnType<typeof smallPortFixture>,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    protocol: 'rifty.shadow-assets/v1',
    type: 'result',
    requestId,
    assetId: fixture.plan.assets[0]!.id,
    sha256: fixture.plan.assets[0]!.memberSha256,
    bytes: fixture.bytes.slice().buffer,
    ...overrides,
  };
}

function readFrame(
  requestId: number,
  fixture: ReturnType<typeof smallPortFixture>,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    protocol: 'rifty.shadow-assets/v1',
    type: 'read',
    requestId,
    assetId: fixture.plan.assets[0]!.id,
    deadlineMs: 250,
    ...overrides,
  };
}

function progressFrame(
  requestId: number,
  fixture: ReturnType<typeof smallPortFixture>,
): Readonly<Record<string, unknown>> {
  return {
    protocol: 'rifty.shadow-assets/v1',
    type: 'progress',
    requestId,
    progress: {
      phase: 'cache-check',
      assetId: fixture.plan.assets[0]!.id,
      assetIndex: 0,
      assetCount: 1,
    },
  };
}

function stalledReader(
  onOptions?: (options: ShadowAssetReadOptions) => void,
): ShadowAssetRuntimeReader {
  return {
    readVerified: async (_assetId, options = {}) => {
      onOptions?.(options);
      return await new Promise<Uint8Array>((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted', 'AbortError')),
          { once: true },
        );
      });
    },
  };
}

describe('shadow asset MessagePort corrupt-input faults', () => {
  it.each([
    [
      'version drift',
      (id: number, fixture: ReturnType<typeof smallPortFixture>) =>
        resultFrame(id, fixture, { protocol: 'rifty.shadow-assets/v2' }),
    ],
    [
      'extra result key',
      (id: number, fixture: ReturnType<typeof smallPortFixture>) =>
        resultFrame(id, fixture, { manager: {} }),
    ],
    [
      'truncated bytes',
      (id: number, fixture: ReturnType<typeof smallPortFixture>) =>
        resultFrame(id, fixture, { bytes: fixture.bytes.slice(0, -1).buffer }),
    ],
    [
      'oversize bytes',
      (id: number, fixture: ReturnType<typeof smallPortFixture>) =>
        resultFrame(id, fixture, { bytes: new Uint8Array(fixture.bytes.byteLength + 1).buffer }),
    ],
    [
      'wrong descriptor hash',
      (id: number, fixture: ReturnType<typeof smallPortFixture>) =>
        resultFrame(id, fixture, { sha256: 'f'.repeat(64) }),
    ],
    [
      'wrong result asset',
      (id: number, fixture: ReturnType<typeof smallPortFixture>) =>
        resultFrame(id, fixture, { assetId: 'foreign' }),
    ],
    [
      'array-buffer view',
      (id: number, fixture: ReturnType<typeof smallPortFixture>) =>
        resultFrame(id, fixture, { bytes: fixture.bytes.slice() }),
    ],
    [
      'terminal id never issued',
      (_id: number, fixture: ReturnType<typeof smallPortFixture>) => resultFrame(2, fixture),
    ],
    [
      'error stack leakage',
      (id: number) => ({
        protocol: 'rifty.shadow-assets/v1',
        type: 'error',
        requestId: id,
        error: {
          name: 'ShadowAssetPortError',
          code: 'ESHADOWASSETPORT',
          message: 'peer failed',
          phase: 'receive',
          stack: 'private stack',
        },
      }),
    ],
    [
      'manager-local store envelope',
      (id: number) => ({
        protocol: 'rifty.shadow-assets/v1',
        type: 'error',
        requestId: id,
        error: {
          name: 'ShadowAssetStoreError',
          code: 'ESHADOWASSETSTORE',
          message: 'private store detail',
          phase: 'clear',
          recovery: 'clear-and-retry',
        },
      }),
    ],
    [
      'nested cause envelope',
      (id: number) => ({
        protocol: 'rifty.shadow-assets/v1',
        type: 'error',
        requestId: id,
        error: {
          name: 'ShadowAssetPortError',
          code: 'ESHADOWASSETPORT',
          message: 'peer failed',
          phase: 'receive',
          cause: {
            name: 'Error',
            message: 'first',
            cause: { name: 'Error', message: 'second' },
          },
        },
      }),
    ],
    [
      'invalid progress index',
      (id: number, fixture: ReturnType<typeof smallPortFixture>) => ({
        protocol: 'rifty.shadow-assets/v1',
        type: 'progress',
        requestId: id,
        progress: {
          phase: 'verify',
          assetId: fixture.plan.assets[0]!.id,
          assetIndex: 1,
          assetCount: 1,
        },
      }),
    ],
  ])('client rejects %s and permanently fails the session', async (_label, malformed) => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const inbox = new PortInbox(channel.port2);
    const client = api.createShadowAssetPortClient({ port: channel.port1, plan: fixture.plan });
    try {
      const pending = client.readVerified(fixture.plan.assets[0]!.id);
      const request = (await inbox.next()) as { requestId: number };
      channel.port2.postMessage(malformed(request.requestId, fixture));

      await expect(pending).rejects.toMatchObject({
        name: 'ShadowAssetPortError',
        code: 'ESHADOWASSETPORT',
        phase: 'decode',
      });
      await expect(client.readVerified(fixture.plan.assets[0]!.id)).rejects.toMatchObject({
        code: 'ESHADOWASSETPORT',
      });
    } finally {
      await client.dispose();
      inbox.dispose();
      closeChannel(channel);
    }
  });

  it.each([
    [
      'version drift',
      (fixture: ReturnType<typeof smallPortFixture>) =>
        readFrame(2, fixture, { protocol: 'rifty.shadow-assets/v2' }),
    ],
    [
      'extra read key',
      (fixture: ReturnType<typeof smallPortFixture>) => readFrame(2, fixture, { storage: {} }),
    ],
    [
      'deadline above fixed ceiling',
      (fixture: ReturnType<typeof smallPortFixture>) =>
        readFrame(2, fixture, { deadlineMs: SHADOW_ASSET_MAX_READ_DEADLINE_MS + 1 }),
    ],
    [
      'duplicate active request id',
      (fixture: ReturnType<typeof smallPortFixture>) => readFrame(1, fixture),
    ],
    [
      'invalid non-positive request id',
      (fixture: ReturnType<typeof smallPortFixture>) => readFrame(0, fixture),
    ],
  ])('server rejects %s and settles every admitted request', async (_label, malformed) => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    let serverSignal: AbortSignal | undefined;
    const channel = new MessageChannel();
    const inbox = new PortInbox(channel.port2);
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader: stalledReader((options) => {
        serverSignal = options.signal;
      }),
    });
    try {
      channel.port2.postMessage(readFrame(1, fixture));
      await vi.waitFor(() => expect(serverSignal).toBeInstanceOf(AbortSignal));
      channel.port2.postMessage(malformed(fixture));
      const terminal = await inbox.until((frame) => frameType(frame) === 'error');
      expect(terminal).toMatchObject({
        protocol: 'rifty.shadow-assets/v1',
        type: 'error',
        requestId: 1,
        error: {
          name: 'ShadowAssetPortError',
          code: 'ESHADOWASSETPORT',
          phase: 'decode',
        },
      });
      await vi.waitFor(() => expect(serverSignal?.aborted).toBe(true));
    } finally {
      await server.dispose();
      inbox.dispose();
      closeChannel(channel);
    }
  });

  it('server rejects a newly admitted request id lower than its monotonic high-water mark', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    let serverSignal: AbortSignal | undefined;
    const channel = new MessageChannel();
    const inbox = new PortInbox(channel.port2);
    const reader = stalledReader((options) => {
      serverSignal = options.signal;
    });
    const readVerified = vi.spyOn(reader, 'readVerified');
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader,
    });
    try {
      channel.port2.postMessage(readFrame(2, fixture));
      await vi.waitFor(() => expect(serverSignal).toBeInstanceOf(AbortSignal));
      channel.port2.postMessage(readFrame(1, fixture));
      const terminal = await inbox.until((frame) => frameType(frame) === 'error');
      expect(terminal).toMatchObject({
        requestId: 2,
        error: { code: 'ESHADOWASSETPORT', phase: 'decode' },
      });
      await vi.waitFor(() => expect(serverSignal?.aborted).toBe(true));
      expect(readVerified).toHaveBeenCalledTimes(1);
    } finally {
      await server.dispose();
      inbox.dispose();
      closeChannel(channel);
    }
  });

  it.each([
    [
      'accessor',
      (fixture: ReturnType<typeof smallPortFixture>) =>
        Object.defineProperty(resultFrame(1, fixture), 'assetId', {
          enumerable: true,
          get: () => fixture.plan.assets[0]!.id,
        }),
    ],
    [
      'enumerable symbol',
      (fixture: ReturnType<typeof smallPortFixture>) => {
        const frame = { ...resultFrame(1, fixture) };
        Object.defineProperty(frame, Symbol('private'), { enumerable: true, value: true });
        return frame;
      },
    ],
    [
      'wrong prototype',
      (fixture: ReturnType<typeof smallPortFixture>) =>
        Object.assign(Object.create({ inherited: true }) as object, resultFrame(1, fixture)),
    ],
  ])('rejects locally dispatched hostile %s keys before byte publication', async (_label, make) => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const client = api.createShadowAssetPortClient({ port: channel.port1, plan: fixture.plan });
    try {
      const pending = client.readVerified(fixture.plan.assets[0]!.id);
      channel.port1.dispatchEvent(new MessageEvent('message', { data: make(fixture) }));
      await expect(pending).rejects.toMatchObject({
        code: 'ESHADOWASSETPORT',
        phase: 'decode',
      });
    } finally {
      await client.dispose();
      closeChannel(channel);
    }
  });
});

describe('shadow asset MessagePort bounded lifecycle faults', () => {
  it('rejects null read options instead of treating them as defaults', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const post = vi.spyOn(channel.port1, 'postMessage');
    const client = api.createShadowAssetPortClient({ port: channel.port1, plan: fixture.plan });
    try {
      const pending = client.readVerified(fixture.plan.assets[0]!.id, null as never);
      void pending.catch(() => undefined);
      await Promise.resolve();
      expect(post.mock.calls.filter(([frame]) => frameType(frame) === 'read')).toHaveLength(0);
      await expect(pending).rejects.toBeInstanceOf(TypeError);
    } finally {
      await client.dispose();
      closeChannel(channel);
    }
  });

  it('returns a rejected promise for an empty asset id without throwing synchronously', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const client = api.createShadowAssetPortClient({ port: channel.port1, plan: fixture.plan });
    try {
      let pending: Promise<Uint8Array> | undefined;
      expect(() => {
        pending = client.readVerified('');
      }).not.toThrow();
      await expect(pending).rejects.toBeInstanceOf(TypeError);
    } finally {
      await client.dispose();
      closeChannel(channel);
    }
  });

  it('starts the server deadline before read admission and aborts a stalled reader', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    let options: ShadowAssetReadOptions | undefined;
    const channel = new MessageChannel();
    const inbox = new PortInbox(channel.port2);
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader: stalledReader((value) => {
        options = value;
      }),
    });
    const startedAt = performance.now();
    try {
      channel.port2.postMessage(readFrame(1, fixture, { deadlineMs: 20 }));
      const terminal = await inbox.until((frame) => frameType(frame) === 'error', 4, 500);
      expect(performance.now() - startedAt).toBeLessThan(500);
      expect(options?.deadlineMs).toBe(20);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(options?.signal?.aborted).toBe(true);
      expect(terminal).toMatchObject({
        requestId: 1,
        error: {
          name: 'ShadowAssetPortError',
          code: 'ESHADOWASSETPORT',
          phase: 'deadline',
          assetId: fixture.plan.assets[0]!.id,
        },
      });
    } finally {
      await server.dispose();
      inbox.dispose();
      closeChannel(channel);
    }
  });

  it('bounds a silent peer on the client within the fixed ceiling', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const inbox = new PortInbox(channel.port2);
    const client = api.createShadowAssetPortClient({ port: channel.port1, plan: fixture.plan });
    const startedAt = performance.now();
    try {
      const pending = client.readVerified(fixture.plan.assets[0]!.id, { deadlineMs: 20 });
      await inbox.next();
      await expect(pending).rejects.toMatchObject({
        name: 'ShadowAssetPortError',
        code: 'ESHADOWASSETPORT',
        phase: 'deadline',
        assetId: fixture.plan.assets[0]!.id,
      });
      expect(performance.now() - startedAt).toBeLessThan(500);
    } finally {
      await client.dispose();
      inbox.dispose();
      closeChannel(channel);
    }
  });

  it('maps a synchronous postMessage failure to send and admits no pending hang', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const client = api.createShadowAssetPortClient({ port: channel.port1, plan: fixture.plan });
    const post = vi.spyOn(channel.port1, 'postMessage').mockImplementation(() => {
      throw new DOMException('cannot clone', 'DataCloneError');
    });
    try {
      await expect(client.readVerified(fixture.plan.assets[0]!.id)).rejects.toMatchObject({
        name: 'ShadowAssetPortError',
        code: 'ESHADOWASSETPORT',
        phase: 'send',
        assetId: fixture.plan.assets[0]!.id,
      });
    } finally {
      post.mockRestore();
      await client.dispose();
      closeChannel(channel);
    }
  });

  it('client dispose rejects pending reads, sends one dispose, removes listeners, and closes once', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const inbox = new PortInbox(channel.port2);
    const post = vi.spyOn(channel.port1, 'postMessage');
    const close = vi.spyOn(channel.port1, 'close');
    const client = api.createShadowAssetPortClient({ port: channel.port1, plan: fixture.plan });
    try {
      const pending = client.readVerified(fixture.plan.assets[0]!.id);
      await inbox.next();
      await Promise.all([client.dispose(), client.dispose()]);
      await expect(pending).rejects.toMatchObject({
        code: 'ESHADOWASSETPORT',
        phase: 'dispose',
      });
      expect(post.mock.calls.filter(([frame]) => frameType(frame) === 'dispose')).toHaveLength(1);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      inbox.dispose();
      closeChannel(channel);
    }
  });

  it('fences new client reads synchronously when disposal is claimed', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const post = vi.spyOn(channel.port1, 'postMessage');
    const client = api.createShadowAssetPortClient({ port: channel.port1, plan: fixture.plan });
    try {
      const disposal = client.dispose();
      const read = client.readVerified(fixture.plan.assets[0]!.id);

      await expect(read).rejects.toMatchObject({
        code: 'ESHADOWASSETPORT',
        phase: 'dispose',
      });
      await disposal;
      expect(post.mock.calls.filter(([frame]) => frameType(frame) === 'read')).toHaveLength(0);
      expect(post.mock.calls.filter(([frame]) => frameType(frame) === 'dispose')).toHaveLength(1);
    } finally {
      closeChannel(channel);
    }
  });

  it('server dispose emits one terminal error, aborts reads, removes listeners, and closes once', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    let signal: AbortSignal | undefined;
    const channel = new MessageChannel();
    const inbox = new PortInbox(channel.port2);
    const close = vi.spyOn(channel.port1, 'close');
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader: stalledReader((options) => {
        signal = options.signal;
      }),
    });
    try {
      channel.port2.postMessage(readFrame(1, fixture));
      await vi.waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
      await Promise.all([server.dispose(), server.dispose()]);
      const terminal = await inbox.until((frame) => frameType(frame) === 'error');
      expect(terminal).toMatchObject({
        requestId: 1,
        error: {
          name: 'ShadowAssetPortError',
          code: 'ESHADOWASSETPORT',
          phase: 'dispose',
        },
      });
      expect(signal?.aborted).toBe(true);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      inbox.dispose();
      closeChannel(channel);
    }
  });

  it('fences synchronously dispatched server reads when disposal is claimed', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const readVerified = vi.fn(stalledReader().readVerified);
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader: { readVerified },
    });
    try {
      const disposal = server.dispose();
      channel.port1.dispatchEvent(new MessageEvent('message', { data: readFrame(1, fixture) }));

      await disposal;
      expect(readVerified).not.toHaveBeenCalled();
    } finally {
      closeChannel(channel);
    }
  });

  it('treats one peer dispose frame as idempotent server shutdown', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    let signal: AbortSignal | undefined;
    const channel = new MessageChannel();
    const close = vi.spyOn(channel.port1, 'close');
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader: stalledReader((options) => {
        signal = options.signal;
      }),
    });
    try {
      channel.port2.postMessage(readFrame(1, fixture));
      await vi.waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
      channel.port2.postMessage({ protocol: 'rifty.shadow-assets/v1', type: 'dispose' });
      await vi.waitFor(() => expect(signal?.aborted).toBe(true));
      await server.dispose();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      closeChannel(channel);
    }
  });

  it('abrupt peer close settles the client with a typed closed failure', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const inbox = new PortInbox(channel.port2);
    const client = api.createShadowAssetPortClient({ port: channel.port1, plan: fixture.plan });
    try {
      const pending = client.readVerified(fixture.plan.assets[0]!.id, { deadlineMs: 250 });
      await inbox.next();
      channel.port2.close();
      await expect(pending).rejects.toMatchObject({
        name: 'ShadowAssetPortError',
        code: 'ESHADOWASSETPORT',
        phase: 'closed',
      });
    } finally {
      await client.dispose();
      inbox.dispose();
      closeChannel(channel);
    }
  });

  it('caller cancellation rejects locally, sends one cancel, and ignores the late result', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const inbox = new PortInbox(channel.port2);
    const client = api.createShadowAssetPortClient({ port: channel.port1, plan: fixture.plan });
    const controller = new AbortController();
    try {
      const cancelled = client.readVerified(fixture.plan.assets[0]!.id, {
        signal: controller.signal,
      });
      const request = (await inbox.next()) as { requestId: number };
      controller.abort();
      await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
      await expect(inbox.until((frame) => frameType(frame) === 'cancel')).resolves.toMatchObject({
        requestId: request.requestId,
        type: 'cancel',
      });
      channel.port2.postMessage(progressFrame(request.requestId, fixture));
      channel.port2.postMessage(resultFrame(request.requestId, fixture));

      const survivor = client.readVerified(fixture.plan.assets[0]!.id);
      const next = (await inbox.next()) as { requestId: number };
      channel.port2.postMessage(resultFrame(next.requestId, fixture));
      await expect(survivor).resolves.toEqual(fixture.bytes);
      expect(next.requestId).toBe(request.requestId + 1);
    } finally {
      await client.dispose();
      inbox.dispose();
      closeChannel(channel);
    }
  });

  it('ignores queued progress after a local deadline and preserves the next request', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const inbox = new PortInbox(channel.port2);
    const client = api.createShadowAssetPortClient({ port: channel.port1, plan: fixture.plan });
    try {
      const timedOut = client.readVerified(fixture.plan.assets[0]!.id, { deadlineMs: 20 });
      const request = (await inbox.next()) as { requestId: number };
      await expect(timedOut).rejects.toMatchObject({ phase: 'deadline' });
      await inbox.until((frame) => frameType(frame) === 'cancel');
      channel.port2.postMessage(progressFrame(request.requestId, fixture));

      const survivor = client.readVerified(fixture.plan.assets[0]!.id);
      const next = (await inbox.next()) as { requestId: number };
      channel.port2.postMessage(resultFrame(next.requestId, fixture));
      await expect(survivor).resolves.toEqual(fixture.bytes);
    } finally {
      await client.dispose();
      inbox.dispose();
      closeChannel(channel);
    }
  });

  it('isolates a throwing local progress observer like the direct runtime reader', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const clientPost = vi.spyOn(channel.port2, 'postMessage');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader: {
        readVerified: async (_assetId, options) => {
          options?.onProgress?.({
            phase: 'verify',
            assetId: fixture.plan.assets[0]!.id,
            assetIndex: 0,
            assetCount: 1,
          });
          return fixture.bytes.slice();
        },
      },
    });
    const client = api.createShadowAssetPortClient({ port: channel.port2, plan: fixture.plan });
    try {
      await expect(
        client.readVerified(fixture.plan.assets[0]!.id, {
          onProgress: () => {
            throw new Error('presentation failed');
          },
        }),
      ).resolves.toEqual(fixture.bytes);
      expect(clientPost.mock.calls.filter(([frame]) => frameType(frame) === 'cancel')).toHaveLength(
        0,
      );
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      warning.mockRestore();
      await Promise.all([client.dispose(), server.dispose()]);
      closeChannel(channel);
    }
  });

  it('copies through an intrinsic-safe path before transferring reader-owned bytes', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const readerBytes = fixture.bytes.slice();
    Object.defineProperty(readerBytes, 'slice', {
      configurable: true,
      value: () => readerBytes,
    });
    const channel = new MessageChannel();
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader: { readVerified: async () => readerBytes },
    });
    const client = api.createShadowAssetPortClient({ port: channel.port2, plan: fixture.plan });
    try {
      await expect(client.readVerified(fixture.plan.assets[0]!.id)).resolves.toEqual(fixture.bytes);
      expect(readerBytes.byteLength).toBe(fixture.bytes.byteLength);
      expect(readerBytes).toEqual(fixture.bytes);
    } finally {
      await Promise.all([client.dispose(), server.dispose()]);
      closeChannel(channel);
    }
  });

  it('maps unexpected reader errors to receive without cloning raw Error or stack', async () => {
    const api = shadowAssetPortApi();
    const fixture = smallPortFixture();
    const channel = new MessageChannel();
    const post = vi.spyOn(channel.port1, 'postMessage');
    const server = api.startShadowAssetPortServer({
      port: channel.port1,
      plan: fixture.plan,
      reader: {
        readVerified: async () => {
          throw Object.assign(new Error('unexpected reader failure'), { code: 'EIO' });
        },
      },
    });
    const client = api.createShadowAssetPortClient({ port: channel.port2, plan: fixture.plan });
    try {
      const failure = await client.readVerified(fixture.plan.assets[0]!.id).catch((error) => error);
      expect(failure).toBeInstanceOf(api.ShadowAssetPortError);
      expect(failure).toMatchObject({
        code: 'ESHADOWASSETPORT',
        phase: 'receive',
        assetId: fixture.plan.assets[0]!.id,
        cause: { name: 'Error', code: 'EIO', message: 'unexpected reader failure' },
      });
      const errorFrame = post.mock.calls.find(([frame]) => frameType(frame) === 'error')?.[0] as {
        error?: unknown;
      };
      expect(errorFrame.error).not.toBeInstanceOf(Error);
      expect(errorFrame.error).not.toHaveProperty('stack');
      expect(errorFrame.error).not.toHaveProperty('manager');
    } finally {
      await Promise.all([client.dispose(), server.dispose()]);
      closeChannel(channel);
    }
  });
});
