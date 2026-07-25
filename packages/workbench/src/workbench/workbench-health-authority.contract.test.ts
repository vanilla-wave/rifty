import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ClosedHandleError } from './errors.ts';
import type {
  WorkbenchHealth,
  WorkbenchHealthIssue,
  WorkbenchHealthSnapshot,
  WorkbenchRecoveryScope,
} from './health.ts';
import { createWorkbenchHealthAuthority } from './internal/workbench-health-authority.ts';
import type { Workbench } from './open-workbench.ts';
import type { PlaygroundSessionToolsView, PlaygroundWorkbench } from './playground.ts';
import type { WorkbenchHealth as RootWorkbenchHealth } from './public.ts';

type ExpectedRecoveryScope = 'scm' | 'preview' | 'persistence' | 'reload';

type ExpectedHealthIssue =
  | {
      readonly kind: 'degraded';
      readonly scope: 'scm' | 'preview' | 'persistence';
      readonly summary: string;
      readonly recovery: 'scm' | 'preview' | 'persistence';
    }
  | {
      readonly kind: 'unavailable';
      readonly scope: 'owner';
      readonly summary: string;
      readonly recovery: 'reload';
    }
  | {
      readonly kind: 'fatal';
      readonly scope: 'invariant';
      readonly summary: string;
      readonly recovery: 'reload';
    };

type ExpectedHealthSnapshot = {
  readonly disposition: 'healthy' | 'degraded' | 'unavailable' | 'fatal';
  readonly issues: readonly WorkbenchHealthIssue[];
};

