import { describe, expect, it, vi } from 'vitest';
import {
  type InspectedProjectDefinition,
  inspectProjectDefinition,
  projects,
} from './project-definition.ts';
import type { ProjectSession } from './project-session.ts';
import {
  type RawWorkspaceOwnerHandle,
  type WorkbenchOwnerStartInput,
  createWorkbenchOwnerPort,
} from './workbench-owner-port.ts';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolved, rejected) => {
    resolve = resolved;
    reject = rejected;
  });
  return { promise, reject, resolve };
}

const REQUIRED_STORAGE = Object.freeze({
  policy: 'required' as const,
  backend: 'opfs' as const,
  durability: 'durable' as const,
});

function ownerInput(
  persistence: WorkbenchOwnerStartInput['storage']['persistence'] = 'required',
): WorkbenchOwnerStartInput {
  return Object.freeze({
    deployment: Object.freeze({
      workers: Object.freeze({
        owner: 'https://workbench.invalid/owner.js',
        kernel: 'https://workbench.invalid/kernel.js',
        node: 'https://workbench.invalid/node.js',
        devServer: 'https://workbench.invalid/dev-server.js',
      }),
      wasm: Object.freeze({
        sqlite: 'https://workbench.invalid/sqlite.wasm',
        esbuild: 'https://workbench.invalid/esbuild.wasm',
      }),
      previewProbeTimeoutMs: 3_000,
    }),
    packageAcquisition: Object.freeze({
      registryUrl: 'https://registry.invalid/',
      eddy: Object.freeze({
        resolverUrl: 'https://eddy.invalid/resolve',
        bundleBaseUrl: 'https://eddy.invalid/bundles/',
        presetPins: Object.freeze({ vite: '8.0.16' }),
      }),
    }),
    storage: Object.freeze({ persistence }),
  });
}

function harness(snapshot: unknown = REQUIRED_STORAGE) {
  const ready = deferred<void>();
  const closed = deferred<unknown>();
  // Contract stubs do not consume these boundary promises yet. Observe both so
  // the RED suite reports assertion failures, never test-process noise.
  void ready.promise.catch(() => {});
  void closed.promise.catch(() => {});
  const close = vi.fn<() => void>();
  const storageSnapshot = vi.fn<() => unknown>(() => snapshot);
  const openProject = vi.fn(
    async (_definition: InspectedProjectDefinition): Promise<ProjectSession<unknown>> => {
      throw new Error('raw openProject test implementation is not configured');
    },
  );
  const deleteProject = vi.fn(async (_id: string): Promise<void> => {});
  const raw: RawWorkspaceOwnerHandle = {
    ready: ready.promise,
    closed: closed.promise,
    storageSnapshot,
    openProject<TReady>(definition: InspectedProjectDefinition<TReady>) {
      return openProject(definition) as Promise<ProjectSession<TReady>>;
    },
    deleteProject,
    close,
  };
  const startWorkspaceOwner = vi.fn((_input: WorkbenchOwnerStartInput) => raw);
  const port = createWorkbenchOwnerPort({ startWorkspaceOwner });
  return {
    close,
    closed,
    deleteProject,
    openProject,
    port,
    raw,
    ready,
    startWorkspaceOwner,
    storageSnapshot,
  };
}

async function expectPending(promise: Promise<unknown>): Promise<void> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.resolve();
  expect(settled).toBe(false);
}

