import { describe, expect, it, vi } from 'vitest';

const OPTIONS = Object.freeze({
  runs: 1,
  out: '/result/child-fs.json',
  port: 5391,
  ownerLoad: 'idle' as const,
  generatedAt: '2026-08-26T00:00:00.000Z',
  gitSha: 'b'.repeat(40),
});

function rawSample(lane: 'in-realm' | 'product-coi', ordinal = 1) {
  const marker = `${lane}-${ordinal}`;
  return {
    lane,
    topology: lane === 'product-coi' ? 'owner-sync-rpc-kernel-child' : 'single-in-realm-worker',
    ordinal,
    ownerLoad: 'idle',
    vite: {
      exitCode: 0,
      rawOutput: '✓ 2180 modules transformed.\n✓ built in 1s\n',
      emittedJavaScript: marker,
      marker,
    },
    express: {
      exitCode: 0,
      rawOutput: `RIFTY_EXPRESS_READY ${marker} 1\nRIFTY_EXPRESS_CLOSED ${marker}\n`,
      marker,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('child fs orchestrator lifecycle faults', () => {
  it('rejects every lifecycle/sample fault, cleans opened owners once, and never publishes', async () => {
    const { orchestrateChildFs } = await import('./child-fs-orchestrator.mjs');
    for (const fault of [
      'server-start',
      'server-ready',
      'server-ready-timeout',
      'server-exit',
      'browser-launch',
      'page-failure',
      'sample-reject',
      'sample-timeout',
      'corrupt-sample',
      'extra-sample',
      'digest-sample',
      'summary-sample',
      'browser-close',
      'browser-close-timeout',
      'page-failure-cleanup',
      'server-exit-cleanup',
      'server-close',
      'server-close-timeout',
    ] as const) {
      const serverClose = vi.fn(async (): Promise<unknown> => {
        if (fault === 'server-close-timeout') return await new Promise<never>(() => {});
        if (fault === 'server-close') throw new Error('injected server close failure');
      });
      const browserClose = vi.fn(async (): Promise<unknown> => {
        if (fault === 'browser-close-timeout') return await new Promise<never>(() => {});
        if (fault === 'page-failure-cleanup') {
          pageFailed.reject(new Error('injected page crash during cleanup'));
          await Promise.resolve();
        }
        if (fault === 'server-exit-cleanup') {
          serverFailed.reject(new Error('injected server exit during cleanup'));
          await Promise.resolve();
        }
        if (fault === 'browser-close') throw new Error('injected browser close failure');
      });
      const publish = vi.fn();
      const serverFailed = deferred<never>();
      const pageFailed = deferred<never>();
      const runSample = vi.fn(async (lane: 'in-realm' | 'product-coi') => {
        if (fault === 'server-exit') {
          queueMicrotask(() => serverFailed.reject(new Error('injected dev server exit')));
          return await new Promise<never>(() => {});
        }
        if (fault === 'page-failure') {
          queueMicrotask(() => pageFailed.reject(new Error('injected page crash')));
          return await new Promise<never>(() => {});
        }
        if (fault === 'sample-reject') throw new Error('injected lane rejection');
        if (fault === 'sample-timeout') return await new Promise<never>(() => {});
        if (fault === 'corrupt-sample') return { ...rawSample(lane), ordinal: 99 };
        if (fault === 'extra-sample') return { ...rawSample(lane), unexpected: true };
        if (fault === 'digest-sample') return { ...rawSample(lane), scenarioDigest: 'forged' };
        if (fault === 'summary-sample') return { ...rawSample(lane), summary: {} };
        return rawSample(lane);
      });
      await expect(
        orchestrateChildFs(
          OPTIONS,
          {
            startServer: async () => {
              if (fault === 'server-start') throw new Error('injected server start failure');
              return {
                ready:
                  fault === 'server-ready'
                    ? Promise.reject(new Error('injected readiness failure'))
                    : fault === 'server-ready-timeout'
                      ? new Promise<never>(() => {})
                      : Promise.resolve(),
                failed: serverFailed.promise,
                close: serverClose,
              };
            },
            launchBrowser: async () => {
              if (fault === 'browser-launch') throw new Error('injected browser launch failure');
              return {
                version: 'Chromium fault',
                failed: pageFailed.promise,
                runSample,
                close: browserClose,
              };
            },
            publish,
          },
          { cleanupMs: 20, serverReadyMs: 20, sampleMs: 20 },
        ),
        fault,
      ).rejects.toThrow();
      expect(publish, fault).not.toHaveBeenCalled();
      expect(serverClose, fault).toHaveBeenCalledTimes(fault === 'server-start' ? 0 : 1);
      expect(browserClose, fault).toHaveBeenCalledTimes(
        fault === 'server-start' ||
          fault === 'server-ready' ||
          fault === 'server-ready-timeout' ||
          fault === 'browser-launch'
          ? 0
          : 1,
      );
    }
  });

  it('publishes only after cleanup and keeps publication failure loud', async () => {
    const { orchestrateChildFs } = await import('./child-fs-orchestrator.mjs');
    const events: string[] = [];
    await expect(
      orchestrateChildFs(OPTIONS, {
        startServer: async () => ({
          ready: Promise.resolve(),
          failed: new Promise<never>(() => {}),
          close: async () => events.push('server:close'),
        }),
        launchBrowser: async () => ({
          version: 'Chromium fault',
          failed: new Promise<never>(() => {}),
          runSample: async (lane: 'in-realm' | 'product-coi') => rawSample(lane),
          close: async () => events.push('browser:close'),
        }),
        publish: () => {
          events.push('publish');
          throw new Error('injected publication failure');
        },
      }),
    ).rejects.toThrow(/publication failure/u);
    expect(events).toEqual(['browser:close', 'server:close', 'publish']);
  });
});
