import {
  SHADOW_ASSET_CAPABILITY,
  type ShadowAssetPlan,
  type ShadowAssetReadyReceipt,
  planBuiltinShadowAssets,
} from '@riftydev/npm-client';
import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import { describe, expect, it, vi } from 'vitest';
import {
  type OwnerChildAdmissionAuthority,
  type OwnerChildAdmissionHandle,
  admitOwnerChild,
} from './owner-child-admission.ts';
import type { OwnerChildAdmissionReservation } from './owner-package-state.ts';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function plan(): ShadowAssetPlan {
  return planBuiltinShadowAssets([
    {
      catalog: {
        id: builtinShadowAssetCatalog.id,
        digest: builtinShadowAssetCatalog.digest,
      },
      publicName: 'esbuild',
      requestedRange: '^0.28.0',
      resolvedPublicVersion: '0.28.0',
      substitutionId: 'rifty.shadow-substitution.esbuild-wasi-preview1.v1',
      runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
      builtin: true,
    },
  ]);
}

function receipt(assetPlan: ShadowAssetPlan): ShadowAssetReadyReceipt {
  const catalog = assetPlan.substitutions[0]?.catalog;
  if (!catalog) throw new Error('fixture expected one substitution');
  return Object.freeze({
    schema: 1,
    receiptSha256: 'b'.repeat(64),
    requiredSetDigest: assetPlan.requiredSetDigest,
    catalog,
    storageClass: 'memory-session',
    substitutions: assetPlan.substitutions,
    assets: assetPlan.assets.map((asset) =>
      Object.freeze({
        id: asset.id,
        source: asset.source,
        member: asset.member,
        memberSha256: asset.memberSha256,
        memberSize: asset.memberSize,
        fillTransport: 'standard' as const,
        fillCache: 'network' as const,
      }),
    ),
  });
}

class FakeChild implements OwnerChildAdmissionHandle {
  readonly #events: string[];
  #exit: (() => void) | undefined;

  constructor(events: string[]) {
    this.#events = events;
  }

  on(event: 'exit', listener: (...args: unknown[]) => void): unknown {
    this.#events.push(`attach:${event}`);
    this.#exit = listener;
    return this;
  }

  once(event: 'exit', listener: (...args: unknown[]) => void): unknown {
    this.#events.push(`observe:${event}`);
    this.#exit = listener;
    return this;
  }

  kill(signal?: string): unknown {
    this.#events.push(`kill:${signal ?? ''}`);
    this.exit();
    return true;
  }

  exit(): void {
    this.#events.push('exit');
    this.#exit?.();
  }
}

class TornSupervisionChild implements OwnerChildAdmissionHandle {
  readonly #events: string[];
  readonly #attachmentFailure: Error;
  #exit: (() => void) | undefined;

  constructor(events: string[], attachmentFailure: Error) {
    this.#events = events;
    this.#attachmentFailure = attachmentFailure;
  }

  once(event: 'exit', listener: (...args: unknown[]) => void): unknown {
    this.#events.push(`observe:${event}`);
    this.#exit = listener;
    return this;
  }

  on(event: 'exit', _listener: (...args: unknown[]) => void): unknown {
    this.#events.push(`attach:${event}`);
    throw this.#attachmentFailure;
  }

  kill(signal?: string): unknown {
    this.#events.push(`kill:${signal ?? ''}`);
    return true;
  }

  exit(): void {
    this.#events.push('physical-exit');
    this.#exit?.();
  }
}

function authority(
  assetPlan: ShadowAssetPlan,
  events: string[],
  overrides: Partial<OwnerChildAdmissionReservation> = {},
): OwnerChildAdmissionAuthority {
  const reservation: OwnerChildAdmissionReservation = {
    readiness: { kind: 'ready', plan: assetPlan, receipt: receipt(assetPlan) },
    commit: () => events.push('commit'),
    abortBeforeSpawn: () => events.push('abort-before'),
    abortAfterChildSettlement: async (_error, exited) => {
      events.push('abort-after');
      await exited;
      events.push('abort-settled');
    },
    ...overrides,
  };
  return {
    reserve: async () => {
      events.push('reserve');
      return reservation;
    },
    runtimeReader: () => ({ readVerified: vi.fn() }),
  };
}

