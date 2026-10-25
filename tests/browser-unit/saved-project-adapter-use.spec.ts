import { expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  execLine,
  gotoHarness,
  removeOwnerPath,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';
import {
  SAVED_ESBUILD_PROBE,
  captureSavedEsbuildOracle,
  savedEsbuildTranscript,
} from './fixtures/esbuild-saved-node-oracle.ts';

for (const fault of ['payload', 'shadow-provenance', 'missing-lock'] as const) {
  test(`saved Vite ${fault} keeps Node access and matches stock esbuild use`, async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    const oracle = captureSavedEsbuildOracle(fault);
    expect(oracle.exit, oracle.stderr).toBe(fault === 'payload' ? 1 : 0);
    const generated: string[] = [];
    context.on('request', (request) => {
      if (request.url().includes('/generated/esbuild-runtime.js')) generated.push(request.url());
    });
    await gotoHarness(page);
    const options = {
      workspaceId: 'pr323-adapter',
      template: 'vite' as const,
      setup: 'instant' as const,
      persistence: 'required' as const,
      namespace: `pr323-adapter-${Date.now()}`,
    };
    await bootOwner(page, options);
    await writeOwnerFile(page, '/scratch/local.cjs', "console.log('independent Node');");
    if (fault === 'payload')
      await writeOwnerFile(page, '/scratch/node_modules/esbuild-wasm/esbuild.wasm', 'corrupt');
    if (fault === 'missing-lock') await removeOwnerPath(page, '/scratch/package-lock.json');
    if (fault === 'shadow-provenance')
      await page.evaluate(async (fixtureUrl) => {
        const fixture = await import(/* @vite-ignore */ fixtureUrl);
        const files = fixture.currentProject().files;
        const lock = await files.readFile('/package-lock.json');
        const value = JSON.parse(new TextDecoder().decode(lock.bytes));
        value.rifty.shadowSubstitutions.protocol = 'invalid-provenance';
        await files.writeFile(
          '/package-lock.json',
          new TextEncoder().encode(JSON.stringify(value)),
          { expectedVersion: lock.version },
        );
      }, sealedWorkbenchFixtureUrl);
    await writeOwnerFile(page, '/scratch/probe.cjs', SAVED_ESBUILD_PROBE);
    await closeOwner(page);
    await bootOwner(page, options);
    try {
      const local = await execLine(page, 'node local.cjs');
      console.log('[pr323-adapter]', JSON.stringify(local));
      expect(local.exit).toBe(0);
      expect(local.out).toContain('independent Node');
      const adapter = await execLine(page, 'node probe.cjs');
      expect(adapter.exit, adapter.out).toBe(oracle.exit);
      expect(savedEsbuildTranscript(adapter.out)).toEqual(oracle.transcript);
      expect(generated).toEqual([]);
    } finally {
      await closeOwner(page);
    }
  });
}