describe('Workbench owner port startup contract', () => {
  // Fault class: provenance-lie. Storage comes from the admitted owner after
  // ready, never by re-deriving a snapshot from the requested page policy.
  it('awaits owner readiness and returns the exact owner-born storage snapshot', async () => {
    const snapshot = Object.freeze({
      policy: 'preferred' as const,
      backend: 'memory' as const,
      durability: 'ephemeral' as const,
      fallback: Object.freeze({ reason: 'OPFS permission denied' }),
    });
    const h = harness(snapshot);
    const input = ownerInput('preferred');

    const opening = h.port.start(input);
    await expectPending(opening);
    expect(h.storageSnapshot).not.toHaveBeenCalled();

    h.ready.resolve(undefined);
    const started = await opening;

    expect(h.startWorkspaceOwner).toHaveBeenCalledWith(input);
    expect(h.storageSnapshot).toHaveBeenCalledTimes(1);
    expect(started.storage).toBe(snapshot);
    expect(h.close).not.toHaveBeenCalled();
  });

  it('freezes the valid structured-clone snapshot and nested fallback at owner ingress', async () => {
    const snapshot = {
      policy: 'preferred',
      backend: 'memory',
      durability: 'ephemeral',
      fallback: { reason: 'OPFS quota exhausted' },
    };
    const h = harness(snapshot);
    const opening = h.port.start(ownerInput('preferred'));
    h.ready.resolve(undefined);

    const started = await opening;

    expect(started.storage).toBe(snapshot);
    expect(Object.isFrozen(started.storage)).toBe(true);
    if (started.storage.policy !== 'preferred' || started.storage.backend !== 'memory') {
      throw new Error('test owner snapshot must be preferred memory');
    }
    expect(Object.isFrozen(started.storage.fallback)).toBe(true);

    const closing = started.owner.close();
    h.closed.resolve(0);
    await closing;
  });

  it('forwards the exact full normalized input and exposes the pure owner operation surface', async () => {
    const h = harness();
    const input = ownerInput('required');
    const opening = h.port.start(input);
    h.ready.resolve(undefined);
    const { owner } = await opening;

    expect(h.startWorkspaceOwner).toHaveBeenCalledWith(input);
    expect(h.startWorkspaceOwner.mock.calls[0]?.[0]).toBe(input);

    const definition = inspectProjectDefinition(
      projects.vite({ id: 'owner-forwarding', files: { '/index.html': '<main />' } }),
    );
    const openFailure = new Error('raw open project failed exactly');
    h.openProject.mockRejectedValueOnce(openFailure);
    await expect(owner.openProject(definition)).rejects.toBe(openFailure);
    expect(h.openProject).toHaveBeenCalledWith(definition);

    const deleteFailure = new Error('raw delete project failed exactly');
    h.deleteProject.mockRejectedValueOnce(deleteFailure);
    await expect(owner.deleteProject('owner-forwarding')).rejects.toBe(deleteFailure);
    expect(h.deleteProject).toHaveBeenCalledWith('owner-forwarding');

    const closing = owner.close();
    h.closed.resolve(0);
    await closing;
  });

  it('rejects loudly when the physical owner exits before readiness', async () => {
    const h = harness();
    const opening = h.port.start(ownerInput());
    void opening.catch(() => {});

    h.closed.resolve(17);

    await expect(opening).rejects.toThrow(/owner.*exited before readiness/i);
    h.ready.resolve(undefined);
    await Promise.resolve();
    expect(h.storageSnapshot).not.toHaveBeenCalled();
    expect(h.close).not.toHaveBeenCalled();
  });

  it('preserves an exact physical-exit observation failure before readiness', async () => {
    const h = harness();
    const failure = new Error('owner worker exit observation failed');
    const opening = h.port.start(ownerInput());
    void opening.catch(() => {});

    h.closed.reject(failure);

    await expect(opening).rejects.toBe(failure);
    h.ready.resolve(undefined);
    await Promise.resolve();
    expect(h.storageSnapshot).not.toHaveBeenCalled();
    expect(h.close).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'required memory lie',
      persistence: 'required' as const,
      snapshot: { policy: 'required', backend: 'memory', durability: 'ephemeral' },
    },
    {
      label: 'preferred fallback without reason',
      persistence: 'preferred' as const,
      snapshot: { policy: 'preferred', backend: 'memory', durability: 'ephemeral' },
    },
    {
      label: 'durable snapshot with forbidden fallback',
      persistence: 'preferred' as const,
      snapshot: {
        policy: 'preferred',
        backend: 'opfs',
        durability: 'durable',
        fallback: { reason: 'must not exist' },
      },
    },
    {
      label: 'ephemeral OPFS lie',
      persistence: 'ephemeral' as const,
      snapshot: { policy: 'ephemeral', backend: 'opfs', durability: 'durable' },
    },
    {
      label: 'preferred fallback with non-string reason',
      persistence: 'preferred' as const,
      snapshot: {
        policy: 'preferred',
        backend: 'memory',
        durability: 'ephemeral',
        fallback: { reason: 17 },
      },
    },
  ])(
    'rejects malformed owner snapshot: $label, then physically cleans up',
    async ({ persistence, snapshot }) => {
      const h = harness(snapshot);
      const opening = h.port.start(ownerInput(persistence));
      void opening.catch(() => {});

      h.ready.resolve(undefined);
      await Promise.resolve();

      expect(h.close).toHaveBeenCalledTimes(1);
      await expectPending(opening);
      h.closed.resolve(1);
      await expect(opening).rejects.toThrow(/invalid owner storage snapshot/i);
    },
  );

  // Fault class: torn-state. A spawned worker remains adapter-owned until its
  // certified physical exit, even though startup has already failed.
  it('terminates a partial owner and rejects only after physical close settles', async () => {
    const h = harness();
    const failure = new Error('owner bootstrap failed');
    const opening = h.port.start(ownerInput());
    void opening.catch(() => {});

    h.ready.reject(failure);
    await Promise.resolve();

    expect(h.close).toHaveBeenCalledTimes(1);
    await expectPending(opening);

    h.closed.resolve(1);
    await expect(opening).rejects.toBe(failure);
  });

  it('cleans up and rejects after an owner snapshot read fails post-ready', async () => {
    const h = harness();
    const failure = new Error('malformed owner storage snapshot');
    h.storageSnapshot.mockImplementationOnce(() => {
      throw failure;
    });
    const opening = h.port.start(ownerInput());
    void opening.catch(() => {});

    h.ready.resolve(undefined);
    await Promise.resolve();

    expect(h.close).toHaveBeenCalledTimes(1);
    await expectPending(opening);

    h.closed.resolve(1);
    await expect(opening).rejects.toBe(failure);
  });

  it('rejects an owner snapshot for another policy only after cleaning up that owner', async () => {
    const h = harness(
      Object.freeze({
        policy: 'ephemeral',
        backend: 'memory',
        durability: 'ephemeral',
      }),
    );
    const opening = h.port.start(ownerInput());
    void opening.catch(() => {});

    h.ready.resolve(undefined);
    await Promise.resolve();

    expect(h.close).toHaveBeenCalledTimes(1);
    await expectPending(opening);

    h.closed.resolve(1);
    await expect(opening).rejects.toThrow(/owner storage policy mismatch.*required.*ephemeral/i);
  });

  it('preserves startup and cleanup failures in causal order after physical close', async () => {
    const h = harness();
    const startupFailure = new Error('owner bootstrap failed');
    const terminateFailure = new Error('owner terminate failed');
    const closedFailure = new Error('owner exit observation failed');
    h.close.mockImplementationOnce(() => {
      throw terminateFailure;
    });
    const opening = h.port.start(ownerInput());
    void opening.catch(() => {});

    h.ready.reject(startupFailure);
    await Promise.resolve();
    expect(h.close).toHaveBeenCalledTimes(1);
    await expectPending(opening);

    h.closed.reject(closedFailure);
    const error = await opening.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      startupFailure,
      terminateFailure,
      closedFailure,
    ]);
  });

  it('preserves a synchronous spawn failure without fabricating a partial handle', async () => {
    const failure = new Error('kernel spawn failed');
    const startWorkspaceOwner = vi.fn((): RawWorkspaceOwnerHandle => {
      throw failure;
    });
    const port = createWorkbenchOwnerPort({ startWorkspaceOwner });

    await expect(port.start(ownerInput())).rejects.toBe(failure);

    expect(startWorkspaceOwner).toHaveBeenCalledTimes(1);
  });
});

