import { expect, test } from '@playwright/test';
import { editableControlForAction, workflowAction } from '../src/judge/context.ts';

for (const reversed of [false, true]) {
  test(`creation and inline editing target their own controls, reversed=${reversed}`, async ({
    page,
  }) => {
    const create =
      '<section><label>Room name<input id="create" value="Creation"></label><button>Add room</button></section>';
    const edit =
      '<article><h2>Amber</h2><label>Room name<input id="edit" value="Amber"></label><div><button>Save room Amber</button></div></article>';
    await page.setContent(reversed ? edit + create : create + edit);
    const ctx = { view: page, previewUrl: 'about:blank' };
    const editing = await editableControlForAction(
      ctx,
      /Room name/i,
      await workflowAction(ctx, 'room'),
    );
    await editing.fill('Changed');
    await expect(page.locator('#edit')).toHaveValue('Changed');
    await expect(page.locator('#create')).toHaveValue('Creation');
    const creation = await editableControlForAction(
      ctx,
      /Room name/i,
      await workflowAction(ctx, 'room', true),
    );
    await creation.fill('New');
    await expect(page.locator('#create')).toHaveValue('New');
    await expect(page.locator('#edit')).toHaveValue('Changed');
  });
}

test('reservation values follow their save action while creation remains visible', async ({
  page,
}) => {
  await page.setContent(
    '<form><label>Date<input id="new-date" type="date" value="2030-01-01"></label><button type="button">Add reservation</button></form><article><label>Date<input id="edit-date" type="date" value="2030-01-10"></label><button>Save reservation Amber 09:00</button></article>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  const control = await editableControlForAction(
    ctx,
    /^Date$/,
    await workflowAction(ctx, 'reservation'),
  );
  await control.fill('2030-01-11');
  await expect(page.locator('#edit-date')).toHaveValue('2030-01-11');
  await expect(page.locator('#new-date')).toHaveValue('2030-01-01');
});

test('a shared singleton editor keeps existing lookup behavior', async ({ page }) => {
  await page.setContent('<label>Room name<input></label><button>Save room</button>');
  const ctx = { view: page, previewUrl: 'about:blank' };
  const control = await editableControlForAction(
    ctx,
    /Room name/,
    await workflowAction(ctx, 'room', true),
  );
  await control.fill('Amber');
  await expect(page.getByRole('textbox', { name: 'Room name' })).toHaveValue('Amber');
});

test('unassociated duplicate purposes remain a loud ambiguity', async ({ page }) => {
  await page.setContent(
    '<label>Room name<input></label><label>Room name<input></label><button>Save room</button>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  await expect(
    editableControlForAction(ctx, /Room name/, await workflowAction(ctx, 'room')),
  ).rejects.toThrow(/ambiguous/);
});

test('multiple active save actions cannot silently choose a record', async ({ page }) => {
  await page.setContent('<button>Save room Amber</button><button>Save room Bay</button>');
  await expect(workflowAction({ view: page, previewUrl: 'about:blank' }, 'room')).rejects.toThrow(
    /Ambiguous/,
  );
});

test('native form-associated controls remain targeted outside the form subtree', async ({
  page,
}) => {
  await page.setContent(
    '<form id="create-form"><button>Add room</button></form><form id="edit-form"><button>Save room Amber</button></form><label>Room name<input id="create" form="create-form" value="Creation"></label><label>Room name<input id="edit" form="edit-form" value="Amber"></label>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  const control = await editableControlForAction(
    ctx,
    /Room name/,
    await workflowAction(ctx, 'room'),
  );
  await control.fill('Changed');
  await expect(page.locator('#edit')).toHaveValue('Changed');
  await expect(page.locator('#create')).toHaveValue('Creation');
});
