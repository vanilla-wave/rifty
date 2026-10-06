import { expect, test } from '@playwright/test';
import { savedNoteEntry, wikiNoteTarget } from '../src/judge/context.ts';

test('named accessible title takes precedence over preceding excerpt components', async ({
  page,
}) => {
  await page.setContent(
    '<button aria-labelledby="title"><small>Alpha</small><strong id="title">Beta</strong></button>',
  );
  const ctx = { view: page, previewUrl: page.url() };
  await expect(page.getByRole('button', { name: 'Beta', exact: true })).toHaveCount(1);
  await expect(await savedNoteEntry(ctx, 'Beta', ['Alpha'])).toHaveCount(1);
  await expect(await wikiNoteTarget(ctx, 'Beta', 'Alpha')).toHaveCount(1);
});

test('composed delete action never becomes a saved-note entry', async ({ page }) => {
  await page.setContent('<button><span>Beta</span><span>Delete</span></button>');
  const ctx = { view: page, previewUrl: page.url() };
  await expect(page.getByRole('button', { name: 'BetaDelete', exact: true })).toHaveCount(1);
  await expect(await savedNoteEntry(ctx, 'Beta', ['Alpha'])).toHaveCount(0);
  await expect(await wikiNoteTarget(ctx, 'Beta', 'Alpha')).toHaveCount(0);
});

test('aria-hidden title does not give an unnamed action a note identity', async ({ page }) => {
  await page.setContent('<button><span aria-hidden="true">Beta</span></button>');
  const ctx = { view: page, previewUrl: page.url() };
  await expect(page.getByRole('button', { name: 'Beta', exact: true })).toHaveCount(0);
  await expect(await savedNoteEntry(ctx, 'Beta', ['Alpha'])).toHaveCount(0);
});

test('primary title distinguishes another note excerpt after concatenation', async ({ page }) => {
  await page.setContent(
    '<button><span>Alpha</span><small>Beta</small></button><button><span>Beta</span><small>Unique body needle</small></button>',
  );
  const ctx = { view: page, previewUrl: page.url() };
  await expect(await savedNoteEntry(ctx, 'Beta', ['Alpha'])).toHaveCount(1);
  await expect(await savedNoteEntry(ctx, 'Alpha', ['Beta'])).toHaveCount(1);
});
