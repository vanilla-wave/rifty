import { expect, test } from '@playwright/test';
import type * as Fixture from './fixtures/sealed-playground-workbench.ts';
import type * as PageStore from '../../apps/playground/src/glue/page-store.ts';
import { bootOwner, closeOwner, gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

test('real companion Scratch Reset replaces the page dirty flag and discard guard', async ({
  page,
}) => {
  await gotoHarness(page);
  const options = { workspaceId: 'pr323-reset', hiddenEmptyBoot: true };
  await bootOwner(page, options);
  try {
    const result = await page.evaluate(
      async ({ fixtureUrl, options }) => {
        const fixture = (await import(/* @vite-ignore */ fixtureUrl)) as typeof Fixture;
        const storeUrl = '/src/glue/page-store.ts';
        const { createPageStore } = (await import(/* @vite-ignore */ storeUrl)) as typeof PageStore;
        const store = createPageStore();
        const workbench = fixture.currentWorkbench();
        const unsubscribe = workbench.playground.catalog.subscribe((catalog) => {
          store.hydrateIndex({
            activeId: 'scratch',
            projects: [],
            scratch:
              catalog.scratch === null
                ? null
                : {
                    starter: catalog.scratch.starterId,
                    dirty: catalog.scratch.dirty,
                    editedAt: catalog.scratch.editedAt,
                  },
          });
        });
        try {
          await fixture.writeProjectText('/scratch/note.txt', 'edited');
          const before = store.dirty();
          await fixture.currentProject().close();
          const definition = workbench.playground.define(await fixture.projectPlan(options));
          await workbench.playground.catalog.reset({ target: { kind: 'scratch' }, definition });
          const after = store.dirty();
          const ownerDirty = workbench.playground.catalog.snapshot().scratch?.dirty;
          const opened = await workbench.openProject(definition);
          const paths = (await opened.files.readdir('/')).map((entry) => entry.path);
          await opened.close();
          store.pickStarter('next');
          return { before, after, ownerDirty, paths, dialog: store.dialog() };
        } finally {
          unsubscribe();
        }
      },
      { fixtureUrl: sealedWorkbenchFixtureUrl, options },
    );
    expect(result.before).toBe(true);
    expect(result.ownerDirty).toBe(false);
    expect(result.paths).not.toContain('/note.txt');
    expect(result.after).toBe(false);
    expect(result.dialog).toBeNull();
  } finally {
    await closeOwner(page);
  }
});