type ExpectedHealth = {
  snapshot(): WorkbenchHealthSnapshot;
  subscribe(listener: (snapshot: WorkbenchHealthSnapshot) => void): () => void;
  recover(scope: WorkbenchRecoveryScope): Promise<void>;
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
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

function issue(
  snapshot: WorkbenchHealthSnapshot,
  scope: WorkbenchHealthIssue['scope'],
): WorkbenchHealthIssue | undefined {
  return snapshot.issues.find((candidate) => candidate.scope === scope);
}

describe('Workbench health authority contract', () => {
  it('exposes one public snapshot/subscribe/recover seam on Workbench and session tools', () => {
    expectTypeOf<WorkbenchRecoveryScope>().toEqualTypeOf<ExpectedRecoveryScope>();
    expectTypeOf<WorkbenchHealthIssue>().toEqualTypeOf<ExpectedHealthIssue>();
    expectTypeOf<WorkbenchHealthSnapshot>().toEqualTypeOf<ExpectedHealthSnapshot>();
    expectTypeOf<WorkbenchHealth>().toEqualTypeOf<ExpectedHealth>();
    expectTypeOf<RootWorkbenchHealth>().toEqualTypeOf<WorkbenchHealth>();
    expectTypeOf<Workbench['health']>().toEqualTypeOf<WorkbenchHealth>();
    expectTypeOf<PlaygroundSessionToolsView['health']>().toEqualTypeOf<WorkbenchHealth>();
    expectTypeOf<
      ReturnType<PlaygroundWorkbench['playground']['forSession']>
    >().toEqualTypeOf<PlaygroundSessionToolsView>();
  });

  it('replays immutable snapshots, isolates listeners, replaces exact scopes, and applies severity priority', () => {
    const authority = createWorkbenchHealthAuthority({
      recover: () => Promise.resolve(),
    });
    const generation = authority.openGeneration('project-generation-a');
    const observed: WorkbenchHealthSnapshot[] = [];

    expect(authority.health.snapshot()).toEqual({ disposition: 'healthy', issues: [] });
    expect(Object.isFrozen(authority.health.snapshot())).toBe(true);
    expect(() =>
      authority.health.subscribe(() => {
        throw new Error('listener must not own health publication');
      }),
    ).not.toThrow();
    generation.health.subscribe((snapshot) => observed.push(snapshot));
    expect(observed).toEqual([{ disposition: 'healthy', issues: [] }]);

    expect(() =>
      generation.reporter.degraded({ scope: 'scm', summary: 'First SCM failure' }),
    ).not.toThrow();
    generation.reporter.degraded({ scope: 'scm', summary: 'Latest SCM failure' });

    expect(authority.health.snapshot().disposition).toBe('degraded');
    expect(authority.health.snapshot().issues.filter(({ scope }) => scope === 'scm')).toEqual([
      {
        kind: 'degraded',
        scope: 'scm',
        summary: 'Latest SCM failure',
        recovery: 'scm',
      },
    ]);
    expect(generation.health.snapshot()).toEqual(authority.health.snapshot());

    authority.owner.unavailable({ summary: 'Workbench owner exited' });
    expect(authority.health.snapshot().disposition).toBe('unavailable');
    authority.invariant.fatal({ summary: 'First protocol invariant failure' });
    authority.invariant.fatal({ summary: 'Later protocol invariant failure' });

    const fatalSnapshot = authority.health.snapshot();
    expect(fatalSnapshot.disposition).toBe('fatal');
    expect(issue(fatalSnapshot, 'invariant')).toEqual({
      kind: 'fatal',
      scope: 'invariant',
      summary: 'First protocol invariant failure',
      recovery: 'reload',
    });
    expect(Object.isFrozen(fatalSnapshot.issues)).toBe(true);
    expect(fatalSnapshot.issues.every(Object.isFrozen)).toBe(true);
    expect(observed.at(-1)).toEqual(fatalSnapshot);
    expect(generation.reporter).not.toHaveProperty('fatal');
    expectTypeOf(generation.reporter).not.toHaveProperty('fatal');
  });

  it('coalesces recovery across Workbench and generation views, then heals the exact issue', async () => {
    const recovery = deferred<void>();
    const recover = vi.fn((_scope: WorkbenchRecoveryScope) => recovery.promise);
    const authority = createWorkbenchHealthAuthority({ recover });
    const generation = authority.openGeneration('project-generation-a');
    const workbenchSnapshots: WorkbenchHealthSnapshot[] = [];
    const sessionSnapshots: WorkbenchHealthSnapshot[] = [];
    authority.health.subscribe((snapshot) => workbenchSnapshots.push(snapshot));
    generation.health.subscribe((snapshot) => sessionSnapshots.push(snapshot));
    generation.reporter.degraded({ scope: 'persistence', summary: 'Durability proof failed' });

    const first = authority.health.recover('persistence');
    const second = generation.health.recover('persistence');

    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith('persistence');
    recovery.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);

    expect(authority.health.snapshot()).toEqual({ disposition: 'healthy', issues: [] });
    expect(generation.health.snapshot()).toEqual(authority.health.snapshot());
    expect(workbenchSnapshots.at(-1)).toEqual(authority.health.snapshot());
    expect(sessionSnapshots.at(-1)).toEqual(authority.health.snapshot());
  });

  it('fences a recovery completion and reports from a closed project generation', async () => {
    const staleRecovery = deferred<void>();
    const authority = createWorkbenchHealthAuthority({
      recover: (scope) =>
        scope === 'preview' ? staleRecovery.promise : Promise.reject(new Error('unexpected scope')),
    });
    const stale = authority.openGeneration('project-generation-a');
    stale.reporter.degraded({ scope: 'preview', summary: 'Old preview proof failed' });
    const recovering = stale.health.recover('preview');

    stale.close();
    const current = authority.openGeneration('project-generation-b');
    current.reporter.degraded({ scope: 'preview', summary: 'Current preview proof failed' });

    expect(() => stale.health.snapshot()).toThrow(ClosedHandleError);
    expect(() =>
      stale.reporter.degraded({ scope: 'scm', summary: 'Late stale-generation failure' }),
    ).toThrow(ClosedHandleError);

    staleRecovery.resolve();
    await expect(recovering).resolves.toBeUndefined();
    expect(issue(authority.health.snapshot(), 'preview')).toEqual({
      kind: 'degraded',
      scope: 'preview',
      summary: 'Current preview proof failed',
      recovery: 'preview',
    });
    expect(current.health.snapshot()).toEqual(authority.health.snapshot());
  });
});
