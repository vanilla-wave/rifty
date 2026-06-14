import { describe, expect, it } from 'vitest';
import { createRuntimeSession } from './runtime-session.ts';
import type { RuntimeSessionStartOptions } from './runtime-session.ts';

describe('createRuntimeSession', () => {
  it('uses minimum configuration defaults from the default template', async () => {
    const startOptions: RuntimeSessionStartOptions[] = [];
    const session = await createRuntimeSession(
      { bootstrapWorkerUrl: 'worker.js' },
      {
        start: async (opts) => {
          startOptions.push(opts);
          return { close: async () => undefined };
        },
      },
    );

    expect(session.port).toBe(5174);
    expect(session.root).toBe('/workspace');
    expect(session.entryPath).toBe('/workspace/src/main.js');
    expect(session.previewUrl).toBe('/preview/5174/');
    expect(startOptions[0]?.bootstrapWorkerUrl).toBe('worker.js');
    expect(startOptions[0]?.setup).toBe('instant');
    expect(startOptions[0]?.slug).toBe('vite');
  });

  it('spawns the project worker with injected bootstrap URL and tears down routing', async () => {
    const sent: unknown[] = [];
    const fallbackWrites: unknown[] = [];
    const calls: string[] = [];
    const spawnSpecs: Array<{
      readonly entry: { readonly kind: string; readonly url: string };
      readonly env: Readonly<Record<string, string>>;
      readonly cwd: string;
    }> = [];
    const workerHandle = {
      kind: 'worker' as const,
      stdout: () => ({ on: () => undefined }),
      stderr: () => ({ on: () => undefined }),
      on: () => undefined,
      send: (message: unknown) => {
        sent.push(message);
        return false;
      },
      kill: (signal: string) => calls.push(`kill:${signal}`),
    };
    const previewBridge = Object.assign(async () => new Response('ok'), {
      dispose: () => calls.push('preview-dispose'),
      dispatchStruct: async () => new Response('ok'),
    });

    const session = await createRuntimeSession(
      { bootstrapWorkerUrl: 'worker.js' },
      {
        isSabIpcSupported: () => true,
        spawnWorker: (_name, spec) => {
          spawnSpecs.push(spec);
          return workerHandle;
        },
        bridgeCrossRealmPreview: () => previewBridge,
        registerPort: (port) => calls.push(`register:${port}`),
        unregisterPort: (port) => calls.push(`unregister:${port}`),
        mountPreviewBridge: (_bridge, opts) => {
          calls.push(`owner:${typeof opts.ownerToken}`);
          return () => calls.push('sw-teardown');
        },
        sendVfsWrite: (_port, frame) => fallbackWrites.push(frame),
        createPreviewOwnerToken: () => 'owner-token',
      },
    );

    expect(spawnSpecs[0]?.entry).toEqual({ kind: 'url', url: 'worker.js' });
    expect(spawnSpecs[0]?.cwd).toBe('/workspace');
    expect(spawnSpecs[0]?.env.RIFTY_RFV_PORT).toBe('5174');
    expect(spawnSpecs[0]?.env.RIFTY_RFV_TEMPLATE).toBe('vite');
    expect(spawnSpecs[0]?.env.RIFTY_RFV_SETUP).toBe('instant');
    expect(spawnSpecs[0]?.env.RIFTY_RFV_SLUG).toBe('vite');
    expect(spawnSpecs[0]?.env.RIFTY_PREVIEW_OWNER_TOKEN).toBe('owner-token');
    expect(spawnSpecs[0]?.env.PORT).toBe('5174');
    expect(calls).toContain('register:5174');
    expect(calls).toContain('owner:string');

    session.updateFile('/workspace/src/main.js', 'next');

    expect(sent).toHaveLength(1);
    expect(fallbackWrites).toHaveLength(1);

    await session.close();

    expect(calls).toEqual(
      expect.arrayContaining(['sw-teardown', 'unregister:5174', 'preview-dispose', 'kill:SIGTERM']),
    );
  });

  it('exposes a ready promise for the worker-side bridges', async () => {
    let stdoutData: ((chunk: unknown) => void) | undefined;
    const workerHandle = {
      kind: 'worker' as const,
      stdout: () => ({
        on: (_event: 'data', cb: (chunk: unknown) => void) => {
          stdoutData = cb;
        },
      }),
      stderr: () => ({ on: () => undefined }),
      on: () => undefined,
      send: () => true,
      kill: () => undefined,
    };
    const previewBridge = Object.assign(async () => new Response('ok'), {
      dispose: () => undefined,
      dispatchStruct: async () => new Response('ok'),
    });

    const session = await createRuntimeSession(
      { bootstrapWorkerUrl: 'worker.js' },
      {
        isSabIpcSupported: () => true,
        spawnWorker: () => workerHandle,
        bridgeCrossRealmPreview: () => previewBridge,
        registerPort: () => undefined,
        unregisterPort: () => undefined,
        mountPreviewBridge: () => () => undefined,
      },
    );

    const ready = session.ready.then(() => 'ready');
    stdoutData?.('[real-vite/worker] node_modules read bridge ready\n');

    await expect(ready).resolves.toBe('ready');
  });
});
