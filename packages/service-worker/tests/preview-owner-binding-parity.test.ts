/**
 * Parity-style tests for {@link PreviewOwnerBinding}: the same scenario set
 * exercised against both consumers — window binding and worker binding. Each
 * scenario asserts the same observable contract, so a regression that only
 * affects one binding is visible as a one-sided failure.
 *
 * Scenarios pinned here:
 *
 *  1. Owner resolution happy path: a request for port `N` resolves to a
 *     ready owner that can receive `postMessage`.
 *  2. No owner: when the binding has no eligible owner, `resolveOwner`
 *     returns `null`.
 *  3. Mismatched protocol version owner is recorded, and `waitForReady`
 *     resolves with `'mismatch'`.
 *  4. Goodbye drops a previously ready owner from the ready set.
 *  5. `waitForReady` times out cleanly if the owner never readies.
 *  6. `nextRequestId` is monotonic and independent across binding
 *     instances.
 *  7. (Worker-only) When the Worker `Client` is gone (`clients.get` returns
 *     `undefined`), `resolveOwner` returns `null` instead of returning a
 *     stale handle.
 *
 * The worker binding adds a port→ownerId map populated by the Worker's
 * `rifty:preview:ready` frame; ADR-0046 carries the contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FirstWindowOwnerBinding,
  type FirstWindowOwnerBindingOptions,
} from '../src/owner-binding-window.ts';
import { WorkerOwnerBinding, type WorkerOwnerBindingOptions } from '../src/owner-binding-worker.ts';
import type { PreviewOwnerBinding, ReadinessSubscription } from '../src/preview-owner-binding.ts';
import {
  SW_FRAME_VERSION,
  SW_PREVIEW_GOODBYE,
  SW_PREVIEW_READY,
  SW_ROUTING_VERSION,
} from '../src/protocol.ts';

type MockClient = {
  id: string;
  type: ClientTypes;
  postMessage: ReturnType<typeof vi.fn>;
};

function makeMockClient(id: string, type: ClientTypes = 'window'): MockClient {
  return {
    id,
    type,
    postMessage: vi.fn<(message: unknown, transfer: Transferable[]) => void>(),
  };
}

interface MockScope {
  clients: {
    get: ReturnType<typeof vi.fn>;
    matchAll: ReturnType<typeof vi.fn>;
  };
  listeners: Record<string, ((event: unknown) => void)[]>;
  addEventListener: (type: string, fn: (event: unknown) => void) => void;
  removeEventListener: (type: string, fn: (event: unknown) => void) => void;
  postMessage: (data: unknown, source: MockClient) => void;
  removeClient: (id: string) => void;
}

function makeMockScope(initial: MockClient[]): MockScope {
  // Local mutable client table — the worker scenario needs `removeClient`
  // to model a Worker terminating while the SW still holds a stale id.
  const table = new Map<string, MockClient>();
  for (const c of initial) table.set(c.id, c);
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  return {
    clients: {
      get: vi.fn(async (id: string) => table.get(id)),
      matchAll: vi.fn(async (opts?: { type?: ClientTypes; includeUncontrolled?: boolean }) => {
        const want = opts?.type;
        const all = [...table.values()];
        if (!want) return all;
        return all.filter((c) => c.type === want);
      }),
    },
    listeners,
    addEventListener(type, fn): void {
      const arr = listeners[type] ?? [];
      arr.push(fn);
      listeners[type] = arr;
    },
    removeEventListener(type, fn): void {
      const arr = listeners[type];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    },
    postMessage(data, source): void {
      const messageListeners = listeners.message ?? [];
      const event = { data, source };
      for (const fn of messageListeners) fn(event);
    },
    removeClient(id): void {
      table.delete(id);
    },
  };
}

/** Tag identifying a scenario row. One row per binding implementation. */
interface BindingFixture {
  readonly name: string;
  /**
   * Build a binding for the test plus the auxiliary handles the test
   * needs:
   *  - `owner`: the mock client the test expects `resolveOwner` to
   *    return for `port` 3000.
   *  - `ownerId`: the id used when posting ready/goodbye frames.
   *  - `clientType`: window vs worker — pinned in the parity test row
   *    so the assertions stay symmetric.
   *  - `resolveContext`: what `(clientId, port)` to pass through
   *    `resolveOwner` to receive `owner`. Window passes the clientId
   *    directly; worker passes the port (and the binding has already
   *    learned ownerId for that port via the ready frame).
   *  - `postReady` / `postGoodbye` / `postMismatchedReady`: helpers
   *    that send the right frame shape to the binding.
   */
  build(scope: MockScope): {
    binding: PreviewOwnerBinding;
    subscription: ReadinessSubscription;
    owner: MockClient;
    ownerId: string;
    clientType: ClientTypes;
    resolveContext: { clientId: string | null; port: number };
    postReady(): void;
    postGoodbye(): void;
    postMismatchedReady(): void;
  };
}

