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
      'sample-timeout-product-coi-1',
      'sample-timeout-in-realm-1',
      'sample-timeout-product-coi-2',
      'sample-timeout-in-realm-2',
      'corrupt-sample',
      'extra-sample',
      'digest-sample',
      'summary-sample',
      'browser-close',
      'browser-close-timeout',
      'browser-force-failure',
      'page-failure-cleanup',
      'server-exit-cleanup',
      'server-close',
      'server-close-timeout',
      'server-force-failure',
    ] as const) {
      const serverTerminal = deferred<void>();
      const browserTerminal = deferred<void>();
      let serverTerminalClosed = false;
      let browserTerminalClosed = false;
      let serverCloseSettled = false;
      let browserCloseSettled = false;
      const serverClose = vi.fn(async (): Promise<unknown> => {
        if (fault === 'server-close-timeout') return await new Promise<never>(() => {});
        if (fault === 'server-close' || fault === 'server-force-failure') {
          throw new Error('injected server close failure');
        }
        if (fault === 'server-exit' || fault === 'server-exit-cleanup') {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        serverCloseSettled = true;
        serverTerminalClosed = true;
        serverTerminal.resolve();
      });
      const serverForceClose = vi.fn(async () => {
        if (fault === 'server-force-failure') throw new Error('injected server force failure');
        serverTerminalClosed = true;
        serverTerminal.resolve();
      });
      const browserClose = vi.fn(async (): Promise<unknown> => {
        if (fault === 'browser-close-timeout') return await new Promise<never>(() => {});
        if (fault === 'page-failure-cleanup') {
          pageFailed.reject(new Error('injected page crash during cleanup'));
          await Promise.resolve();
        }
        if (fault === 'server-exit-cleanup') {
          serverFailed.reject(new Error('injected server exit during cleanup'));
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        if (fault === 'page-failure' || fault === 'page-failure-cleanup') {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        if (fault === 'browser-close' || fault === 'browser-force-failure') {
          throw new Error('injected browser close failure');
        }
        browserCloseSettled = true;
        browserTerminalClosed = true;
        browserTerminal.resolve();
      });
      const browserForceClose = vi.fn(async () => {
        if (fault === 'browser-force-failure') throw new Error('injected browser force failure');
        browserTerminalClosed = true;
        browserTerminal.resolve();
      });
      const publish = vi.fn();
      const serverFailed = deferred<never>();
      const pageFailed = deferred<never>();
      const runSample = vi.fn(async (lane: 'in-realm' | 'product-coi', ordinal: number) => {
        if (fault === 'server-exit') {
          queueMicrotask(() => serverFailed.reject(new Error('injected dev server exit')));
          return await new Promise<never>(() => {});
        }
        if (fault === 'page-failure') {
          queueMicrotask(() => pageFailed.reject(new Error('injected page crash')));
          return await new Promise<never>(() => {});
        }
        if (fault === 'sample-reject') throw new Error('injected lane rejection');
        if (fault === `sample-timeout-${lane}-${ordinal}`) {
          return await new Promise<never>(() => {});
        }
        if (fault === 'corrupt-sample') return { ...rawSample(lane), ordinal: 99 };
        if (fault === 'extra-sample') return { ...rawSample(lane), unexpected: true };
        if (fault === 'digest-sample') return { ...rawSample(lane), scenarioDigest: 'forged' };
        if (fault === 'summary-sample') return { ...rawSample(lane), summary: {} };
        return rawSample(lane);
      });
      let rejected = false;
      try {
        await orchestrateChildFs(
          {
            ...OPTIONS,
            runs: fault.endsWith('-2') ? 2 : 1,
          },
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
                closed: serverTerminal.promise,
                close: serverClose,
                forceClose: serverForceClose,
              };
            },
            launchBrowser: async () => {
              if (fault === 'browser-launch') throw new Error('injected browser launch failure');
              return {
                version: 'Chromium fault',
                failed: pageFailed.promise,
                closed: browserTerminal.promise,
                runSample,
                close: browserClose,
                forceClose: browserForceClose,
              };
            },
            publish,
          },
          { cleanupMs: 20, serverReadyMs: 20, sampleMs: 20 },
        );
      } catch {
        rejected = true;
      }
      expect(rejected, fault).toBe(true);
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
      expect(browserForceClose, fault).toHaveBeenCalledTimes(
        fault === 'browser-close' ||
          fault === 'browser-close-timeout' ||
          fault === 'browser-force-failure'
          ? 1
          : 0,
      );
      expect(serverForceClose, fault).toHaveBeenCalledTimes(
        fault === 'server-close' ||
          fault === 'server-close-timeout' ||
          fault === 'server-force-failure'
          ? 1
          : 0,
      );
      if (fault === 'page-failure' || fault === 'page-failure-cleanup') {
        expect(browserCloseSettled, fault).toBe(true);
      }
      if (fault === 'server-exit' || fault === 'server-exit-cleanup') {
        expect(serverCloseSettled, fault).toBe(true);
      }
      if (fault !== 'browser-force-failure' && browserClose.mock.calls.length > 0) {
        expect(browserTerminalClosed, fault).toBe(true);
      }
      if (fault !== 'server-force-failure' && serverClose.mock.calls.length > 0) {
        expect(serverTerminalClosed, fault).toBe(true);
      }
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
          closed: Promise.resolve(),
          close: async () => events.push('server:close'),
          forceClose: async () => events.push('server:force'),
        }),
        launchBrowser: async () => ({
          version: 'Chromium fault',
          failed: new Promise<never>(() => {}),
          closed: Promise.resolve(),
          runSample: async (lane: 'in-realm' | 'product-coi') => rawSample(lane),
          close: async () => events.push('browser:close'),
          forceClose: async () => events.push('browser:force'),
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
