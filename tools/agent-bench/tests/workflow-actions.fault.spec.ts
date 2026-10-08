import { expect, test } from '@playwright/test';
import { workflowActions } from '../src/judge/context.ts';

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
