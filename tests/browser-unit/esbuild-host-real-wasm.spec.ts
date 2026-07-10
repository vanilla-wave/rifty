import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * REAL esbuild-wasm@0.28.0 service in a real Chromium realm (no fakeLib):
 * initializes over a Memory VFS through the wasm_exec fs facade and pins the
 * native-parity build behaviors probed on real esbuild 0.28.0:
 *  - transform executes real TS lowering;
 *  - a RELATIVE outdir resolves against the guest cwd (absWorkingDir default),
 *    and write-normalized output lands in the VFS with outputFiles stripped;
 *  - a build with NO outfile/outdir writes NOTHING (the service's literal
 *    `<stdout>` entry is dropped, matching native "no files, no outputFiles").
 */
test.describe('esbuild host over the real wasm service', () => {
  test('transform + write-normalized build + no-outfile shape', async ({ page }) => {
    await page.goto('/unit-harness.html');
    await page.waitForSelector('#browser-unit-harness[data-status="ready"]');
    const helperUrl = `/@fs${resolve('tests/browser-unit/helpers/esbuild-host-page.ts')}`;
    const report = await page.evaluate(async (url) => {
      const mod = (await import(/* @vite-ignore */ url)) as {
        runRealEsbuildChecks(): Promise<unknown>;
      };
      return mod.runRealEsbuildChecks();
    }, helperUrl);

    expect(report).toEqual({
      version: '0.28.0',
      transformed: 'let x = 1;',
      relativeOutdirWrote: true,
      buildHasOutputFiles: false,
      noOutfileWroteNothing: true,
      noOutfileHasOutputFiles: false,
      // Plugin boundary stays native: caller's write shape, files on the VFS
      // before user onEnd, no outputFiles anywhere plugin-visible.
      pluginSawWrite: true,
      pluginOnEndFileOnDisk: true,
      pluginOnEndHasOutputFiles: false,
      pluginBuildHasOutputFiles: false,
    });
  });
});
