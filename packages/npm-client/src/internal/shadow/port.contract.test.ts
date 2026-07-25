import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryShadowAssetStorage,
  createOriginExclusiveShadowAssetManager,
} from './manager.ts';
import { attestBuiltinShadowSubstitution, planAppliedShadowSubstitutions } from './planner.ts';
import type { ShadowAssetPlan } from './planner.ts';
import * as shadowPortModule from './port.ts';
import {
  ShadowAssetPortError,
  type ShadowAssetPortServer,
  createShadowAssetPortClient,
  serveTrustedReadyShadowAssets,
} from './port.ts';
import { strictShadowPlanCodecCases, validShadowPlan } from './strict-codec.contract-fixtures.ts';

describe('ready-only shadow asset port', () => {
  it.each(strictShadowPlanCodecCases)(
    'strict-decodes $name at manager-owned server construction',
    ({ value }) => {
      const channel = new MessageChannel();
      let server: ShadowAssetPortServer | undefined;
      expect(() => {
        server = serveTrustedReadyShadowAssets(channel.port1, {
          plan: value() as ShadowAssetPlan,
          read: async () => new Uint8Array(),
        });
      }).toThrow(ShadowAssetPortError);
      server?.dispose();
      channel.port1.close();
      channel.port2.close();
    },
  );

  it.each(strictShadowPlanCodecCases)(
    'strict-decodes $name at port-client ready ingress',
    async ({ value }) => {
      const channel = new MessageChannel();
      const client = createShadowAssetPortClient(channel.port2, { deadlineMs: 1_000 });
      channel.port2.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'ready', plan: value(), bindings: validShadowPlan().bindings },
        }),
      );

      await expect(client.ready).rejects.toBeInstanceOf(ShadowAssetPortError);
      channel.port1.close();
    },
  );

  it('keeps ready server construction behind manager ownership', () => {
    expect(shadowPortModule).not.toHaveProperty('serveReadyShadowAssets');
  });

  it('connects manager.serve to the client without a parallel server constructor', async () => {
    const plan = planAppliedShadowSubstitutions([]);
    const manager = createOriginExclusiveShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: {
        acquire: async () => {
          throw new Error('empty plan must not acquire');
        },
      },
    });
    const ready = await manager.ensure(plan);
    const channel = new MessageChannel();
    const server = manager.serve(ready, channel.port1);
    const client = createShadowAssetPortClient(channel.port2, { deadlineMs: 1_000 });

    await expect(client.ready).resolves.toEqual({ plan, bindings: [] });
    await expect(client.read('not-admitted')).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining('not admitted'),
    });
    client.dispose();
    server.dispose();
    await manager.close();
  });

  it('strict-decodes the immediate ready descriptor before correlated reads', async () => {
    const plan = planAppliedShadowSubstitutions([
      attestBuiltinShadowSubstitution({
        trigger: { name: 'esbuild', requestedRange: '0.28.0', version: '0.28.0' },
        installPath: 'node_modules/esbuild',
        acquisition: { kind: 'synthetic' },
      }),
    ]);
    const channel = new MessageChannel();
    const server = serveTrustedReadyShadowAssets(channel.port1, {
      plan,
      read: async () => new Uint8Array([1, 2, 3]),
    });
    const client = createShadowAssetPortClient(channel.port2, { deadlineMs: 1_000 });

    await expect(client.ready).resolves.toMatchObject({
      bindings: [{ adapterId: 'rifty.runtime-adapter.esbuild.v1' }],
    });
    await expect(client.read(plan.assets[0]!.id)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    client.dispose();
    server.dispose();
  });

  it('rejects an accessor frame without invoking its discriminator getter', () => {
    const plan = planAppliedShadowSubstitutions([]);
    const channel = new MessageChannel();
    const server = serveTrustedReadyShadowAssets(channel.port1, {
      plan,
      read: async () => new Uint8Array(),
    });
    let getterRan = false;
    const frame = { id: 1, assetId: 'forged' };
    Object.defineProperty(frame, 'type', {
      enumerable: true,
      get() {
        getterRan = true;
        return 'read';
      },
    });

    channel.port1.dispatchEvent(new MessageEvent('message', { data: frame }));

    expect(getterRan).toBe(false);
    server.dispose();
    channel.port2.close();
  });

  it('rejects an accessor-index ready array without invoking it', async () => {
    const plan = planAppliedShadowSubstitutions([]);
    const channel = new MessageChannel();
    const client = createShadowAssetPortClient(channel.port2, { deadlineMs: 1_000 });
    let getterRan = false;
    const bindings: unknown[] = [{}];
    Object.defineProperty(bindings, '0', {
      enumerable: true,
      get() {
        getterRan = true;
        return {};
      },
    });

    channel.port2.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'ready', plan, bindings },
      }),
    );

    await expect(client.ready).rejects.toThrow(/data element/);
    expect(getterRan).toBe(false);
    channel.port1.close();
  });

  it('owns the read deadline and sends a best-effort downward cancel', async () => {
    const plan = planAppliedShadowSubstitutions([]);
    const channel = new MessageChannel();
    let resolveCancel!: (id: number) => void;
    const cancelled = new Promise<number>((resolve) => {
      resolveCancel = resolve;
    });
    channel.port1.addEventListener('message', (event: MessageEvent<unknown>) => {
      const frame = event.data as { type?: unknown; id?: unknown };
      if (frame.type === 'cancel' && typeof frame.id === 'number') resolveCancel(frame.id);
    });
    channel.port1.start();
    const client = createShadowAssetPortClient(channel.port2, { deadlineMs: 20 });
    channel.port1.postMessage({ type: 'ready', plan, bindings: plan.bindings });
    await client.ready;

    await expect(client.read('asset')).rejects.toThrow(/read exceeded 20ms/);
    await expect(cancelled).resolves.toBe(0);
    client.dispose();
    channel.port1.close();
  });

  it('enters a terminal state on protocol failure and rejects future reads immediately', async () => {
    const plan = planAppliedShadowSubstitutions([]);
    const channel = new MessageChannel();
    let reads = 0;
    channel.port1.addEventListener('message', (event: MessageEvent<unknown>) => {
      const frame = event.data as { type?: unknown; id?: unknown };
      if (frame.type !== 'read' || typeof frame.id !== 'number') return;
      reads += 1;
      channel.port1.postMessage({
        type: 'forged',
        id: frame.id,
        message: 'must not be accepted as error',
        retryable: true,
      });
    });
    channel.port1.start();
    const client = createShadowAssetPortClient(channel.port2, { deadlineMs: 1_000 });
    channel.port1.postMessage({ type: 'ready', plan, bindings: plan.bindings });
    await client.ready;

    await expect(client.read('asset')).rejects.toThrow(/response type is unsupported/);
    await expect(client.read('asset')).rejects.toThrow(/response type is unsupported/);
    expect(reads).toBe(1);
    channel.port1.close();
  });

  it('enters a terminal state after a synchronous post failure', async () => {
    const plan = planAppliedShadowSubstitutions([]);
    const channel = new MessageChannel();
    const client = createShadowAssetPortClient(channel.port2, { deadlineMs: 1_000 });
    channel.port1.postMessage({ type: 'ready', plan, bindings: plan.bindings });
    await client.ready;
    const post = vi.spyOn(channel.port2, 'postMessage').mockImplementation(() => {
      throw new Error('detached');
    });

    await expect(client.read('asset')).rejects.toThrow(/post failed: detached/);
    await expect(client.read('asset')).rejects.toThrow(/post failed: detached/);
    expect(post).toHaveBeenCalledTimes(1);
    channel.port1.close();
  });

  it('terminalizes and throws when the initial server ready post fails synchronously', () => {
    const plan = planAppliedShadowSubstitutions([]);
    const channel = new MessageChannel();
    const close = vi.spyOn(channel.port1, 'close');
    vi.spyOn(channel.port1, 'postMessage').mockImplementation(() => {
      throw new Error('detached');
    });

    expect(() =>
      serveTrustedReadyShadowAssets(channel.port1, {
        plan,
        read: async () => new Uint8Array(),
      }),
    ).toThrow(/server post failed: detached/);
    expect(close).toHaveBeenCalledTimes(1);
    channel.port2.close();
  });

  it.each(['result', 'error'] as const)(
    'terminalizes without an unhandled rejection when a server %s post fails synchronously',
    async (outcome) => {
      const admitted = planAppliedShadowSubstitutions([
        attestBuiltinShadowSubstitution({
          trigger: { name: 'esbuild', requestedRange: '0.28.0', version: '0.28.0' },
          installPath: 'node_modules/esbuild',
          acquisition: { kind: 'synthetic' },
        }),
      ]);
      const channel = new MessageChannel();
      const read = vi.fn(async () => {
        if (outcome === 'error') throw new Error('read failed');
        return new Uint8Array([1]);
      });
      const server = serveTrustedReadyShadowAssets(channel.port1, { plan: admitted, read });
      const client = createShadowAssetPortClient(channel.port2, { deadlineMs: 100 });
      await client.ready;
      const post = vi.spyOn(channel.port1, 'postMessage').mockImplementation(() => {
        throw new Error('detached');
      });

      await expect(client.read(admitted.assets[0]!.id)).rejects.toThrow(/peer died|exceeded/);
      expect(read).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledTimes(1);
      await expect(client.read(admitted.assets[0]!.id)).rejects.toThrow(/peer died|exceeded/);
      expect(read).toHaveBeenCalledTimes(1);
      server.dispose();
    },
  );

  it('settles terminally when the peer dies after readiness', async () => {
    const plan = planAppliedShadowSubstitutions([]);
    const channel = new MessageChannel();
    const client = createShadowAssetPortClient(channel.port2, { deadlineMs: 1_000 });
    channel.port1.postMessage({ type: 'ready', plan, bindings: plan.bindings });
    await client.ready;
    const closed = new Promise<void>((resolve) => {
      channel.port2.addEventListener('close', () => resolve(), { once: true });
    });
    channel.port1.close();
    await closed;

    await expect(client.read('asset')).rejects.toThrow(/peer died/);
  });

  it('fault: rejects a pending read with the typed terminal error and clears it when the peer dies', async () => {
    const plan = planAppliedShadowSubstitutions([]);
    const channel = new MessageChannel();
    let observeRead!: () => void;
    const readObserved = new Promise<void>((resolve) => {
      observeRead = resolve;
    });
    channel.port1.addEventListener('message', (event: MessageEvent<unknown>) => {
      const frame = event.data as { type?: unknown };
      if (frame.type === 'read') observeRead();
    });
    channel.port1.start();
    const close = vi.spyOn(channel.port2, 'close');
    const post = vi.spyOn(channel.port2, 'postMessage');
    const client = createShadowAssetPortClient(channel.port2, { deadlineMs: 25 });
    channel.port1.postMessage({ type: 'ready', plan, bindings: plan.bindings });
    await client.ready;

    const pending = client.read('asset');
    await readObserved;
    channel.port1.close();
    let terminal: unknown;
    try {
      await pending;
    } catch (error) {
      terminal = error;
    }

    expect(terminal).toBeInstanceOf(ShadowAssetPortError);
    expect(terminal).toMatchObject({
      code: 'ESHADOWASSETPORT',
      retryable: true,
      message: 'shadow asset port peer died',
    });
    await expect(client.read('asset')).rejects.toBe(terminal);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(post).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects non-byte reader results and preserves explicit retryability', async () => {
    const admitted = planAppliedShadowSubstitutions([
      attestBuiltinShadowSubstitution({
        trigger: { name: 'esbuild', requestedRange: '0.28.0', version: '0.28.0' },
        installPath: 'node_modules/esbuild',
        acquisition: { kind: 'synthetic' },
      }),
    ]);
    const invalid = new MessageChannel();
    const invalidServer = serveTrustedReadyShadowAssets(invalid.port1, {
      plan: admitted,
      read: async () => 'not bytes' as unknown as Uint8Array,
    });
    const invalidClient = createShadowAssetPortClient(invalid.port2, { deadlineMs: 1_000 });
    await invalidClient.ready;
    await expect(invalidClient.read(admitted.assets[0]!.id)).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining('non-Uint8Array'),
    });
    invalidClient.dispose();
    invalidServer.dispose();

    const explicit = new MessageChannel();
    const explicitServer = serveTrustedReadyShadowAssets(explicit.port1, {
      plan: admitted,
      read: async () => {
        throw new ShadowAssetPortError('permanent reader failure', false);
      },
    });
    const explicitClient = createShadowAssetPortClient(explicit.port2, {
      deadlineMs: 1_000,
    });
    await explicitClient.ready;
    await expect(explicitClient.read(admitted.assets[0]!.id)).rejects.toMatchObject({
      retryable: false,
      message: 'permanent reader failure',
    });
    explicitClient.dispose();
    explicitServer.dispose();
  });
});