describe('owner child admission transaction', () => {
  it('aborts the settled reservation before session preparation or physical spawn', async () => {
    const events: string[] = [];
    const abort = new AbortController();
    const assetPlan = plan();
    const child = new FakeChild(events);
    const reservation: OwnerChildAdmissionReservation = {
      readiness: { kind: 'ready', plan: assetPlan, receipt: receipt(assetPlan) },
      commit: () => events.push('commit'),
      abortBeforeSpawn: (error) => {
        expect(error).toMatchObject({ name: 'AbortError' });
        events.push('abort-before');
      },
      abortAfterChildSettlement: async () => {
        events.push('abort-after');
      },
    };
    const settled = Promise.resolve(reservation);
    const admission = admitOwnerChild({
      authority: {
        reserve: (options) => {
          expect(options).toEqual({ signal: abort.signal });
          events.push('reserve');
          void settled.then(() => {
            events.push('settled-abort');
            abort.abort();
          });
          return settled;
        },
        runtimeReader: () => {
          events.push('prepare-session');
          return { readVerified: vi.fn() };
        },
      },
      signal: abort.signal,
      beforeSpawn: () => events.push('before-spawn'),
      spawn: () => {
        events.push('spawn');
        return child;
      },
      supervise: () => {
        events.push('supervise');
        return child;
      },
    });

    const outcome = await admission.then(
      (value) => ({ kind: 'resolved' as const, value }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );
    if (outcome.kind === 'resolved') outcome.value.exit();

    expect(outcome).toMatchObject({ kind: 'rejected', error: { name: 'AbortError' } });
    expect(events).toEqual(['reserve', 'settled-abort', 'abort-before']);
  });

  it('commits an attested empty plan without constructing a channel or reader', async () => {
    const events: string[] = [];
    const child = new FakeChild(events);
    const reservation: OwnerChildAdmissionReservation = {
      readiness: { kind: 'not-required' },
      commit: () => events.push('commit'),
      abortBeforeSpawn: () => events.push('abort-before'),
      abortAfterChildSettlement: async () => {
        events.push('abort-after');
      },
    };

    await admitOwnerChild({
      authority: {
        reserve: async () => reservation,
        runtimeReader: () => {
          throw new Error('empty admission must not construct a reader');
        },
      },
      spawn: (capabilities) => {
        expect(capabilities).toBeUndefined();
        events.push('spawn');
        return child;
      },
      supervise: () => {
        events.push('supervise');
        return child;
      },
    });
    expect(events).toEqual(['spawn', 'observe:exit', 'supervise', 'commit']);
    child.exit();
  });

  it('creates a fresh exact-plan peer and commits only after physical spawn supervision', async () => {
    const assetPlan = plan();
    const firstEvents: string[] = [];
    const secondEvents: string[] = [];
    const peers: MessagePort[] = [];

    for (const events of [firstEvents, secondEvents]) {
      const child = new FakeChild(events);
      await admitOwnerChild({
        authority: authority(assetPlan, events),
        beforeSpawn: () => events.push('before-spawn'),
        spawn: (capabilities) => {
          events.push('spawn');
          const peer = capabilities?.[SHADOW_ASSET_CAPABILITY];
          if (!peer) throw new Error('fixture expected a shadow asset peer');
          peers.push(peer);
          return child;
        },
        supervise: (_handle, lifecycle) => {
          events.push('supervise');
          expect(lifecycle.dispose).toBeTypeOf('function');
          return child;
        },
      });
      child.exit();
      await Promise.resolve();
    }

    expect(firstEvents.slice(0, 6)).toEqual([
      'reserve',
      'before-spawn',
      'spawn',
      'observe:exit',
      'supervise',
      'commit',
    ]);
    expect(secondEvents.slice(0, 6)).toEqual(firstEvents.slice(0, 6));
    expect(peers).toHaveLength(2);
    expect(peers[0]).not.toBe(peers[1]);
  });

  it('aborts before spawn when the physical boundary throws', async () => {
    const events: string[] = [];
    const failure = new Error('spawn failed');

    await expect(
      admitOwnerChild({
        authority: authority(plan(), events),
        spawn: () => {
          events.push('spawn');
          throw failure;
        },
        supervise: () => {
          throw new Error('unreachable');
        },
      }),
    ).rejects.toBe(failure);
    expect(events).toEqual(['reserve', 'spawn', 'abort-before']);
  });

  it('terminates an unexposed child and holds abort settlement after attach failure', async () => {
    const events: string[] = [];
    const failure = new Error('attach failed');
    const child = new FakeChild(events);

    await expect(
      admitOwnerChild({
        authority: authority(plan(), events),
        spawn: () => {
          events.push('spawn');
          return child;
        },
        supervise: () => {
          events.push('supervise');
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(events).toEqual([
      'reserve',
      'spawn',
      'observe:exit',
      'supervise',
      'kill:SIGTERM',
      'exit',
      'abort-after',
      'abort-settled',
    ]);
  });

  it('terminates the supervised child and aborts after settlement when commit throws', async () => {
    const events: string[] = [];
    const commitFailure = new Error('commit failed');
    const child = new FakeChild(events);

    await expect(
      admitOwnerChild({
        authority: authority(plan(), events, {
          commit: () => {
            events.push('commit');
            throw commitFailure;
          },
        }),
        spawn: () => {
          events.push('spawn');
          return child;
        },
        supervise: () => {
          events.push('supervise');
          return Object.freeze({ exposed: false });
        },
      }),
    ).rejects.toBe(commitFailure);
    expect(events).toEqual([
      'reserve',
      'spawn',
      'observe:exit',
      'supervise',
      'commit',
      'kill:SIGTERM',
      'exit',
      'abort-after',
      'abort-settled',
    ]);
  });

  it('retains its dedicated physical-exit observer when later supervision attachment throws', async () => {
    const events: string[] = [];
    const attachmentFailure = new Error('exit supervision attach failed');
    const settlementFailure = new Error('reservation settlement failed');
    const child = new TornSupervisionChild(events, attachmentFailure);
    let peer: MessagePort | undefined;
    const assetPlan = plan();
    const admission = admitOwnerChild({
      authority: authority(assetPlan, events, {
        abortAfterChildSettlement: async (error, exited) => {
          expect(error).toBe(attachmentFailure);
          events.push('abort-after');
          await exited;
          events.push('abort-settled');
          throw settlementFailure;
        },
      }),
      spawn: (capabilities) => {
        events.push('spawn');
        peer = capabilities?.[SHADOW_ASSET_CAPABILITY];
        if (!peer) throw new Error('fixture expected a shadow asset peer');
        peer.addEventListener('close', () => events.push('dispose'), { once: true });
        peer.start();
        return child;
      },
      supervise: (handle) => {
        events.push('supervise-start');
        handle.on('exit', () => {});
        events.push('supervised');
        return Object.freeze({ exposed: true });
      },
    });
    let settled = false;
    const outcome = admission
      .catch((error: unknown) => error)
      .then((result) => {
        settled = true;
        return result;
      });

    await vi.waitFor(() => {
      expect(events).toContain('kill:SIGTERM');
      expect(events).toContain('dispose');
      expect(events).toContain('abort-after');
    });
    expect(events).not.toContain('supervised');
    expect(events).not.toContain('commit');
    expect(settled).toBe(false);

    child.exit();
    const error = await outcome;
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([attachmentFailure, settlementFailure]);
    expect(events).toContain('abort-settled');
    peer?.close();
  });

  it('holds the reservation until physical exit when session disposal rejects first', async () => {
    const events: string[] = [];
    const supervisionFailure = new Error('supervision attach failed');
    const sessionFailure = new Error('session disposal failed');
    const child = new TornSupervisionChild(events, supervisionFailure);
    const disposal = deferred<void>();
    let held = true;
    let disposeCalls = 0;
    const admitWithDependencies = admitOwnerChild as unknown as (
      options: Parameters<typeof admitOwnerChild>[0],
      dependencies: Readonly<{
        prepareSession(
          reservation: OwnerChildAdmissionReservation,
          authority: OwnerChildAdmissionAuthority,
        ): Readonly<{
          dispose(): Promise<void>;
        }>;
      }>,
    ) => Promise<unknown>;

    const admission = admitWithDependencies(
      {
        authority: authority(plan(), events, {
          abortAfterChildSettlement: async (error, exited) => {
            expect(error).toBe(supervisionFailure);
            events.push('abort-after');
            try {
              await exited;
            } finally {
              held = false;
              events.push('reservation-released');
            }
          },
        }),
        spawn: () => {
          events.push('spawn');
          return child;
        },
        supervise: (handle) => {
          events.push('supervise-start');
          handle.on('exit', () => {});
          throw new Error('unreachable');
        },
      },
      {
        prepareSession: () => ({
          dispose: () => {
            disposeCalls += 1;
            return disposal.promise;
          },
        }),
      },
    );
    let settled = false;
    const outcome = admission
      .catch((error: unknown) => error)
      .then((result) => {
        settled = true;
        return result;
      });

    await vi.waitFor(() => {
      expect(disposeCalls).toBeGreaterThan(0);
      expect(events).toContain('kill:SIGTERM');
      expect(events).toContain('abort-after');
    });
    disposal.reject(sessionFailure);
    await disposal.promise.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(held).toBe(true);
    expect(settled).toBe(false);

    child.exit();
    const error = await outcome;
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([supervisionFailure, sessionFailure]);
    expect(held).toBe(false);
    expect(events.indexOf('physical-exit')).toBeLessThan(events.indexOf('reservation-released'));
    expect(events).not.toContain('commit');
  });
});