/**
 * Window-binding fixture. The ready frame uses the historical shape — no
 * `ports` field — and resolves to the first window for the supplied
 * clientId.
 */
function windowFixture(opts?: FirstWindowOwnerBindingOptions): BindingFixture {
  return {
    name: 'FirstWindowOwnerBinding',
    build(scope): ReturnType<BindingFixture['build']> {
      const owner = makeMockClient('window-A', 'window');
      scope.clients.matchAll.mockClear();
      scope.clients.get.mockClear();
      // Rebuild the table with our owner — the parity helpers expect
      // exactly one window present. Use a shared mutable table so
      // `removeClient` propagates to both `clients.get` and
      // `clients.matchAll` (needed by the no-owner test scenario).
      const table = new Map<string, MockClient>([['window-A', owner]]);
      (scope.clients.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        async (id: string) => table.get(id),
      );
      (scope.clients.matchAll as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        async (matchOpts?: { type?: ClientTypes }) => {
          const all = [...table.values()];
          if (!matchOpts?.type) return all;
          return all.filter((c) => c.type === matchOpts.type);
        },
      );
      scope.removeClient = (id: string): void => {
        table.delete(id);
      };
      const binding = new FirstWindowOwnerBinding(opts);
      const subscription = binding.subscribeReadiness(scope as unknown as ServiceWorkerGlobalScope);
      const ready = (): void =>
        scope.postMessage(
          {
            type: SW_PREVIEW_READY,
            frameVersion: SW_FRAME_VERSION,
            routingVersion: SW_ROUTING_VERSION,
          },
          owner,
        );
      const goodbye = (): void =>
        scope.postMessage(
          {
            type: SW_PREVIEW_GOODBYE,
            frameVersion: SW_FRAME_VERSION,
            routingVersion: SW_ROUTING_VERSION,
          },
          owner,
        );
      const mismatch = (): void =>
        scope.postMessage(
          { type: SW_PREVIEW_READY, frameVersion: '999', routingVersion: SW_ROUTING_VERSION },
          owner,
        );
      return {
        binding,
        subscription,
        owner,
        ownerId: owner.id,
        clientType: 'window',
        resolveContext: { clientId: owner.id, port: 3000 },
        postReady: ready,
        postGoodbye: goodbye,
        postMismatchedReady: mismatch,
      };
    },
  };
}

/**
 * Worker-binding fixture. The Worker posts a ready frame carrying
 * `ports: [3000]` so the binding learns "Worker `worker-A` serves port
 * 3000". `resolveContext.port` is 3000; clientId is null (the fetch
 * event for a Worker-served preview has no clientId by default — the
 * Worker has no DOM client equivalent).
 */