describe('Workbench semantic owner close contract', () => {
  it('returns one stable close promise, terminates once, and waits for physical exit', async () => {
    const h = harness();
    const opening = h.port.start(ownerInput());
    h.ready.resolve(undefined);
    const { owner } = await opening;

    const first = owner.close();
    const repeated = owner.close();

    expect(repeated).toBe(first);
    expect(h.close).toHaveBeenCalledTimes(1);
    await expectPending(first);

    h.closed.resolve(0);
    await expect(first).resolves.toBeUndefined();
    expect(owner.close()).toBe(first);
  });

  it('still awaits physical exit when termination throws, then preserves that failure', async () => {
    const h = harness();
    const failure = new Error('termination request threw');
    h.close.mockImplementationOnce(() => {
      throw failure;
    });
    const opening = h.port.start(ownerInput());
    h.ready.resolve(undefined);
    const { owner } = await opening;

    const closing = owner.close();
    void closing.catch(() => {});
    expect(h.close).toHaveBeenCalledTimes(1);
    await expectPending(closing);

    h.closed.resolve(0);
    await expect(closing).rejects.toBe(failure);
  });

  it('surfaces a physical exit observation failure and remains idempotent', async () => {
    const h = harness();
    const failure = new Error('physical owner close failed');
    const opening = h.port.start(ownerInput());
    h.ready.resolve(undefined);
    const { owner } = await opening;

    const closing = owner.close();
    void closing.catch(() => {});
    h.closed.reject(failure);

    await expect(closing).rejects.toBe(failure);
    expect(owner.close()).toBe(closing);
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it('waits for physical exit and preserves termination then observation failures in order', async () => {
    const h = harness();
    const terminateFailure = new Error('termination request failed');
    const closedFailure = new Error('physical exit observation failed');
    h.close.mockImplementationOnce(() => {
      throw terminateFailure;
    });
    const opening = h.port.start(ownerInput());
    h.ready.resolve(undefined);
    const { owner } = await opening;

    const closing = owner.close();
    void closing.catch(() => {});
    expect(owner.close()).toBe(closing);
    expect(h.close).toHaveBeenCalledTimes(1);
    await expectPending(closing);

    h.closed.reject(closedFailure);
    const error = await closing.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([terminateFailure, closedFailure]);
    expect(owner.close()).toBe(closing);
    expect(h.close).toHaveBeenCalledTimes(1);
  });
});
