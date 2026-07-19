import { expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  execLine,
  gotoHarness,
  readOwnerFile,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';

test('real Vite 7 runtime assets survive OPFS reopen, clear only while idle, and refill independently of project data', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await gotoHarness(page);
  const boot = {
    workspaceId: 'browser-unit-runtime-asset-storage',
    template: 'vite' as const,
    starter: 'runtime-asset-storage',
    setup: 'from-scratch' as const,
    persistence: 'required' as const,
  };
  const inspect = () =>
    page.evaluate(async (fixtureUrl) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      return fixture.currentWorkbench().runtimeAssets.inspect();
    }, sealedWorkbenchFixtureUrl);
  const open = async (): Promise<void> => {
    await bootOwner(page, boot);
  };

  await open();
  const cold = await execLine(page, 'npm install');
  expect(cold.exit, cold.out).toBe(0);
  const seeded = await inspect();
  expect(seeded.storageClass).toMatch(/^opfs-/u);
  expect(seeded.verifiedObjectCount).toBe(1);
  expect(seeded.readySetCount).toBe(1);
  expect(seeded.entryCount).toBeGreaterThan(0);

  const privateReadRejected = await page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    try {
      await fixture.currentProject().files.readFile('/.rifty/workbench/v1/runtime-assets/v1');
      return false;
    } catch {
      return true;
    }
  }, sealedWorkbenchFixtureUrl);
  expect(privateReadRejected).toBe(true);

  const marker = `retained-project-${Date.now().toString(36)}`;
  await writeOwnerFile(page, '/scratch/retained.txt', marker);
  await closeOwner(page);

  await open();
  expect(await inspect()).toEqual(seeded);
  expect(await readOwnerFile(page, '/scratch/retained.txt')).toEqual({
    ok: true,
    text: marker,
    error: '',
  });

  const cleared = await page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    const workbench = fixture.currentWorkbench();
    const beforeRejectedClear = await workbench.runtimeAssets.inspect();
    const activeClear = await workbench.runtimeAssets.clear().then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({
        status: 'rejected' as const,
        name: error instanceof Error ? error.name : '',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    const afterRejectedClear = await workbench.runtimeAssets.inspect();
    await fixture.currentProject().close();
    const inspection = await workbench.runtimeAssets.clear();
    return {
      activeClear,
      afterRejectedClear,
      beforeRejectedClear,
      inspection,
      catalog: workbench.playground.catalog.snapshot(),
    };
  }, sealedWorkbenchFixtureUrl);
  expect(cleared.activeClear).toEqual({
    status: 'rejected',
    name: 'ProjectBusyError',
    message: 'ProjectBusyError: Workbench project operations already has an active run',
  });
  expect(cleared.beforeRejectedClear).toEqual(seeded);
  expect(cleared.afterRejectedClear).toEqual(seeded);
  expect(cleared.inspection).toMatchObject({
    storageClass: seeded.storageClass,
    entryCount: 0,
    storedBytes: 0,
    verifiedObjectCount: 0,
    verifiedObjectBytes: 0,
    readySetCount: 0,
  });
  expect(cleared.catalog.active).toEqual({ kind: 'scratch' });
  await closeOwner(page);

  await open();
  expect(await inspect()).toEqual(seeded);
  expect(await readOwnerFile(page, '/scratch/retained.txt')).toEqual({
    ok: true,
    text: marker,
    error: '',
  });
  await closeOwner(page);
});