function workerFixture(opts?: WorkerOwnerBindingOptions): BindingFixture {
  return {
    name: 'WorkerOwnerBinding',
    build(scope): ReturnType<BindingFixture['build']> {
      const owner = makeMockClient('worker-A', 'worker');
      scope.clients.matchAll.mockClear();
      scope.clients.get.mockClear();
      scope.removeClient('worker-A');
      // Use the real table so `removeClient` is observable.
      const table = new Map<string, MockClient>([['worker-A', owner]]);
      (scope.clients.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        async (id: string) => table.get(id),
      );
      (scope.clients.matchAll as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        async (matchOpts?: { type?: ClientTypes }) => {
          const all = [...table.values()];
          if (!matchOpts?.type) return all;
          return all.filter((c) => c.type === matchOpts.type);
        },
      );
      scope.removeClient = (id: string): void => {
        table.delete(id);
      };
      const binding = new WorkerOwnerBinding(opts);
      const subscription = binding.subscribeReadiness(scope as unknown as ServiceWorkerGlobalScope);
      const ready = (): void =>
        scope.postMessage(
          {
            type: SW_PREVIEW_READY,
            frameVersion: SW_FRAME_VERSION,
            routingVersion: SW_ROUTING_VERSION,
            ports: [3000],
            ownerToken: 'owner-A',
          },
          owner,
        );
      const goodbye = (): void =>
        scope.postMessage(
          {
            type: SW_PREVIEW_GOODBYE,
            frameVersion: SW_FRAME_VERSION,
            routingVersion: SW_ROUTING_VERSION,
            ports: [3000],
            ownerToken: 'owner-A',
          },
          owner,
        );
      const mismatch = (): void =>
        scope.postMessage(
          {
            type: SW_PREVIEW_READY,
            frameVersion: '999',
            routingVersion: SW_ROUTING_VERSION,
            ports: [3000],
            ownerToken: 'owner-A',
          },
          owner,
        );
      return {
        binding,
        subscription,
        owner,
        ownerId: owner.id,
        clientType: 'worker',
        // For workers, the fetch event has no clientId — the SW sees a
        // request for /preview/3000/* and asks the binding "who owns
        // port 3000?". The port is the routing key.
        resolveContext: { clientId: 'owner-A', port: 3000 },
        postReady: ready,
        postGoodbye: goodbye,
        postMismatchedReady: mismatch,
      };
    },
  };
}

const fixtures: BindingFixture[] = [windowFixture(), workerFixture()];

describe('PreviewOwnerBinding parity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      it('resolves a ready owner for a preview fetch and dispatches', async () => {
        const scope = makeMockScope([]);
        const env = fixture.build(scope);
        env.postReady();
        const ownerId = env.ownerId;
        // The binding should report the owner as ready synchronously after
        // the ready frame is processed.
        expect(env.subscription.readiness.isReady(ownerId)).toBe(true);
        const owner = await env.binding.resolveOwner(
          scope as unknown as ServiceWorkerGlobalScope,
          new Request('http://x/preview/3000/'),
          env.resolveContext.clientId,
          env.resolveContext.port,
        );
        expect(owner?.id).toBe(env.ownerId);
        expect(owner?.type).toBe(env.clientType);
        env.subscription.teardown();
      });

      it('returns null from resolveOwner when no owner is registered', async () => {
        const scope = makeMockScope([]);
        const env = fixture.build(scope);
        // No ready frame — the worker binding has no port mapping, the
        // window binding has no clientId match plus no fallback window.
        // The window fixture also clears matchAll defaults so the
        // first-window fallback finds no eligible client. To make the
        // parity strict, we tear down the owner first.
        scope.removeClient(env.ownerId);
        const owner = await env.binding.resolveOwner(
          scope as unknown as ServiceWorkerGlobalScope,
          new Request('http://x/preview/3000/'),
          null, // suppress the clientId-direct path for the window
          env.resolveContext.port,
        );
        expect(owner).toBeNull();
        env.subscription.teardown();
      });

      it('marks the owner as mismatched and waitForReady resolves with "mismatch"', async () => {
        const scope = makeMockScope([]);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const env = fixture.build(scope);
          env.postMismatchedReady();
          expect(env.subscription.readiness.isMismatched(env.ownerId)).toBe(true);
          const outcome = await env.subscription.readiness.waitForReady(env.ownerId, 1_000);
          expect(outcome).toBe('mismatch');
          env.subscription.teardown();
        } finally {
          warnSpy.mockRestore();
        }
      });

      it('drops the owner from the ready set on goodbye', async () => {
        const scope = makeMockScope([]);
        const env = fixture.build(scope);
        env.postReady();
        expect(env.subscription.readiness.isReady(env.ownerId)).toBe(true);
        env.postGoodbye();
        expect(env.subscription.readiness.isReady(env.ownerId)).toBe(false);
        env.subscription.teardown();
      });

      it('waitForReady resolves with "timeout" if the owner never readies', async () => {
        const scope = makeMockScope([]);
        const env = fixture.build(scope);
        const waitP = env.subscription.readiness.waitForReady(env.ownerId, 500);
        await vi.advanceTimersByTimeAsync(501);
        const outcome = await waitP;
        expect(outcome).toBe('timeout');
        env.subscription.teardown();
      });

      it('nextRequestId increments per call and is independent across instances', () => {
        const scope1 = makeMockScope([]);
        const env1 = fixture.build(scope1);
        expect(env1.subscription.readiness.nextRequestId()).toBe(1);
        expect(env1.subscription.readiness.nextRequestId()).toBe(2);
        const scope2 = makeMockScope([]);
        const env2 = fixture.build(scope2);
        expect(env2.subscription.readiness.nextRequestId()).toBe(1);
        expect(env1.subscription.readiness.nextRequestId()).toBe(3);
        env1.subscription.teardown();
        env2.subscription.teardown();
      });
    });
  }
});

