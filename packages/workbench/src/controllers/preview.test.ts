import { describe, expect, it, vi } from 'vitest';
import {
  type PreviewDevServerFrame,
  type PreviewOwnerPort,
  type PreviewPortsFrame,
  createPreviewController,
} from './preview.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class Owner implements PreviewOwnerPort {
  readonly previewOwnerToken = 'owner-token';
  requests = 0;
  readonly devListeners = new Set<(frame: PreviewDevServerFrame) => void>();
  readonly previewListeners = new Set<(frame: PreviewPortsFrame) => void>();

  onDevServer(listener: (frame: PreviewDevServerFrame) => void): () => void {
    this.devListeners.add(listener);
    return () => this.devListeners.delete(listener);
  }

  onPreview(listener: (frame: PreviewPortsFrame) => void): () => void {
    this.previewListeners.add(listener);
    return () => this.previewListeners.delete(listener);
  }

  requestPreview(): void {
    this.requests += 1;
  }

  emitDev(frame: PreviewDevServerFrame): void {
    for (const listener of this.devListeners) listener(frame);
  }

  emitPorts(frame: PreviewPortsFrame): void {
    for (const listener of this.previewListeners) listener(frame);
  }
}

describe('preview controller', () => {
  it('rolls back a partial owner subscription when the second subscription fails', () => {
    const owner = new Owner();
    const subscriptionError = new Error('preview subscription failed');
    owner.onPreview = () => {
      throw subscriptionError;
    };

    expect(() =>
      createPreviewController({
        currentOwner: () => owner,
        mountBridge: () => () => {},
        proveServiceWorkerRoundTrip: async () => new Response('unused'),
      }),
    ).toThrow(subscriptionError);
    expect(owner.devListeners.size).toBe(0);
    expect(owner.previewListeners.size).toBe(0);
    expect(owner.requests).toBe(0);
  });

  it('stays starting until the selected owner URL completes a real SW fetch', async () => {
    const owner = new Owner();
    const proof = deferred<Response>();
    const probes: { readonly url: string; readonly init: object }[] = [];
    const mounted: string[] = [];
    const controller = createPreviewController({
      currentOwner: () => owner,
      mountBridge: (port, token, scope) => {
        mounted.push(`${token}:${port}:${scope ?? '-'}`);
        return () => {};
      },
      proveServiceWorkerRoundTrip: (url, init) => {
        probes.push({ url, init });
        return proof.promise;
      },
    });

    expect(owner.requests).toBe(1);
    owner.emitDev({ status: 'running', port: 5173, url: '/preview/5173/' });
    owner.emitPorts({ ports: [{ port: 5173, url: '/preview/5173/' }] });

    expect(controller.snapshot()).toMatchObject({
      status: 'starting',
      port: 5173,
      url: '/preview/5173/',
      error: null,
    });
    expect(mounted).toEqual(['owner-token:5173:-']);
    await vi.waitFor(() => expect(probes).toHaveLength(1));
    expect(probes[0]).toMatchObject({
      url: '/preview/5173/',
      init: { method: 'GET', cache: 'no-store' },
    });
    expect((probes[0]?.init as { readonly signal: AbortSignal }).signal).toBeInstanceOf(
      AbortSignal,
    );

    proof.resolve(new Response('owner response'));
    await vi.waitFor(() => expect(controller.snapshot().status).toBe('live'));
    controller.dispose();
  });

  it('cancels stale proofs and never resurrects a departed route', async () => {
    const owner = new Owner();
    const proofs: ReturnType<typeof deferred<Response>>[] = [];
    const torn: number[] = [];
    const controller = createPreviewController({
      currentOwner: () => owner,
      mountBridge: (port) => () => torn.push(port),
      proveServiceWorkerRoundTrip: () => {
        const proof = deferred<Response>();
        proofs.push(proof);
        return proof.promise;
      },
    });

    owner.emitPorts({ ports: [{ port: 5173, url: '/preview/5173/' }] });
    await vi.waitFor(() => expect(proofs).toHaveLength(1));
    owner.emitPorts({ ports: [{ port: 3000, url: '/preview/3000/' }] });
    await vi.waitFor(() => expect(proofs).toHaveLength(2));
    expect(torn).toEqual([5173]);

    proofs[0]?.resolve(new Response('stale'));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.snapshot()).toMatchObject({ status: 'starting', port: 3000 });

    proofs[1]?.resolve(new Response('current'));
    await vi.waitFor(() =>
      expect(controller.snapshot()).toMatchObject({ status: 'live', port: 3000 }),
    );
    controller.dispose();
  });

  it('surfaces HTTP and owner failures without claiming live', async () => {
    const owner = new Owner();
    const controller = createPreviewController({
      currentOwner: () => owner,
      mountBridge: () => () => {},
      proveServiceWorkerRoundTrip: async () => new Response('not ready', { status: 503 }),
    });

    owner.emitPorts({ ports: [{ port: 4173, url: '/preview/4173/' }] });
    await vi.waitFor(() => expect(controller.snapshot().status).toBe('error'));
    expect(controller.snapshot()).toMatchObject({
      status: 'error',
      error: 'preview SW round-trip failed with HTTP 503',
    });

    owner.emitPorts({ ports: [] });
    owner.emitDev({ status: 'stopped', error: 'service worker scope rejected' });
    expect(controller.snapshot()).toMatchObject({
      status: 'error',
      error: 'service worker scope rejected',
    });
    controller.dispose();
  });

  it('surfaces an external SW failure immediately, before any port is advertised', () => {
    const owner = new Owner();
    const controller = createPreviewController({
      currentOwner: () => owner,
      mountBridge: () => () => {},
      proveServiceWorkerRoundTrip: async () => new Response('unused'),
    });
    controller.fail(new Error('service worker scope rejected'));
    expect(controller.snapshot()).toMatchObject({
      status: 'error',
      port: null,
      error: 'service worker scope rejected',
    });
    controller.dispose();
  });

  it('does not let a never-settling response-body cancel hold LIVE forever', async () => {
    const owner = new Owner();
    const controller = createPreviewController({
      currentOwner: () => owner,
      mountBridge: () => () => {},
      proveServiceWorkerRoundTrip: async () =>
        ({
          ok: true,
          status: 200,
          body: { cancel: () => new Promise<void>(() => {}) },
        }) as unknown as Response,
      probeTimeoutMs: 25,
    });
    owner.emitPorts({ ports: [{ port: 5173, url: '/preview/5173/' }] });
    await vi.waitFor(() => expect(controller.snapshot().status).toBe('live'));
    controller.dispose();
  });

  it('stop and dispose tear routes; dispose is idempotent and methods fail loudly', async () => {
    const owner = new Owner();
    const tears = vi.fn();
    const controller = createPreviewController({
      currentOwner: () => owner,
      mountBridge: () => tears,
      proveServiceWorkerRoundTrip: async () => new Response('ok'),
    });
    owner.emitPorts({ ports: [{ port: 8080, url: '/preview/8080/' }] });
    await vi.waitFor(() => expect(controller.snapshot().status).toBe('live'));

    controller.stop();
    expect(tears).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().status).toBe('idle');
    owner.emitPorts({ ports: [{ port: 9000, url: '/preview/9000/' }] });
    expect(controller.snapshot().port).toBeNull();

    controller.start();
    expect(owner.requests).toBe(2);
    expect(controller.snapshot().port).toBeNull();
    owner.emitPorts({ ports: [{ port: 9000, url: '/preview/9000/' }] });
    await vi.waitFor(() =>
      expect(controller.snapshot()).toMatchObject({ status: 'live', port: 9000 }),
    );

    controller.dispose();
    controller.dispose();
    expect(tears).toHaveBeenCalledTimes(2);
    expect(() => controller.snapshot()).toThrow('preview controller disposed');
  });
});
