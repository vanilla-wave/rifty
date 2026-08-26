import { expect, test } from '@playwright/test';
import { childFsScenarioIdentity } from '../../tools/perf/child-fs/scenario.mjs';
import { bootOwner, closeOwner, gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const laneFixtureUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/child-fs-product-lane.ts`;

test('canonical Vite 2180 + Express cold-listen run through the physical product child lane', async ({
  page,
}) => {
  test.setTimeout(600_000);
  await gotoHarness(page);
  const result = await page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    return fixture.runChildFsProductLane(1);
  }, laneFixtureUrl);

  expect(result.coi).toBe(true);
  expect(result.identity).toEqual(childFsScenarioIdentity());
  expect(result.sample).toMatchObject({
    lane: 'product-coi',
    topology: 'owner-sync-rpc-kernel-child',
    ordinal: 1,
    ownerLoad: 'idle',
  });
  expect(result.lifecycle.vite).toEqual({
    exitCode: 0,
    exit: { code: 0, signal: null },
    closeExit: { code: 0, signal: null },
    closeShared: true,
    settlements: 1,
  });
  expect(result.lifecycle.express).toEqual(result.lifecycle.vite);
  expect(result.sample.vite.rawOutput.match(/2180 modules transformed\./gu)).toHaveLength(1);
  expect(result.sample.vite.rawOutput.match(/built in [0-9.]+(?:ms|s)/gu)).toHaveLength(1);
  expect(result.sample.vite.emittedJavaScript.split(result.sample.vite.marker)).toHaveLength(2);
  expect(result.sample.express.rawOutput.match(/RIFTY_EXPRESS_READY/gu)).toHaveLength(1);
  expect(result.sample.express.rawOutput.match(/RIFTY_EXPRESS_CLOSED/gu)).toHaveLength(1);
});

test('aborted registry acquisition rejects without leaving Workbench ownership stuck', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await gotoHarness(page);
  let registryRequests = 0;
  await page.route('**/npm-registry/**', (route) => {
    registryRequests += 1;
    return route.abort('failed');
  });
  await expect(
    page.evaluate(async (fixtureUrl) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      return fixture.runChildFsProductLane(1);
    }, laneFixtureUrl),
  ).rejects.toThrow();
  expect(registryRequests).toBeGreaterThan(0);
  await page.unrouteAll({ behavior: 'wait' });

  await bootOwner(page, {
    workspaceId: 'child-fs-product-lane-reopen',
    persistence: 'ephemeral',
  });
  await closeOwner(page);
});