describe('WorkerOwnerBinding — worker-specific lifecycle traps', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null from resolveOwner once the Worker client is gone (no goodbye)', async () => {
    const scope = makeMockScope([]);
    const env = workerFixture().build(scope);
    env.postReady();
    expect(env.subscription.readiness.isReady(env.ownerId)).toBe(true);
    // Simulate worker termination without a chance to send goodbye —
    // the SW still has the port→ownerId mapping but `clients.get` reports
    // the worker as gone.
    scope.removeClient(env.ownerId);
    const owner = await env.binding.resolveOwner(
      scope as unknown as ServiceWorkerGlobalScope,
      new Request('http://x/preview/3000/'),
      'owner-A',
      3000,
    );
    expect(owner).toBeNull();
    env.subscription.teardown();
  });

  it('lets a fresh Worker take over the port after the previous one departs', async () => {
    const scope = makeMockScope([]);
    const env = workerFixture().build(scope);
    env.postReady();
    expect(env.subscription.readiness.isReady(env.ownerId)).toBe(true);
    // First worker leaves cleanly.
    env.postGoodbye();
    scope.removeClient(env.ownerId);
    expect(env.subscription.readiness.isReady(env.ownerId)).toBe(false);
    // Second worker claims the same port.
    const worker2 = makeMockClient('worker-B', 'worker');
    (scope.clients.get as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) =>
      id === 'worker-B' ? worker2 : undefined,
    );
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [3000],
        ownerToken: 'owner-A',
      },
      worker2,
    );
    expect(env.subscription.readiness.isReady('worker-B')).toBe(true);
    const owner = await env.binding.resolveOwner(
      scope as unknown as ServiceWorkerGlobalScope,
      new Request('http://x/preview/3000/'),
      'owner-A',
      3000,
    );
    expect(owner?.id).toBe('worker-B');
    env.subscription.teardown();
  });

  it('routes different ports to different Workers', async () => {
    const scope = makeMockScope([]);
    const env = workerFixture().build(scope);
    // worker-A claims port 3000 (default from the fixture). Add a second
    // worker claiming port 5173 and assert routing diverges.
    env.postReady();
    const workerB = makeMockClient('worker-B', 'worker');
    const table = new Map<string, MockClient>([
      [env.ownerId, env.owner],
      ['worker-B', workerB],
    ]);
    (scope.clients.get as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) =>
      table.get(id),
    );
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5173],
        ownerToken: 'owner-A',
      },
      workerB,
    );
    const own3000 = await env.binding.resolveOwner(
      scope as unknown as ServiceWorkerGlobalScope,
      new Request('http://x/preview/3000/'),
      'owner-A',
      3000,
    );
    const own5173 = await env.binding.resolveOwner(
      scope as unknown as ServiceWorkerGlobalScope,
      new Request('http://x/preview/5173/'),
      'owner-A',
      5173,
    );
    expect(own3000?.id).toBe(env.ownerId);
    expect(own5173?.id).toBe('worker-B');
    env.subscription.teardown();
  });

  it('drops only the ports named by a worker goodbye frame', async () => {
    const scope = makeMockScope([]);
    const env = workerFixture().build(scope);
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [3000, 5173],
        ownerToken: 'owner-A',
      },
      env.owner,
    );
    scope.postMessage(
      {
        type: SW_PREVIEW_GOODBYE,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [3000],
        ownerToken: 'owner-A',
      },
      env.owner,
    );

    const dropped = await env.binding.resolveOwner(
      scope as unknown as ServiceWorkerGlobalScope,
      new Request('http://x/preview/3000/'),
      'owner-A',
      3000,
    );
    const kept = await env.binding.resolveOwner(
      scope as unknown as ServiceWorkerGlobalScope,
      new Request('http://x/preview/5173/'),
      'owner-A',
      5173,
    );

    expect(dropped).toBeNull();
    expect(kept?.id).toBe(env.ownerId);
    env.subscription.teardown();
  });

  it('a worker readiness frame WITHOUT ports is a no-op (does not claim port 0)', async () => {
    const scope = makeMockScope([]);
    const env = workerFixture().build(scope);
    // Hand-rolled ready frame missing the `ports` field — bug shape we
    // need to refuse silently rather than registering ownership of an
    // implicit port like 0.
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      env.owner,
    );
    // The binding records readiness for the worker but does NOT register
    // any port ownership — so a fetch for port 3000 cannot find an owner.
    const owner = await env.binding.resolveOwner(
      scope as unknown as ServiceWorkerGlobalScope,
      new Request('http://x/preview/3000/'),
      'owner-A',
      3000,
    );
    expect(owner).toBeNull();
    env.subscription.teardown();
  });
});

