import { expect, test } from '@playwright/test';
import { bootOwner, gotoHarness } from './fixtures.ts';
import type * as Proof from './fixtures/agent-snapshot-proof.ts';

test('fixed snapshot without registry: agent fails build, edits, rebuilds and updates real preview', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const registryRequests: string[] = [];
  await page.route('**/npm-registry/**', (route) => {
    registryRequests.push(route.request().url());
    return route.abort();
  });
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'agent-snapshot-proof',
    template: 'vite',
    persistence: 'ephemeral',
    snapshotOnly: true,
  });
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveSnapshotBuild(),
    `/@fs${process.cwd()}/tests/browser-unit/fixtures/agent-snapshot-proof.ts`,
  );
  expect(result.status).toBe('done');
  expect(result.built).toContain('/assets/');
  expect(result.built).not.toContain('/src/main.js');
  const shells = result.trace.transcript.filter(
    (message) => message.role === 'toolResult' && message.toolName === 'shell',
  );
  expect(shells).toHaveLength(2);
  expect(shells[0]).toHaveProperty('isError', true);
  expect(shells[1]).toHaveProperty('isError', false);
  await expect(page.frameLocator('#agent-preview').locator('#app')).toHaveText(
    'AGENT_SNAPSHOT_FIXED',
    { timeout: 60_000 },
  );
  expect(registryRequests).toEqual([]);
  expect(JSON.stringify(result.trace.finalDiff)).toContain('AGENT_SNAPSHOT_FIXED');
});
