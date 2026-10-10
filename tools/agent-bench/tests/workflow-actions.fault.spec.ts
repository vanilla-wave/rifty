import { expect, test } from '@playwright/test';
import { actionCaption, choiceOption, workflowActions } from '../src/judge/context.ts';

for (const tag of ['button', 'a']) {
  for (const [subject, collection, other] of [
    ['room', 'Rooms', 'Reservations'],
    ['reservation', 'Reservations', 'Rooms'],
    ['expense', 'Expenses', 'People'],
    ['person', 'People', 'Expenses'],
  ] as const) {
    test(`contextual ${subject}/${tag} does not borrow a sibling collection`, async ({ page }) => {
      await page.setContent(
        `<section aria-label="${collection}"><h2>${collection}</h2><div><span>Amber</span><${tag} href="#" data-target="intended">Edit Amber</${tag}><${tag} href="#">Delete Amber</${tag}></div></section><section aria-label="${other}"><h2>${other}</h2><div><span>Amber</span><${tag} href="#" data-target="other">Edit Amber</${tag}><${tag} href="#">Delete Amber</${tag}></div></section>`,
      );
      const actions = await workflowActions(
        { view: page, previewUrl: 'about:blank' },
        'edit',
        subject,
        'Amber',
      );
      await expect(actions).toHaveCount(1);
      await expect(actions).toHaveAttribute('data-target', 'intended');
    });
  }
  test(`opaque Cancel identity and cancellation/${tag} have distinct contexts`, async ({
    page,
  }) => {
    await page.setContent(
      `<section aria-label="Rooms"><h2>Rooms</h2><label>Room name<input value="Cancel"></label><${tag} href="#" data-target="cancellation">Cancel room edit</${tag}><ul><li><span>Cancel</span><${tag} href="#" data-target="record">Cancel room edit</${tag}><${tag} href="#">Delete room Cancel</${tag}></li></ul></section>`,
    );
    const actions = await workflowActions(
      { view: page, previewUrl: 'about:blank' },
      'edit',
      'room',
    );
    await expect(actions).toHaveCount(1);
    await expect(actions).toHaveAttribute('data-target', 'record');
  });
}

for (const [subject, collection] of [
  ['room', 'Rooms'],
  ['expense', 'Expenses'],
] as const) {
  for (const tag of ['button', 'a']) {
    test(`draft discard and opaque Discard record/${subject}/${tag}`, async ({ page }) => {
      await page.setContent(
        `<section aria-label="${collection}"><h2>${collection}</h2><label>Name<input value="Discard"></label><${tag} href="#" data-target="draft">Discard ${subject} edit</${tag}><ul><li><span>Discard</span><${tag} href="#" data-target="record">Discard ${subject} edit</${tag}><${tag} href="#">Delete ${subject} Discard</${tag}></li></ul></section>`,
      );
      const actions = await workflowActions(
        { view: page, previewUrl: 'about:blank' },
        'edit',
        subject,
      );
      await expect(actions).toHaveCount(1);
      await expect(actions).toHaveAttribute('data-target', 'record');
    });
  }
}

for (const subject of ['room', 'expense']) {
  test(`a named ${subject} record needs no complementary action`, async ({ page }) => {
    await page.setContent(
      `<article><span>Amber</span><button data-target="record">${subject} Amber Edit</button></article>`,
    );
    const actions = await workflowActions(
      { view: page, previewUrl: 'about:blank' },
      'edit',
      subject,
    );
    await expect(actions).toHaveCount(1);
    await expect(actions).toHaveAttribute('data-target', 'record');
  });
}

for (const subject of ['room', 'expense']) {
  for (const identity of ['(Amber)', '[Amber]', '"Amber"', '(Bay)']) {
    test(`decorated record identity ${subject}/${identity}`, async ({ page }) => {
      await page.setContent(
        `<article><span>${identity === '(Bay)' ? 'Bay' : 'Amber'}</span><button data-target="record">Edit ${subject} ${identity}</button><button>Delete ${subject} ${identity}</button></article>`,
      );
      const actions = await workflowActions(
        { view: page, previewUrl: 'about:blank' },
        'edit',
        subject,
      );
      await expect(actions).toHaveCount(1);
    });
  }
}

test('punctuated literal identity reaches action and choice consumers', async ({ page }) => {
  await page.setContent(
    '<article><span>(Amber)</span><button>Edit room (Amber)</button><button>Delete room (Amber)</button></article><select><option>(Amber)</option></select>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  await expect(
    page.getByRole('button', { name: actionCaption('edit', 'room', '(Amber)') }),
  ).toHaveCount(1);
  await expect(await workflowActions(ctx, 'edit', 'room', '(Amber)')).toHaveCount(1);
  await expect(await choiceOption(page, '(Amber)')).toHaveCount(1);
});

for (const subject of ['room', 'expense']) {
  for (const tag of ['button', 'a']) {
    for (const paired of [false, true]) {
      test(`independent record presentation ${subject}/${tag}/paired=${paired}`, async ({
        page,
      }) => {
        await page.setContent(
          `<article><span>Amber</span><${tag} href="#" data-target="record">Edit ${subject} (Amber)</${tag}>${paired ? `<${tag} href="#">Delete ${subject} Amber</${tag}>` : ''}</article>`,
        );
        const actions = await workflowActions(
          { view: page, previewUrl: 'about:blank' },
          'edit',
          subject,
        );
        await expect(actions).toHaveCount(1);
        await expect(actions).toHaveAttribute('data-target', 'record');
      });
    }
  }
}

test('record corroboration preserves distinct literal action identities', async ({ page }) => {
  await page.setContent(
    '<article><span>(Amber)</span><button>Edit room [(Amber)]</button><button>Delete room (Amber)</button></article><article><span>Amber</span><button>Edit room [Amber]</button><button>Delete room Amber</button></article>',
  );
  const actions = await workflowActions({ view: page, previewUrl: 'about:blank' }, 'edit', 'room');
  await expect(actions).toHaveCount(2);
  await expect(actions.filter({ hasText: 'Edit room [(Amber)]' })).toHaveCount(1);
  await expect(actions.filter({ hasText: 'Edit room [Amber]' })).toHaveCount(1);
});
