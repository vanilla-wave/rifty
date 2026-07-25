import { expect, test } from '@playwright/test';
import { gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

test('sealed Workbench exposes owner-backed file ACK/error and initial preview state', async ({
  page,
}) => {
  await gotoHarness(page);

  const result = await page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    let opened = false;
    try {
      await fixture.openSealedWorkbenchFixture({
        workspaceId: 'browser-unit-bridges',
        template: 'hidden-empty',
        persistence: 'ephemeral',
      });
      opened = true;
      const project = fixture.currentProject();
      const content = `bridge-roundtrip ${'x'.repeat(64)}`;
      const created = await project.files.writeFile(
        '/bridge-roundtrip.txt',
        new TextEncoder().encode(content),
        { expectedVersion: null },
      );
      const read = await project.files.readFile('/bridge-roundtrip.txt');

      let ackError: { name: string; message: string } | null = null;
      try {
        await project.files.writeFile(
          '/bridge-roundtrip.txt',
          new TextEncoder().encode('must conflict'),
          { expectedVersion: null },
        );
      } catch (error) {
        ackError =
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { name: 'unknown', message: String(error) };
      }

      const previews = fixture.currentSessionTools().previews;
      let initialPreviewState: readonly unknown[] | null = null;
      const unsubscribe = previews.subscribe((snapshot: readonly unknown[]) => {
        initialPreviewState = snapshot;
      });
      unsubscribe();

      return {
        content,
        readBack: new TextDecoder().decode(read.bytes),
        createdPath: created.path,
        ackError,
        initialPreviewState,
      };
    } finally {
      if (opened) await fixture.closeSealedWorkbenchFixture();
    }
  }, sealedWorkbenchFixtureUrl);

  expect(result.readBack).toBe(result.content);
  expect(result.createdPath).toBe('/bridge-roundtrip.txt');
  expect(result.ackError).not.toBeNull();
  expect(result.ackError?.name).toBe('FileConflictError');
  expect(result.ackError?.message).toContain('/bridge-roundtrip.txt');
  expect(result.initialPreviewState).toEqual([]);
});
