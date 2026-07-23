import { describe, expect, it, vi } from 'vitest';
import type { PreviewAdvertisement } from '../preview-readiness.ts';
import { createBrowserPlaygroundPreviewAuthority } from './playground-preview-registry.ts';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

const entry = (port: number, overrides: Partial<PreviewAdvertisement> = {}): PreviewAdvertisement =>
  Object.freeze({
    ownerToken: 'owner-a',
    port,
    url: `/preview/${String(port)}/`,
    label: `node :${String(port)}`,
    source: 'node' as const,
    sid: `child-${String(port)}`,
    ptySid: 'terminal-a',
    ptyRid: 'run-a',
    previewScope: `scope-${String(port)}`,
    ...overrides,
  });

function harness(
  options: {
    readonly proofFailure?: Error;
    readonly mountFailure?: Error;
    readonly malformedMount?: boolean;
    readonly deferredProof?: boolean;
    readonly throwHealthCallbacks?: boolean;
  } = {},
) {
  let publishRaw: (snapshot: readonly PreviewAdvertisement[]) => void = () => {
    throw new Error('raw preview listener was not installed');
  };
  const events: string[] = [];
  const degraded: Error[] = [];
  const healthy: number[] = [];
  const invariants: Error[] = [];
  const proofs: (Deferred<void> & { readonly signal: AbortSignal })[] = [];
  let proofFailure = options.proofFailure;
  let mountFailure = options.mountFailure;
  const requestSnapshot = vi.fn(() => events.push('request'));
  const unsubscribe = vi.fn(() => events.push('unsubscribe'));
  const authority = createBrowserPlaygroundPreviewAuthority({
    subscribe(listener) {
      events.push('subscribe');
      publishRaw = listener;
      listener(Object.freeze([]));
      return unsubscribe;
    },
    requestSnapshot,
    mountRoute(candidate) {
      events.push(`mount:${String(candidate.port)}:${candidate.previewScope ?? ''}`);
      if (mountFailure !== undefined) throw mountFailure;
      if (options.malformedMount === true) return undefined as never;
      return () => events.push(`unmount:${String(candidate.port)}:${candidate.previewScope ?? ''}`);
    },
    proveServiceWorkerControl(signal) {
      events.push('prove');
      if (proofFailure !== undefined) return Promise.reject(proofFailure);
      if (options.deferredProof !== true) return Promise.resolve();
      const proof = deferred<void>();
      proofs.push({ ...proof, signal });
      return proof.promise;
    },
    onDegraded(error) {
      degraded.push(error);
      events.push(`degraded:${error.message}`);
      if (options.throwHealthCallbacks === true) throw new Error('degraded observer failed');
    },
    onHealthy() {
      healthy.push(healthy.length + 1);
      events.push('healthy');
      if (options.throwHealthCallbacks === true) throw new Error('healthy observer failed');
    },
    onInvariant(error) {
      invariants.push(error);
      events.push(`invariant:${error.message}`);
      if (options.throwHealthCallbacks === true) throw new Error('invariant observer failed');
    },
  });
  return {
    authority,
    degraded,
    events,
    healthy,
    invariants,
    proofs,
    publishRaw: (snapshot: readonly PreviewAdvertisement[]) => publishRaw(snapshot),
    requestSnapshot,
    setMountFailure(error: Error | undefined) {
      mountFailure = error;
    },
    setProofFailure(error: Error | undefined) {
      proofFailure = error;
    },
    unsubscribe,
  };
}

