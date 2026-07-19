import { describe, expect, it, vi } from 'vitest';
import { runStandardShadowAssetColdContexts } from './shadow-asset-cold-harness.mjs';

const expected = Object.freeze({
  assetId: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
  requiredSetDigest: 'a'.repeat(64),
  memberBytes: 13_918_738,
});

function measuredRun(index: number) {
  return Object.freeze({
    durationMs: 100 + index,
    requiredSetDigest: expected.requiredSetDigest,
    storageClass: 'opfs-persisted' as const,
    fillTransport: 'standard' as const,
    fillCache: 'network' as const,
    memberBytes: expected.memberBytes,
    responseBodyBytes: Object.freeze({
      packumentDecoded: 600 + index,
      tarball: 3_500_000 + index,
      total: 3_500_600 + index * 2,
    }),
    transport: Object.freeze({
      mode: 'auto' as const,
      origins: Object.freeze({
        'https://registry.example': Object.freeze({ protocol: 'h2', requests: 2 }),
      }),
    }),
  });
}

describe('standard shadow-asset cold context harness', () => {
  it('discards one isolated warm-up then returns exactly five validated runs', async () => {
    const events: string[] = [];
    const contexts = Array.from({ length: 6 }, (_, index) => ({
      async measure() {
        events.push(`measure:${index}`);
        return { index };
      },
      async close() {
        events.push(`close:${index}`);
      },
    }));
    const createContext = vi.fn(async () => contexts[createContext.mock.calls.length - 1]);
    const buildRun = vi.fn(({ index }: { readonly index: number }) => ({
      ok: true as const,
      run: measuredRun(index),
    }));

    await expect(
      runStandardShadowAssetColdContexts({ createContext, buildRun }),
    ).resolves.toEqual({
      status: 'measured',
      runs: [1, 2, 3, 4, 5].map(measuredRun),
    });
    expect(createContext.mock.calls).toEqual([
      [{ kind: 'warmup' }],
      [{ kind: 'measured', index: 0 }],
      [{ kind: 'measured', index: 1 }],
      [{ kind: 'measured', index: 2 }],
      [{ kind: 'measured', index: 3 }],
      [{ kind: 'measured', index: 4 }],
    ]);
    expect(buildRun).toHaveBeenCalledTimes(5);
    expect(events).toEqual(
      Array.from({ length: 6 }, (_, index) => [`measure:${index}`, `close:${index}`]).flat(),
    );
  });

  it('runs all five measured contexts but refuses the whole row after one invalid proof', async () => {
    const measured: number[] = [];
    const closed: number[] = [];
    const createContext = vi.fn(async ({ index }: { readonly index?: number }) => ({
      async measure() {
        if (index === undefined) return { index: -1 };
        measured.push(index);
        return { index };
      },
      async close() {
        if (index !== undefined) closed.push(index);
      },
    }));

    const result = await runStandardShadowAssetColdContexts({
      createContext,
      buildRun: ({ index }: { readonly index: number }) =>
        index === 2
          ? { ok: false as const, note: 'tarball response body evidence is incomplete' }
          : { ok: true as const, run: measuredRun(index) },
    });

    expect(result).toEqual({
      status: 'unmeasured',
      note: 'standard shadow-asset cold run 3/5: tarball response body evidence is incomplete',
    });
    expect(measured).toEqual([0, 1, 2, 3, 4]);
    expect(closed).toEqual([0, 1, 2, 3, 4]);
    expect('runs' in result).toBe(false);
  });

  it('records measurement and context-close failures without retaining partial samples', async () => {
    const createContext = vi.fn(async ({ index }: { readonly index?: number }) => ({
      async measure() {
        if (index === 1) throw new Error('page operation failed');
        return { index: index ?? -1 };
      },
      async close() {
        if (index === 3) throw new Error('context close failed');
      },
    }));

    const result = await runStandardShadowAssetColdContexts({
      createContext,
      buildRun: ({ index }: { readonly index: number }) => ({
        ok: true as const,
        run: measuredRun(index),
      }),
    });

    expect(result).toEqual({
      status: 'unmeasured',
      note: [
        'standard shadow-asset cold run 2/5: page operation failed',
        'standard shadow-asset cold run 4/5: context close failed',
      ].join('; '),
    });
    expect(createContext).toHaveBeenCalledTimes(6);
  });

  it('refuses before measured work when the discarded warm-up cannot settle and close', async () => {
    const createContext = vi.fn(async () => ({
      async measure() {},
      async close() {
        throw new Error('warm-up context close failed');
      },
    }));

    await expect(
      runStandardShadowAssetColdContexts({
        createContext,
        buildRun: () => ({ ok: true as const, run: measuredRun(0) }),
      }),
    ).resolves.toEqual({
      status: 'unmeasured',
      note: 'standard shadow-asset cold warm-up: warm-up context close failed',
    });
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of a browser context across warm-up or measured iterations', async () => {
    const shared = { async measure() {}, async close() {} };
    const createContext = vi.fn(async () => shared);

    await expect(
      runStandardShadowAssetColdContexts({
        createContext,
        buildRun: () => ({ ok: true as const, run: measuredRun(0) }),
      }),
    ).resolves.toEqual({
      status: 'unmeasured',
      note: 'standard shadow-asset cold run 1/5: browser context was reused',
    });
    expect(createContext).toHaveBeenCalledTimes(2);
  });
});
