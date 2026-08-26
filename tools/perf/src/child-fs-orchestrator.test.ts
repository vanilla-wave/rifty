import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildChildFsArtifact, validateChildFsArtifact } from './child-fs-artifact.mjs';

function rawSample(lane: 'in-realm' | 'product-coi', ordinal: number) {
  const marker = `${lane}-${ordinal}`;
  return {
    lane,
    topology: lane === 'product-coi' ? 'owner-sync-rpc-kernel-child' : 'single-in-realm-worker',
    ordinal,
    ownerLoad: 'idle',
    vite: {
      exitCode: 0,
      rawOutput: '✓ 2180 modules transformed.\n✓ built in 1.234567s\n',
      emittedJavaScript: `const marker=${JSON.stringify(marker)};`,
      marker,
    },
    express: {
      exitCode: 0,
      rawOutput: `RIFTY_EXPRESS_READY ${marker} 7.654321\nRIFTY_EXPRESS_CLOSED ${marker}\n`,
      marker,
    },
  };
}

function never(): Promise<never> {
  return new Promise(() => {});
}

describe('child fs bounded two-lane orchestrator', () => {
  it('runs exact lane ordinals, cleans ownership, then publishes exact artifact bytes', async () => {
    const { orchestrateChildFs } = await import('./child-fs-orchestrator.mjs');
    const events: string[] = [];
    let published: { path: string; json: string } | undefined;
    const artifact = await orchestrateChildFs(
      {
        runs: 2,
        out: '/result/child-fs.json',
        port: 5391,
        ownerLoad: 'idle',
        generatedAt: '2026-08-26T00:00:00.000Z',
        gitSha: 'a'.repeat(40),
      },
      {
        startServer: async (port: number) => {
          events.push(`server:start:${port}`);
          return {
            ready: Promise.resolve().then(() => events.push('server:ready')),
            failed: never(),
            closed: Promise.resolve(),
            close: async () => events.push('server:close'),
            forceClose: async () => events.push('server:force'),
          };
        },
        launchBrowser: async (baseUrl: string) => {
          events.push(`browser:launch:${baseUrl}`);
          return {
            version: 'Chromium exact',
            failed: never(),
            closed: Promise.resolve(),
            runSample: async (lane: 'in-realm' | 'product-coi', ordinal: number) => {
              events.push(`sample:${lane}:${ordinal}`);
              return rawSample(lane, ordinal);
            },
            close: async () => events.push('browser:close'),
            forceClose: async () => events.push('browser:force'),
          };
        },
        publish: (path: string, json: string) => {
          events.push('publish');
          published = { path, json };
        },
      },
    );

    expect(events).toEqual([
      'server:start:5391',
      'server:ready',
      'browser:launch:http://localhost:5391',
      'sample:product-coi:1',
      'sample:in-realm:1',
      'sample:product-coi:2',
      'sample:in-realm:2',
      'browser:close',
      'server:close',
      'publish',
    ]);
    expect(published?.path).toBe('/result/child-fs.json');
    const expected = buildChildFsArtifact({
      generatedAt: '2026-08-26T00:00:00.000Z',
      gitSha: 'a'.repeat(40),
      browserVersion: 'Chromium exact',
      runs: 2,
      samples: [
        rawSample('product-coi', 1),
        rawSample('in-realm', 1),
        rawSample('product-coi', 2),
        rawSample('in-realm', 2),
      ],
    });
    expect(artifact).toEqual(expected);
    expect(published?.json).toBe(`${JSON.stringify(artifact, null, 2)}\n`);
    expect(JSON.parse(published?.json ?? '')).toEqual(artifact);
    expect(validateChildFsArtifact(artifact)).toEqual(artifact);
    expect(artifact.samples.map(({ lane, ordinal }) => `${lane}:${ordinal}`)).toEqual([
      'product-coi:1',
      'in-realm:1',
      'product-coi:2',
      'in-realm:2',
    ]);
  });

  it('pins the committed one-run baseline as a strict artifact without summaries', () => {
    const bytes = readFileSync(
      new URL('../../../perf/child-fs-baseline.json', import.meta.url),
      'utf8',
    );
    const value = JSON.parse(bytes);
    const artifact = validateChildFsArtifact(value);
    expect(bytes).toBe(`${JSON.stringify(artifact, null, 2)}\n`);
    expect(artifact.runs).toBe(1);
    expect(artifact.samples.map(({ lane }) => lane)).toEqual(['product-coi', 'in-realm']);
    expect(artifact.samples.map(({ vite }) => vite.transformedModules)).toEqual([2180, 2180]);
    expect(Object.keys(artifact).toSorted()).not.toContain('summary');
    expect(Object.keys(artifact).toSorted()).not.toContain('speedupX');
    const product = artifact.samples.find(({ lane }) => lane === 'product-coi');
    const inRealm = artifact.samples.find(({ lane }) => lane === 'in-realm');
    if (product === undefined || inRealm === undefined) throw new Error('baseline lanes missing');
    const ledger = readFileSync(
      new URL('../../../docs/backlog/epics/child-fs-rpc-hot-path/ledger.md', import.meta.url),
      'utf8',
    );
    expect(ledger).toContain(
      `baseline ${artifact.gitSha}: product vite ${product.vite.selfTimeSeconds}s express ${product.express.startToListeningMs}ms; in-realm vite ${inRealm.vite.selfTimeSeconds}s express ${inRealm.express.startToListeningMs}ms`,
    );
  });
});
