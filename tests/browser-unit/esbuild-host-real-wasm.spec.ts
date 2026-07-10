import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * REAL esbuild-wasm@0.28.0 service in a real Chromium realm (no fakeLib):
 * initializes over a Memory VFS through the wasm_exec fs facade and pins the
 * native-parity build behaviors probed on real esbuild 0.28.0:
 *  - transform executes real TS lowering;
 *  - a RELATIVE outdir resolves against the guest cwd (absWorkingDir default),
 *    and write-normalized output lands in the VFS with `outputFiles` kept as
 *    an OWN ENUMERABLE `undefined` key (native shape — never deleted);
 *  - a build with NO outfile/outdir writes NOTHING (the service's literal
 *    `<stdout>` entry is dropped, matching native "no files written");
 *  - plugin surface stays native: caller write shape in initialOptions, a
 *    setup() write flip is honored, pluginBuild.esbuild is the masked
 *    module-shaped bridge view (guest-shim *Sync throwers), never the raw lib.
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
      // RENEGOTIATED (PR#125 r4): these fields asserted `'outputFiles' in
      // result === false`; real esbuild 0.28.0 (probed 2026-07-10) KEEPS the
      // key own + enumerable with value undefined on write-effective results.
      buildOutputFiles: 'own-enumerable-undefined',
      noOutfileWroteNothing: true,
      noOutfileOutputFiles: 'own-enumerable-undefined',
      pluginSawWrite: true,
      pluginOnEndFileOnDisk: true,
      pluginOnEndOutputFiles: 'own-enumerable-undefined',
      pluginBuildOutputFiles: 'own-enumerable-undefined',
      // F2: plugin setup() write:true→false flip honored by the bridge
      // (real-esbuild oracle: outputFiles array in memory, disk untouched).
      writeFlipOutputFiles: 'array(1)',
      writeFlipDiskUntouched: true,
      // F3: pluginBuild.esbuild = masked module view (real 0.28.0 key set),
      // guest-shim NotImplementedError for the *Sync family.
      pluginEsbuildKeys:
        'analyzeMetafile,analyzeMetafileSync,build,buildSync,context,default,formatMessages,formatMessagesSync,initialize,stop,transform,transformSync,version',
      pluginEsbuildDefaultIsSelf: true,
      pluginEsbuildBuildSyncError: 'NotImplementedError:esbuild.buildSync',
    });
  });
});
