import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';

test('saved Vite with a damaged esbuild payload still runs independent Node and fails at esbuild use', async ({
  page,
}) => {
  test.setTimeout(240_000);
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
  await writeOwnerFile(page, '/scratch/node_modules/esbuild-wasm/esbuild.wasm', 'corrupt');
  await closeOwner(page);
  await bootOwner(page, options);
  try {
    const local = await execLine(page, 'node local.cjs');
    console.log('[pr323-adapter]', JSON.stringify(local));
    expect(local.exit).toBe(0);
    expect(local.out).toContain('independent Node');
    const adapter = await execLine(page, 'node -e "require(\'esbuild\')"');
    expect(adapter.exit).not.toBe(0);
    expect(adapter.out).toMatch(/wasm size|not initialized|not available/);
  } finally {
    await closeOwner(page);
  }
});
