import { describe, expect, it, vi } from 'vitest';
import {
  type VfsMutationGuard,
  type VfsMutationIntent,
  guardVfsMutations,
} from './mutation-intent.ts';

const WRITE = { kind: 'write', path: '/workspace/package.json' } as const;

describe('guardVfsMutations', () => {
  it('preserves the synchronous apply result when no guard is installed', () => {
    const apply = vi.fn(() => 42);

    expect(guardVfsMutations(undefined, [WRITE], apply)).toBe(42);
    expect(apply).toHaveBeenCalledOnce();
  });

  it('passes one closed intent batch and returns only the apply result', () => {
    const intents = [
      WRITE,
      { kind: 'replace', path: '/workspace/src' },
      { kind: 'mkdir', path: '/workspace/node_modules' },
      { kind: 'rm', path: '/workspace/old' },
      { kind: 'utimes', path: '/workspace/package.json' },
      { kind: 'rename', sourcePath: '/workspace/a', targetPath: '/workspace/b' },
      { kind: 'copy', sourcePath: '/source', targetPath: '/workspace/copied' },
    ] satisfies readonly VfsMutationIntent[];
    const seen: VfsMutationIntent[][] = [];
    const guard: VfsMutationGuard = (batch, apply) => {
      seen.push([...batch]);
      apply();
      return undefined as never;
    };

    expect(guardVfsMutations(guard, intents, () => 'applied')).toBe('applied');
    expect(seen).toEqual([intents]);
  });

  it('holds async apply until the guard opens and preserves its result', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const apply = vi.fn(() => 7);
    const guard: VfsMutationGuard = async (_intents, guardedApply) => {
      await gate;
      return guardedApply();
    };

    const pending = guardVfsMutations(guard, [WRITE], apply);
    await Promise.resolve();
    expect(apply).not.toHaveBeenCalled();
    release();

    await expect(pending).resolves.toBe(7);
    expect(apply).toHaveBeenCalledOnce();
  });

  it('awaits an async apply even when a fulfilled guard forgets to return it', async () => {
    let finishApply!: () => void;
    const applyGate = new Promise<void>((resolve) => {
      finishApply = resolve;
    });
    const guard = ((_: readonly VfsMutationIntent[], apply: () => Promise<number>) => {
      void apply();
      return undefined;
    }) as VfsMutationGuard;
    const pending = guardVfsMutations(guard, [WRITE], async () => {
      await applyGate;
      return 9;
    });

    let settled = false;
    void Promise.resolve(pending).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finishApply();

    await expect(pending).resolves.toBe(9);
  });

  it('rejects an empty mutation batch before invoking the guard', () => {
    const guard = vi.fn() as unknown as VfsMutationGuard;

    expect(() => guardVfsMutations(guard, [], () => {})).toThrow(
      'VfsMutationGuard: mutation batch must not be empty',
    );
    expect(guard).not.toHaveBeenCalled();
  });

  it('rejects fulfilled guards that did not apply and double application', async () => {
    const missing = (async () => undefined) as VfsMutationGuard;
    await expect(guardVfsMutations(missing, [WRITE], () => 1)).rejects.toThrow(
      'VfsMutationGuard: fulfilled without apply for write',
    );

    const apply = vi.fn(() => 1);
    const twice = ((_: readonly VfsMutationIntent[], guardedApply: () => unknown) => {
      guardedApply();
      guardedApply();
    }) as VfsMutationGuard;
    expect(() => guardVfsMutations(twice, [WRITE], apply)).toThrow(
      'VfsMutationGuard: apply called more than once for write',
    );
    expect(apply).toHaveBeenCalledOnce();
  });

  it('allows rejection before apply and closes the continuation against late writes', async () => {
    const failure = new Error('durable revoke failed');
    let lateApply!: () => unknown;
    const guard = ((_: readonly VfsMutationIntent[], apply: () => unknown) => {
      lateApply = apply;
      return Promise.reject(failure);
    }) as VfsMutationGuard;
    const apply = vi.fn(() => 1);

    await expect(guardVfsMutations(guard, [WRITE], apply)).rejects.toBe(failure);
    expect(() => lateApply()).toThrow('VfsMutationGuard: apply called after settlement for write');
    expect(apply).not.toHaveBeenCalled();
  });
});