describe('browser Playground preview registry contract', () => {
  it('requests replay, mounts every hidden route before publishing a frozen semantic snapshot', async () => {
    const h = harness();
    const published: unknown[] = [];
    const routed: (readonly PreviewAdvertisement[])[] = [];
    h.authority.registry.subscribe((snapshot) => {
      h.events.push(`public:${snapshot.map(({ port }) => String(port)).join(',')}`);
      published.push(snapshot);
    });
    h.authority.subscribeRouted((snapshot) => routed.push(snapshot));

    expect(h.events).toEqual(['subscribe', 'request', 'public:']);
    h.publishRaw(Object.freeze([entry(4100), entry(4200, { source: 'preview' })]));

    await vi.waitFor(() => {
      expect(h.authority.registry.snapshot()).toHaveLength(2);
    });
    expect(h.events).toEqual([
      'subscribe',
      'request',
      'public:',
      'mount:4100:scope-4100',
      'mount:4200:scope-4200',
      'prove',
      'public:4100,4200',
    ]);
    expect(h.authority.registry.snapshot()).toEqual([
      { port: 4100, url: '/preview/4100/', label: 'node :4100', source: 'node' },
      { port: 4200, url: '/preview/4200/', label: 'node :4200', source: 'preview' },
    ]);
    const semantic = h.authority.registry.snapshot();
    expect(Object.isFrozen(semantic)).toBe(true);
    expect(semantic.every(Object.isFrozen)).toBe(true);
    expect(Reflect.ownKeys(semantic[0] ?? {})).toEqual(['port', 'url', 'label', 'source']);
    expect(routed.at(-1)).toEqual([entry(4100), entry(4200, { source: 'preview' })]);

    h.events.length = 0;
    h.publishRaw(Object.freeze([entry(4100)]));
    await vi.waitFor(() => expect(h.authority.registry.snapshot()).toHaveLength(1));
    expect(h.events).toEqual(['public:4100', 'unmount:4200:scope-4200', 'prove']);

    const eventCount = h.events.length;
    h.publishRaw(Object.freeze([entry(4100)]));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.events).toHaveLength(eventCount);
    expect(published).toHaveLength(3);
  });

  it('withdraws a replaced port, releases its exact hidden route, then publishes the replacement', async () => {
    const h = harness();
    h.authority.registry.subscribe((snapshot) => {
      h.events.push(`public:${snapshot.map(({ source }) => source).join(',')}`);
    });
    h.publishRaw(Object.freeze([entry(4100)]));
    await vi.waitFor(() => expect(h.authority.registry.snapshot()).toHaveLength(1));
    h.events.length = 0;

    h.publishRaw(
      Object.freeze([
        entry(4100, {
          ownerToken: 'owner-a',
          source: 'dev-server',
          label: 'npm run dev',
          sid: 'dev-server',
          previewScope: 'replacement-scope',
        }),
      ]),
    );
    await vi.waitFor(() => expect(h.authority.registry.snapshot()[0]?.source).toBe('dev-server'));

    expect(h.events).toEqual([
      'public:',
      'unmount:4100:scope-4100',
      'mount:4100:replacement-scope',
      'prove',
      'public:dev-server',
    ]);
  });

  it.each([
    {
      case: 'removal',
      next: Object.freeze([]) as readonly PreviewAdvertisement[],
      expected: Object.freeze([]),
    },
    {
      case: 'same-port replacement',
      next: Object.freeze([
        entry(4100, {
          source: 'dev-server',
          label: 'npm run dev',
          sid: 'replacement-run',
          previewScope: 'replacement-scope',
        }),
      ]),
      expected: Object.freeze([
        {
          port: 4100,
          url: '/preview/4100/',
          label: 'npm run dev',
          source: 'dev-server' as const,
        },
      ]),
    },
  ])(
    'latest owner $case aborts an older proof, cleans its route, and never publishes it',
    async ({ next, expected }) => {
      const h = harness({ deferredProof: true });
      const published: (readonly { readonly source: string }[])[] = [];
      h.authority.registry.subscribe((snapshot) => published.push(snapshot));

      h.publishRaw(Object.freeze([entry(4100)]));
      await vi.waitFor(() => expect(h.proofs).toHaveLength(1));
      const staleProof = h.proofs[0];
      expect(staleProof).toBeDefined();

      h.publishRaw(next);

      expect(staleProof?.signal.aborted).toBe(true);
      await vi.waitFor(() => {
        expect(h.events.filter((event) => event === 'unmount:4100:scope-4100')).toHaveLength(1);
        expect(h.proofs).toHaveLength(2);
      });
      expect(h.authority.registry.snapshot()).toEqual([]);
      expect(published).toHaveLength(1);
      expect(published.some((snapshot) => snapshot.some(({ source }) => source === 'node'))).toBe(
        false,
      );

      staleProof?.resolve();
      await Promise.resolve();
      expect(published.some((snapshot) => snapshot.some(({ source }) => source === 'node'))).toBe(
        false,
      );

      h.proofs[1]?.resolve();
      await vi.waitFor(() => expect(h.authority.registry.snapshot()).toEqual(expected));
      expect(h.events.filter((event) => event === 'unmount:4100:scope-4100')).toHaveLength(1);
    },
  );

  it('fences a proof that settles immediately before a newer owner snapshot', async () => {
    const h = harness({ deferredProof: true });
    const published: (readonly { readonly source: string }[])[] = [];
    h.authority.registry.subscribe((snapshot) => published.push(snapshot));
    h.publishRaw(Object.freeze([entry(4100)]));
    await vi.waitFor(() => expect(h.proofs).toHaveLength(1));

    const staleProof = h.proofs[0];
    staleProof?.resolve();
    h.publishRaw(Object.freeze([]));

    expect(staleProof?.signal.aborted).toBe(true);
    await vi.waitFor(() => {
      expect(h.events.filter((event) => event === 'unmount:4100:scope-4100')).toHaveLength(1);
      expect(h.proofs).toHaveLength(2);
    });
    expect(published.some((snapshot) => snapshot.some(({ source }) => source === 'node'))).toBe(
      false,
    );
    h.proofs[1]?.resolve();
    await vi.waitFor(() => expect(h.authority.registry.snapshot()).toEqual([]));
  });

  it('coalesces an exact owner replay without aborting its pending proof', async () => {
    const h = harness({ deferredProof: true });
    h.publishRaw(Object.freeze([entry(4100)]));
    await vi.waitFor(() => expect(h.proofs).toHaveLength(1));

    const proof = h.proofs[0];
    h.publishRaw(Object.freeze([entry(4100)]));

    expect(proof?.signal.aborted).toBe(false);
    expect(h.proofs).toHaveLength(1);
    proof?.resolve();
    await vi.waitFor(() => expect(h.authority.registry.snapshot()).toHaveLength(1));
    expect(h.events.filter((event) => event === 'mount:4100:scope-4100')).toHaveLength(1);
  });

  it.each([
    ['route mount', new Error('route mount failed')],
    ['control proof', new Error('control proof failed')],
  ])(
    'withdraws previews and stays subscribed when transient %s reconciliation fails',
    async (kind, operationalFailure) => {
      const h = harness();
      h.publishRaw(Object.freeze([entry(4100)]));
      await vi.waitFor(() => expect(h.authority.registry.snapshot()).toHaveLength(1));
      h.events.length = 0;
      if (kind === 'route mount') h.setMountFailure(operationalFailure);
      else h.setProofFailure(operationalFailure);

      h.publishRaw(Object.freeze([entry(4200)]));

      await vi.waitFor(() => expect(h.degraded).toEqual([operationalFailure]));
      expect(h.authority.registry.snapshot()).toEqual([]);
      expect(h.unsubscribe).not.toHaveBeenCalled();
      expect(h.events).toContain('unmount:4100:scope-4100');
      expect(h.events).not.toContain('public:4200');

      if (kind === 'route mount') h.setMountFailure(undefined);
      else h.setProofFailure(undefined);
      h.publishRaw(Object.freeze([entry(4300)]));
      await vi.waitFor(() => expect(h.authority.registry.snapshot()[0]?.port).toBe(4300));
      expect(h.healthy).toHaveLength(1);
      expect(h.unsubscribe).not.toHaveBeenCalled();
    },
  );

  it('coalesces explicit recovery, repeats the latest route proof, then restores preview health', async () => {
    const proofFailure = new Error('control proof failed');
    const h = harness({ proofFailure });
    const publicSnapshots: number[][] = [];
    h.authority.registry.subscribe((snapshot) =>
      publicSnapshots.push(snapshot.map(({ port }) => port)),
    );
    h.publishRaw(Object.freeze([entry(4200)]));
    await vi.waitFor(() => expect(h.degraded).toEqual([proofFailure]));
    expect(h.authority.registry.snapshot()).toEqual([]);
    expect(h.unsubscribe).not.toHaveBeenCalled();
    h.setProofFailure(undefined);

    const first = h.authority.recover();
    const coalesced = h.authority.recover();

    expect(coalesced).toBe(first);
    await expect(first).resolves.toBeUndefined();
    expect(h.authority.registry.snapshot()).toEqual([
      { port: 4200, url: '/preview/4200/', label: 'node :4200', source: 'node' },
    ]);
    expect(h.healthy).toHaveLength(1);
    expect(h.requestSnapshot).toHaveBeenCalledTimes(2);
    expect(h.events.filter((event) => event === 'mount:4200:scope-4200')).toHaveLength(2);
    expect(h.events.filter((event) => event === 'prove')).toHaveLength(2);
    expect(publicSnapshots.at(-1)).toEqual([4200]);
  });

  it.each([
    {
      case: 'duplicate owner ports',
      h: () => harness(),
      publish: (h: ReturnType<typeof harness>) =>
        h.publishRaw(Object.freeze([entry(4100), entry(4100)])),
      message: 'Owner preview snapshot repeats port 4100',
    },
    {
      case: 'malformed mount contract',
      h: () => harness({ malformedMount: true, throwHealthCallbacks: true }),
      publish: (h: ReturnType<typeof harness>) => h.publishRaw(Object.freeze([entry(4100)])),
      message: 'Playground preview route mount omitted teardown',
    },
  ])('reports $case as a fatal invariant and permanently fences the registry', async (row) => {
    const h = row.h();
    row.publish(h);

    await vi.waitFor(() => expect(h.invariants).toHaveLength(1));
    expect(h.invariants[0]?.message).toBe(row.message);
    expect(h.degraded).toEqual([]);
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(() => h.authority.registry.snapshot()).toThrow(row.message);
    await expect(h.authority.recover()).rejects.toThrow(row.message);
  });

  it('isolates public, routed, and health observers from preview authority state', async () => {
    const proofFailure = new Error('control proof failed');
    const h = harness({ proofFailure, throwHealthCallbacks: true });
    h.authority.registry.subscribe(() => {
      throw new Error('public observer failed');
    });
    h.authority.subscribeRouted(() => {
      throw new Error('routed observer failed');
    });
    h.publishRaw(Object.freeze([entry(4100)]));
    await vi.waitFor(() => expect(h.degraded).toEqual([proofFailure]));
    h.setProofFailure(undefined);

    await expect(h.authority.recover()).resolves.toBeUndefined();
    expect(h.authority.registry.snapshot()).toHaveLength(1);
    expect(h.healthy).toHaveLength(1);
  });

  it('never publishes an unrouted entry when an operational route mount fails', async () => {
    const mountFailure = new Error('route mount failed');
    const mount = harness({ mountFailure });
    mount.publishRaw(Object.freeze([entry(4100)]));
    await vi.waitFor(() => expect(mount.degraded).toEqual([mountFailure]));
    expect(mount.authority.registry.snapshot()).toEqual([]);
    expect(mount.events).not.toContain('public:4100');
  });

  it('close publishes no live entry, releases all routes, fences control, and is idempotent', async () => {
    const h = harness();
    const snapshots: number[][] = [];
    h.authority.registry.subscribe((snapshot) => snapshots.push(snapshot.map(({ port }) => port)));
    h.publishRaw(Object.freeze([entry(4100), entry(4200)]));
    await vi.waitFor(() => expect(h.authority.registry.snapshot()).toHaveLength(2));
    h.events.length = 0;

    const closing = h.authority.close();
    expect(h.authority.close()).toBe(closing);
    await closing;

    expect(h.events).toEqual([
      'unmount:4100:scope-4100',
      'unmount:4200:scope-4200',
      'prove',
      'unsubscribe',
    ]);
    expect(snapshots.at(-1)).toEqual([]);
    expect(() => h.authority.registry.snapshot()).toThrow(/ClosedHandleError/i);
  });

  it('close aborts a pending proof and releases its route without waiting for that proof', async () => {
    const h = harness({ deferredProof: true });
    const published: (readonly { readonly source: string }[])[] = [];
    h.authority.registry.subscribe((snapshot) => published.push(snapshot));
    h.publishRaw(Object.freeze([entry(4100)]));
    await vi.waitFor(() => expect(h.proofs).toHaveLength(1));

    const staleProof = h.proofs[0];
    const closing = h.authority.close();

    expect(staleProof?.signal.aborted).toBe(true);
    await vi.waitFor(() => {
      expect(h.events.filter((event) => event === 'unmount:4100:scope-4100')).toHaveLength(1);
      expect(h.proofs).toHaveLength(2);
    });
    expect(published.some((snapshot) => snapshot.some(({ source }) => source === 'node'))).toBe(
      false,
    );

    staleProof?.resolve();
    h.proofs[1]?.resolve();
    await expect(closing).resolves.toBeUndefined();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
