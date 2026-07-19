import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  PACKED_VITE_JOURNEYS,
  PACKED_WORKBENCH_EXPORTS,
} from './workbench-packed-consumer-browser-contract.mjs';

const fixtureUrl = new URL('./fixtures/workbench-vite-consumer/src/main.ts', import.meta.url);
const runnerUrl = new URL('./workbench-packed-consumer.mjs', import.meta.url);

describe('packed Workbench browser acceptance contract', () => {
  it('uses all seven published exports from the clean external consumer', async () => {
    const fixture = await readFile(fixtureUrl, 'utf8');

    expect(PACKED_WORKBENCH_EXPORTS).toHaveLength(7);
    for (const specifier of PACKED_WORKBENCH_EXPORTS) {
      expect(fixture, `missing packed import ${specifier}`).toContain(specifier);
    }
  });

  it('runs exact Vite 7 and default Vite 8 Chromium dev/build/preview journeys', async () => {
    const [fixture, runner] = await Promise.all([
      readFile(fixtureUrl, 'utf8'),
      readFile(runnerUrl, 'utf8'),
    ]);

    expect(PACKED_VITE_JOURNEYS).toEqual([
      { version: '7.3.6', runtimeAssetCount: 1, hmr: true },
      { version: '8.0.16', runtimeAssetCount: 0, hmr: false },
    ]);
    expect(runner).toContain('PACKED_VITE_JOURNEYS');
    expect(runner).toContain('vite8-node-modules.json.gz');
    expect(fixture).toContain('runVite7BuildPreview');
    expect(fixture).toContain('runDefaultVite8');
    expect(fixture).toContain('waitForRenderedMarker');
    expect(fixture).toContain('openDefaultVite8');
    expect(fixture).toContain('vite8RuntimeAssetProgress');
  });

  it('holds the same tarball-installed production host for the cold benchmark route', async () => {
    const runner = await readFile(runnerUrl, 'utf8');

    expect(runner).toContain('--serve-shadow-asset-cold');
    expect(runner).toContain('shadow-asset-cold.html');
    expect(runner).toContain('RIFTY_SHADOW_ASSET_COLD_HOST=');
  });
});
