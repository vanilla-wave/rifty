import { expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  flushOwnerDurable,
  gotoHarness,
  readOwnerFile,
  removeOwnerPath,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';

test('public file mutation acknowledges bytes and publishes a fresh snapshot', async ({ page }) => {
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-publish',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });

  const result = await page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    const project = fixture.currentProject();
    const observed: string[][] = [];
    const unsubscribe = project.files.subscribe(
      (snapshot: { readonly entries: readonly { readonly path: string }[] }) => {
        observed.push(snapshot.entries.map((entry) => entry.path));
      },
    );
    try {
      await fixture.writeProjectText('/scratch/push-probe.txt', 'push-probe');
      const read = await project.files.readFile('/push-probe.txt');
      return {
        observed,
        readBack: new TextDecoder().decode(read.bytes),
      };
    } finally {
      unsubscribe();
    }
  }, sealedWorkbenchFixtureUrl);

  expect(result.observed.some((paths) => paths.includes('/push-probe.txt'))).toBe(true);
  expect(result.readBack).toBe('push-probe');
});

test('required OPFS project survives a sealed Workbench reopen', async ({ page }) => {
  await gotoHarness(page);
  const boot = {
    workspaceId: 'bu-persist',
    template: 'hidden-empty' as const,
    persistence: 'required' as const,
  };
  await bootOwner(page, boot);

  const readme = await readOwnerFile(page, '/scratch/README.md');
  expect(readme.ok).toBe(false);
  expect(
    await page.evaluate(async (fixtureUrl) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      return fixture.currentWorkbench().snapshot().storage;
    }, sealedWorkbenchFixtureUrl),
  ).toEqual({ policy: 'required', backend: 'opfs', durability: 'durable' });

  const marker = `persist-probe ${Date.now().toString(36)}`;
  await writeOwnerFile(page, '/scratch/persist-probe.txt', marker);
  await flushOwnerDurable(page);
  await closeOwner(page);

  await bootOwner(page, boot);
  const readBack = await readOwnerFile(page, '/scratch/persist-probe.txt');
  expect(readBack).toEqual({ ok: true, text: marker, error: '' });
});

test('durable project seeding preserves a user-deleted Vite config across reopen', async ({
  page,
}) => {
  await gotoHarness(page);
  const boot = {
    workspaceId: 'bu-vite-config-claim',
    template: 'vite' as const,
    starter: 'real-vite',
    setup: 'from-scratch' as const,
    persistence: 'required' as const,
  };
  await bootOwner(page, boot);

  const configPath = '/scratch/vite.config.js';
  expect((await readOwnerFile(page, configPath)).ok).toBe(true);
  await removeOwnerPath(page, configPath);
  await flushOwnerDurable(page);
  await closeOwner(page);

  await bootOwner(page, boot);
  expect((await readOwnerFile(page, configPath)).ok).toBe(false);
});
