import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, readOwnerFile } from './fixtures.ts';

test('COI instant Vite snapshot runs upstream esbuild without loading the generated runtime', async ({
  page,
  context,
}) => {
  test.fail(true, 'COI snapshot still restores the legacy generated-runtime recipe');
  const generatedRequests: string[] = [];
  context.on('request', (request) => {
    if (request.url().includes('/generated/esbuild-runtime.js'))
      generatedRequests.push(request.url());
  });
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-upstream-host-snapshot',
    template: 'vite',
    setup: 'instant',
    persistence: 'ephemeral',
  });
  try {
    const build = await execLine(page, 'npx vite build');
    expect(build.exit, build.out).toBe(0);
    const lock = await readOwnerFile(page, '/scratch/package-lock.json');
    expect(lock.ok, lock.error).toBe(true);
    // Fixture version stays pinned by ADR-0375; execution policy must still be COI.
    const entries = JSON.parse(lock.text).packages;
    expect(entries['node_modules/esbuild-wasm'].version).toBe('0.28.0');
    expect(entries['node_modules/esbuild'].riftyShadowRecipe).toBe(
      'rifty.shadow-substitution.esbuild.wasm-node.v1',
    );
    expect(generatedRequests).toEqual([]);
  } finally {
    await closeOwner(page);
  }
});