describe('FirstWindowOwnerBinding — window-specific behaviour', () => {
  it('preserves the historical fallback-to-first-window behaviour with one-shot warn', async () => {
    const scope = makeMockScope([]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const a = makeMockClient('client-A', 'window');
      const b = makeMockClient('client-B', 'window');
      const table = new Map([
        ['client-A', a],
        ['client-B', b],
      ]);
      (scope.clients.get as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) =>
        table.get(id),
      );
      (scope.clients.matchAll as ReturnType<typeof vi.fn>).mockImplementation(
        async (matchOpts?: { type?: ClientTypes }) => {
          const all = [...table.values()];
          if (!matchOpts?.type) return all;
          return all.filter((c) => c.type === matchOpts.type);
        },
      );
      const binding = new FirstWindowOwnerBinding();
      const sub = binding.subscribeReadiness(scope as unknown as ServiceWorkerGlobalScope);
      // No clientId — falls back to the first controlled window once,
      // warns once per scope.
      const owner1 = await binding.resolveOwner(
        scope as unknown as ServiceWorkerGlobalScope,
        new Request('http://x/preview/3000/'),
        null,
        3000,
      );
      expect(owner1?.id).toBe('client-A');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const owner2 = await binding.resolveOwner(
        scope as unknown as ServiceWorkerGlobalScope,
        new Request('http://x/preview/3000/'),
        null,
        3000,
      );
      expect(owner2?.id).toBe('client-A');
      // Second fallback — no extra warning (dedup keyed by scope).
      expect(warnSpy).toHaveBeenCalledTimes(1);
      sub.teardown();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
