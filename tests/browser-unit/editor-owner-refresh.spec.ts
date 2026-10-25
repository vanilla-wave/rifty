import { expect, test } from '@playwright/test';
import { bootOwner, gotoHarness } from './fixtures.ts';
import type * as Proof from './fixtures/editor-owner-proof.tsx';

test.beforeEach(async ({ page }, info) => {
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: `editor-owner-${info.testId}`,
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
});

test('public owner write refreshes clean Monaco and its exact CAS capture without writing back', async ({
  page,
}) => {
  const value = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).cleanOwnerUpdate(),
    `/@fs${process.cwd()}/tests/browser-unit/fixtures/editor-owner-proof.tsx`,
  );
  expect(value).toMatchObject({
    sameModel: true,
    echoWrites: 0,
    versionStable: true,
    saved: 'export const value = "local-after-refresh";',
    closed: 'export const closed = "remote-closed";',
    errors: [],
  });
});

test('owner refresh preserves unpublished Monaco bytes and their old CAS base', async ({
  page,
}) => {
  const value = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).pendingLocalUpdate(),
    `/@fs${process.cwd()}/tests/browser-unit/fixtures/editor-owner-proof.tsx`,
  );
  expect(value.failure).toMatch(/conflict|version/i);
  expect(value.owner).toBe('export const value = "external-winner";');
  expect(value.model).toBe('export const value = "unpublished-local";');
  expect(value).toMatchObject({ dirty: true, oldBase: true });
});
