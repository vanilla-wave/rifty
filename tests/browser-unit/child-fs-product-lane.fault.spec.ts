import { expect, test } from '@playwright/test';
import { gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const laneFixtureUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/child-fs-product-lane.ts`;

test('non-COI rejects before open; post-open command failure closes real sealed ownership', async ({
  page,
}) => {
  await gotoHarness(page);
  const result = await page.evaluate(
    async ({ laneUrl, sealedUrl }) => {
      const [lane, sealed] = await Promise.all([
        import(/* @vite-ignore */ laneUrl),
        import(/* @vite-ignore */ sealedUrl),
      ]);
      let falseCoiOpenCalls = 0;
      let falseCoiRejected = false;
      try {
        await lane.runChildFsProductLane(1, {
          coi: false,
          open: async () => {
            falseCoiOpenCalls += 1;
          },
        });
      } catch {
        falseCoiRejected = true;
      }

      let closeCalls = 0;
      let commandRejected = false;
      try {
        await lane.runChildFsProductLane(1, {
          coi: true,
          open: (plan: unknown) =>
            sealed.openSealedWorkbenchFixture({
              workspaceId: 'child-fs-product-lane-fault',
              persistence: 'ephemeral',
              plan,
            }),
          execute: async () => {
            throw new Error('injected install failure');
          },
          close: async () => {
            closeCalls += 1;
            await sealed.closeSealedWorkbenchFixture();
          },
        });
      } catch (error) {
        commandRejected = String(error).includes('injected install failure');
      }
      let ownershipClosed = false;
      try {
        sealed.currentProject();
      } catch {
        ownershipClosed = true;
      }
      return {
        falseCoiOpenCalls,
        falseCoiRejected,
        closeCalls,
        commandRejected,
        ownershipClosed,
      };
    },
    { laneUrl: laneFixtureUrl, sealedUrl: sealedWorkbenchFixtureUrl },
  );

  expect(result).toEqual({
    falseCoiOpenCalls: 0,
    falseCoiRejected: true,
    closeCalls: 1,
    commandRejected: true,
    ownershipClosed: true,
  });
});
