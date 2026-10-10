import { expect, test } from '@playwright/test';
import { workflowCandidates } from '../src/judge/context.ts';

for (const tag of ['button', 'a']) {
  test(`candidate query is pure and includes ambiguous record/draft affordances: ${tag}`, async ({
    page,
  }) => {
    await page.setContent(
      `<section aria-label="Rooms"><h2>Rooms</h2><label>Room name<input value="Unrelated draft"></label><div><p>Discard changes</p><${tag} href="#" onclick="document.querySelector('input').value='Canceled'">Discard room edit</${tag}></div><div><span>Bay</span><${tag} href="#" onclick="document.querySelector('input').value='Bay'">Edit room details for Bay</${tag}><${tag} href="#">Bay Edit</${tag}></div></section><section aria-label="Expenses"><h2>Expenses</h2><${tag} href="#">Edit Train</${tag}></section>`,
    );
    const ctx = { view: page, previewUrl: 'about:blank' };
    const candidates = await workflowCandidates(ctx, 'edit', 'room');
    await expect(candidates).toHaveCount(3);
    await expect(page.getByRole('textbox', { name: 'Room name' })).toHaveValue('Unrelated draft');
    await expect(await workflowCandidates(ctx, 'edit', 'expense')).toHaveCount(1);
    await expect(page.getByRole('textbox', { name: 'Room name' })).toHaveValue('Unrelated draft');
  });
}

test('disabled and hidden affordances are not callable candidates', async ({ page }) => {
  await page.setContent(
    '<button disabled>Edit room Bay</button><button hidden>Edit room Amber</button><button>Edit room details for Cove</button>',
  );
  await expect(
    await workflowCandidates({ view: page, previewUrl: 'about:blank' }, 'edit', 'room'),
  ).toHaveCount(1);
});
