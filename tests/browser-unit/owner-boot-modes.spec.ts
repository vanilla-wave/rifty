import { expect, test } from '@playwright/test';
import { bootOwner, gotoHarness, readOwnerFile, sealedWorkbenchFixtureUrl } from './fixtures.ts';

test('starter plan seeds files and exposes catalog/archive immediately after public open', async ({
  page,
}) => {
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-starter-boot',
    template: 'typescript',
    starter: 'typescript-ls',
    setup: 'from-scratch',
    persistence: 'ephemeral',
  });

  const bridges = await page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    const workbench = fixture.currentWorkbench();
    const archive = await fixture.currentSessionTools().archive.export();
    return { catalog: workbench.playground.catalog.snapshot(), archive };
  }, sealedWorkbenchFixtureUrl);

  expect(bridges.catalog.active).toEqual({ kind: 'scratch' });
  expect(bridges.catalog.scratch).toEqual(
    expect.objectContaining({ starterId: 'typescript-ls', dirty: false }),
  );
  expect(bridges.archive).toContain('src/main.ts');

  const entry = await readOwnerFile(page, '/scratch/src/main.ts');
  expect(entry.ok).toBe(true);
  expect(entry.text.length).toBeGreaterThan(0);

  const pkg = await readOwnerFile(page, '/scratch/package.json');
  expect(pkg.ok).toBe(true);
  expect(pkg.text).toContain('"dev"');

  const dts = await readOwnerFile(page, '/scratch/node_modules/@rifty/example-types/index.d.ts');
  expect(dts.ok).toBe(true);
  expect(dts.text.length).toBeGreaterThan(0);
});
