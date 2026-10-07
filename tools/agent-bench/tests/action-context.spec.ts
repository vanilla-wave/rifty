import { expect, test } from '@playwright/test';
import { participants } from '../corpus/cases/expense-settlement-v5/judge.ts';
import {
  controlForAction,
  editableControlForAction,
  workflowAction,
} from '../src/judge/context.ts';

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

test('native external participant buttons follow their form action', async ({ page }) => {
  await page.setContent(
    '<form id="create-form"><button>Add expense</button></form><form id="edit-form"><button>Save expense Train</button></form><button type="button" form="create-form" aria-label="Ada" aria-pressed="false" onclick="this.setAttribute(\'aria-pressed\',\'true\')">Ada</button><button type="button" form="edit-form" aria-label="Ada" aria-pressed="false" onclick="this.setAttribute(\'aria-pressed\',\'true\')">Ada</button>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  await (
    await controlForAction(
      page.getByRole('button', { name: 'Ada' }),
      await workflowAction(ctx, 'expense', true),
    )
  ).click();
  await expect(page.locator('button[form="create-form"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('button[form="edit-form"]')).toHaveAttribute('aria-pressed', 'false');
});

for (const desired of [false, true]) {
  for (const createState of [false, true]) {
    test(`expense participant intent precedes state, desired=${desired}, create=${createState}`, async ({
      page,
    }) => {
      const editState = !createState;
      const toggle = (state: boolean) =>
        `<button type="button" aria-label="Ada" aria-pressed="${state}" onclick="this.setAttribute('aria-pressed',String(this.getAttribute('aria-pressed')!=='true'))">Ada</button>`;
      await page.setContent(
        `<form>${toggle(createState)}<button>Add expense</button></form><form>${toggle(editState)}<button>Save expense Train</button></form>`,
      );
      await participants({ view: page, previewUrl: 'about:blank' }, desired ? ['Ada'] : []);
      await expect(
        page.locator('form').nth(0).getByRole('button', { name: 'Ada' }),
      ).toHaveAttribute('aria-pressed', String(desired));
      await expect(
        page.locator('form').nth(1).getByRole('button', { name: 'Ada' }),
      ).toHaveAttribute('aria-pressed', String(editState));
    });
  }
}

for (const kind of ['checkbox', 'select', 'button'] as const) {
  test(`external native ${kind} participant consumer preserves the other draft`, async ({
    page,
  }) => {
    const control = (form: string, selected: boolean) =>
      kind === 'checkbox'
        ? `<input type="checkbox" form="${form}" aria-label="Ada" ${selected ? 'checked' : ''}>`
        : kind === 'select'
          ? `<select form="${form}" multiple aria-label="Participants"><option ${selected ? 'selected' : ''}>Ada</option></select>`
          : `<button type="button" form="${form}" aria-label="Ada" aria-pressed="${selected}" onclick="this.setAttribute('aria-pressed',String(this.getAttribute('aria-pressed')!=='true'))">Ada</button>`;
    await page.setContent(
      `<form id="create-form"><button>Add expense</button></form><form id="edit-form"><button>Save expense Train</button></form>${control('create-form', false)}${control('edit-form', true)}<button>Delete person Ada</button>`,
    );
    await participants({ view: page, previewUrl: 'about:blank' }, ['Ada']);
    for (const form of ['create-form', 'edit-form']) {
      const node = page.locator(`[form="${form}"]`);
      if (kind === 'checkbox') await expect(node).toBeChecked();
      else if (kind === 'select') await expect(node).toHaveValues(['Ada']);
      else await expect(node).toHaveAttribute('aria-pressed', 'true');
    }
  });
}

for (const createKind of ['checkbox', 'select', 'button'] as const) {
  for (const editKind of ['checkbox', 'select', 'button'] as const) {
    if (createKind === editKind) continue;
    test(`participant representation follows intent: create=${createKind}, edit=${editKind}`, async ({
      page,
    }) => {
      const control = (kind: typeof createKind) =>
        kind === 'checkbox'
          ? '<input type="checkbox" aria-label="Ada">'
          : kind === 'select'
            ? '<select multiple aria-label="Participants"><option>Ada</option><option selected>Cara</option></select>'
            : `<button type="button" aria-label="Ada" aria-pressed="false" onclick="this.setAttribute('aria-pressed',String(this.getAttribute('aria-pressed')!=='true'))">Ada</button>`;
      await page.setContent(
        `<form id="create-form">${control(createKind)}<button>Add expense</button></form><form id="edit-form">${control(editKind)}<button>Save expense Train</button></form>`,
      );
      await participants({ view: page, previewUrl: 'about:blank' }, ['Ada']);
      const create = page.locator('#create-form');
      const edit = page.locator('#edit-form');
      if (createKind === 'checkbox') await expect(create.getByRole('checkbox')).toBeChecked();
      else if (createKind === 'select')
        await expect(create.getByRole('listbox')).toHaveValues(['Ada']);
      else
        await expect(create.getByRole('button', { name: 'Ada' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      if (editKind === 'checkbox') await expect(edit.getByRole('checkbox')).not.toBeChecked();
      else if (editKind === 'select')
        await expect(edit.getByRole('listbox')).toHaveValues(['Cara']);
      else
        await expect(edit.getByRole('button', { name: 'Ada' })).toHaveAttribute(
          'aria-pressed',
          'false',
        );
    });
  }
}

for (const container of ['form', 'section']) {
  test(`complete participant set survives a nested action in idless ${container}`, async ({
    page,
  }) => {
    await page.setContent(
      `<${container}><div><label>Ada<input type="checkbox"></label><button type="button">Add expense</button></div><label>Cara<input type="checkbox"></label></${container}>`,
    );
    await participants({ view: page, previewUrl: 'about:blank' }, ['Ada', 'Cara']);
    await expect(page.getByRole('checkbox', { name: 'Ada' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Cara' })).toBeChecked();
  });
}

for (const container of ['form', 'section']) {
  test(`complete intended participant set preserves a second idless ${container}`, async ({
    page,
  }) => {
    await page.setContent(
      `<${container}><div><label>Ada<input type="checkbox"></label><button type="button">Add expense</button></div><label>Cara<input type="checkbox"></label></${container}><${container}><label>Ada<input type="checkbox"></label><label>Cara<input type="checkbox"></label><button type="button">Save expense Train</button></${container}>`,
    );
    await participants({ view: page, previewUrl: 'about:blank' }, ['Ada', 'Cara']);
    await expect(
      page.locator(container).nth(0).getByRole('checkbox', { name: 'Ada' }),
    ).toBeChecked();
    await expect(
      page.locator(container).nth(0).getByRole('checkbox', { name: 'Cara' }),
    ).toBeChecked();
    await expect(
      page.locator(container).nth(1).getByRole('checkbox', { name: 'Ada' }),
    ).not.toBeChecked();
    await expect(
      page.locator(container).nth(1).getByRole('checkbox', { name: 'Cara' }),
    ).not.toBeChecked();
  });
}

test('idless native owner excludes a foreign participant inside its action container', async ({
  page,
}) => {
  await page.setContent(
    '<form><div><label>Ada<input type="checkbox"></label><label>Cara<input id="foreign" type="checkbox" form="edit-form"></label><button type="button">Add expense</button></div><label>Cara<input id="owned" type="checkbox"></label></form><form id="edit-form"><button type="button">Save expense Train</button></form>',
  );
  await participants({ view: page, previewUrl: 'about:blank' }, ['Ada', 'Cara']);
  await expect(page.getByRole('checkbox', { name: 'Ada' })).toBeChecked();
  await expect(page.locator('#owned')).toBeChecked();
  await expect(page.locator('#foreign')).not.toBeChecked();
});

test('shared unique participant purposes preserve an unassociated sibling control', async ({
  page,
}) => {
  await page.setContent(
    '<form id="shared"><label>Ada<input type="checkbox"></label><button type="button">Add expense</button></form><label>Cara<input type="checkbox"></label>',
  );
  await participants({ view: page, previewUrl: 'about:blank' }, ['Ada', 'Cara']);
  await expect(page.getByRole('checkbox', { name: 'Ada' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Cara' })).toBeChecked();
});

test('Add opener and Save commit share one editor purpose', async ({ page }) => {
  await page.setContent(
    '<section><label>Room name<input id="name" value="Amber"></label><button type="button" onclick="document.querySelector(\'#name\').value=\'\'">Add room</button><button type="button" onclick="document.body.dataset.saved=document.querySelector(\'#name\').value">Save room</button></section>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  const purpose = page.getByRole('textbox', { name: 'Room name' });
  await (await workflowAction(ctx, 'room', true, purpose)).click();
  await expect(page.locator('body')).toHaveAttribute('data-saved', 'Amber');
  await expect(purpose).toHaveValue('Amber');
});

test('creation Add and editing Save keep distinct editor purposes', async ({ page }) => {
  await page.setContent(
    '<form><label>Room name<input id="create-name" value="New"></label><button type="button" onclick="document.body.dataset.saved=document.querySelector(\'#create-name\').value">Add room</button></form><form><label>Room name<input id="edit-name" value="Existing"></label><button type="button" onclick="document.body.dataset.saved=document.querySelector(\'#edit-name\').value">Save room</button></form>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  await (
    await workflowAction(ctx, 'room', true, page.getByRole('textbox', { name: 'Room name' }))
  ).click();
  await expect(page.locator('body')).toHaveAttribute('data-saved', 'New');
  await expect(page.locator('#edit-name')).toHaveValue('Existing');
});

test('equivalent commit affordances preserve computed caption across role and DOM shape', async ({
  page,
}) => {
  await page.setContent(
    '<input aria-label="Room name" value="Amber"><button disabled aria-label="Save room"><span>icon only</span></button><a href="#" aria-label="Save room" onclick="event.preventDefault();document.body.dataset.saved=\'Amber\'">Different text</a>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  await (
    await workflowAction(ctx, 'room', false, page.getByRole('textbox', { name: 'Room name' }))
  ).click();
  await expect(page.locator('body')).toHaveAttribute('data-saved', 'Amber');
});

test('equal commit captions in distinct editors remain ambiguous', async ({ page }) => {
  await page.setContent(
    '<form><label>Room name<input value="Amber"></label><button>Save room</button></form><form><label>Room name<input value="Bay"></label><button>Save room</button></form>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  await expect(
    workflowAction(ctx, 'room', false, page.getByRole('textbox', { name: 'Room name' })),
  ).rejects.toThrow(/Ambiguous/);
});

test('different record captions sharing fields remain ambiguous', async ({ page }) => {
  await page.setContent(
    '<input aria-label="Room name"><button>Save room Amber</button><button>Save room Bay</button>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  await expect(
    workflowAction(ctx, 'room', false, page.getByRole('textbox', { name: 'Room name' })),
  ).rejects.toThrow(/Ambiguous/);
});

test('escaped record captions remain distinct identities', async ({ page }) => {
  await page.setContent(
    '<input aria-label="Room name"><button aria-label=\'Save room "Amber"\'>Save</button><button aria-label=\'Save room "Bay"\'>Save</button>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  await expect(
    workflowAction(ctx, 'room', false, page.getByRole('textbox', { name: 'Room name' })),
  ).rejects.toThrow(/Ambiguous/);
});

for (const [subjects, first, second] of [
  ['room', 'Save room', 'Update room'],
  ['room', 'Add room', 'Create room'],
  ['reservation|booking', 'Save reservation', 'Update booking'],
  ['reservation|booking', 'Add reservation', 'Create booking'],
  ['expense', 'Save expense', 'Update expense'],
  ['room', 'room Save', 'room Update'],
] as const) {
  test(`explicit action aliases ${first}/${second} preserve one editor`, async ({ page }) => {
    await page.setContent(
      `<input aria-label="Name"><button>${first}</button><button>${second}</button>`,
    );
    await expect(
      workflowAction(
        { view: page, previewUrl: 'about:blank' },
        subjects,
        true,
        page.getByRole('textbox', { name: 'Name' }),
      ),
    ).resolves.toBeDefined();
  });
}

test('action aliases preserve verb words inside opaque record identity', async ({ page }) => {
  await page.setContent(
    '<input aria-label="Name"><button>Save room Save</button><button>Update room Update</button>',
  );
  await expect(
    workflowAction(
      { view: page, previewUrl: 'about:blank' },
      'room',
      false,
      page.getByRole('textbox', { name: 'Name' }),
    ),
  ).rejects.toThrow(/Ambiguous/);
});

test('action aliases preserve identical opaque record suffixes', async ({ page }) => {
  await page.setContent(
    '<input aria-label="Name"><button>Save room Update</button><button>Update room Update</button>',
  );
  await expect(
    workflowAction(
      { view: page, previewUrl: 'about:blank' },
      'room',
      false,
      page.getByRole('textbox', { name: 'Name' }),
    ),
  ).resolves.toBeDefined();
});

test('action aliases across distinct editors remain ambiguous', async ({ page }) => {
  await page.setContent(
    '<form><input aria-label="Name"><button>Save room</button></form><form><input aria-label="Name"><button>Update room</button></form>',
  );
  await expect(
    workflowAction(
      { view: page, previewUrl: 'about:blank' },
      'room',
      false,
      page.getByRole('textbox', { name: 'Name' }),
    ),
  ).rejects.toThrow(/Ambiguous/);
});

for (const suffix of [': commit', ": Ada's", ' \u0080']) {
  test(`computed action caption preserves YAML quoting ${JSON.stringify(suffix)}`, async ({
    page,
  }) => {
    await page.setContent('<input aria-label="Name"><button></button><button></button>');
    for (const [index, verb] of ['Save', 'Update'].entries())
      await page
        .getByRole('button')
        .nth(index)
        .evaluate((node, name) => node.setAttribute('aria-label', name), `${verb} room${suffix}`);
    await expect(
      workflowAction(
        { view: page, previewUrl: 'about:blank' },
        'room',
        false,
        page.getByRole('textbox', { name: 'Name' }),
      ),
    ).resolves.toBeDefined();
  });
}

test('YAML quoted captions preserve distinct record suffixes', async ({ page }) => {
  await page.setContent(
    '<input aria-label="Name"><button>Save room: Amber</button><button>Update room: Bay</button>',
  );
  await expect(
    workflowAction(
      { view: page, previewUrl: 'about:blank' },
      'room',
      false,
      page.getByRole('textbox', { name: 'Name' }),
    ),
  ).rejects.toThrow(/Ambiguous/);
});
