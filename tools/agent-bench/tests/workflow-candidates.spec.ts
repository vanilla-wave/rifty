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

// ADR-0519/0522: a record literally named Cancel keeps every Edit affordance as a candidate;
// only the editor's cancellation without record identity evidence is excluded.
for (const tag of ['button', 'a']) {
  test(`two Edit aliases of a record named Cancel stay candidates: ${tag}`, async ({ page }) => {
    await page.setContent(
      `<section aria-label="Rooms"><h2>Rooms</h2><label>Room name<input value="Cancel"></label><${tag} href="#" data-target="cancellation">Cancel room edit</${tag}><ul><li><span>Cancel</span><${tag} href="#" data-target="record">Cancel room edit</${tag}><${tag} href="#" data-target="record">Cancel room edit</${tag}><${tag} href="#">Delete room Cancel</${tag}></li></ul></section>`,
    );
    const candidates = await workflowCandidates(
      { view: page, previewUrl: 'about:blank' },
      'edit',
      'room',
    );
    // Pure eligibility keeps both record aliases; the editor's cancellation may be listed too (ADR-0522).
    await expect(candidates.and(page.locator('[data-target="record"]'))).toHaveCount(2);
  });
}

// ADR-0520: public layout is open — the record's identity and its Delete may sit in a nested
// presentation group beside the Edit aliases; that group is the same record, not a foreign one.
for (const tag of ['button', 'a']) {
  test(`nested identity group of a record named Cancel keeps both Edit aliases: ${tag}`, async ({
    page,
  }) => {
    await page.setContent(
      `<section aria-label="Rooms"><h2>Rooms</h2><label>Room name<input value="Cancel"></label><${tag} href="#" data-target="cancellation">Cancel room edit</${tag}><ul><li><div><span>Cancel</span><${tag} href="#">Delete room Cancel</${tag}></div><${tag} href="#" data-target="record">Cancel room edit</${tag}><${tag} href="#" data-target="record">Cancel room edit</${tag}></li></ul></section>`,
    );
    const candidates = await workflowCandidates(
      { view: page, previewUrl: 'about:blank' },
      'edit',
      'room',
    );
    // Pure eligibility keeps both record aliases; the editor's cancellation may be listed too (ADR-0522).
    await expect(candidates.and(page.locator('[data-target="record"]'))).toHaveCount(2);
  });
}

// Computed captions and opaque identities (ADR-0519): aliases named through aria-labelledby, a
// hidden Edit control inside the identity group, and a verb word inside the literal identity
// must not turn the record's own presentation group into a foreign record.
for (const tag of ['button', 'a']) {
  test(`labelledby aliases and a hidden control keep the Cancel record: ${tag}`, async ({
    page,
  }) => {
    await page.setContent(
      `<section aria-label="Rooms"><h2>Rooms</h2><label>Room name<input value="Cancel"></label><${tag} href="#" data-target="cancellation">Cancel room edit</${tag}><ul><li><div><span id="n1">Cancel</span><${tag} href="#" hidden>Cancel room edit</${tag}><${tag} href="#">Delete room Cancel</${tag}></div><span id="v1" hidden>room edit</span><${tag} href="#" data-target="record" aria-labelledby="n1 v1">✎</${tag}><${tag} href="#" data-target="record" aria-labelledby="n1 v1">✎</${tag}></li></ul></section>`,
    );
    const candidates = await workflowCandidates(
      { view: page, previewUrl: 'about:blank' },
      'edit',
      'room',
    );
    // Pure eligibility keeps both record aliases; the editor's cancellation may be listed too (ADR-0522).
    await expect(candidates.and(page.locator('[data-target="record"]'))).toHaveCount(2);
  });

  test(`a verb inside the opaque identity stays identity: ${tag}`, async ({ page }) => {
    await page.setContent(
      `<section aria-label="Rooms"><h2>Rooms</h2><ul><li><div><span>Cancel edit</span><${tag} href="#">Delete room Cancel edit</${tag}></div><${tag} href="#" data-target="record">Cancel edit room edit</${tag}><${tag} href="#" data-target="record">Cancel edit room edit</${tag}></li></ul></section>`,
    );
    const candidates = await workflowCandidates(
      { view: page, previewUrl: 'about:blank' },
      'edit',
      'room',
    );
    // Pure eligibility may also list the ambiguous Delete caption; both Edit aliases must survive.
    await expect(candidates.and(page.locator('[data-target="record"]'))).toHaveCount(2);
  });
}

// ADR-0522: no observation load may execute a destructive operation. A Delete caption that only
// matches the requested verb through the record's literal identity is not an Edit candidate.
for (const tag of ['button', 'a']) {
  test(`a destructive caption matching the verb through identity is not an edit candidate: ${tag}`, async ({
    page,
  }) => {
    await page.setContent(
      `<section aria-label="Rooms"><h2>Rooms</h2><ul><li><span>Cancel edit</span><${tag} href="#" data-target="delete">Delete room Cancel edit</${tag}><${tag} href="#" data-target="record">Cancel edit room edit</${tag}><${tag} href="#" data-target="record">Cancel edit room edit</${tag}></li></ul></section>`,
    );
    const ctx = { view: page, previewUrl: 'about:blank' };
    const candidates = await workflowCandidates(ctx, 'edit', 'room');
    await expect(candidates.and(page.locator('[data-target="record"]'))).toHaveCount(2);
    await expect(candidates.and(page.locator('[data-target="delete"]'))).toHaveCount(0);
    // The destructive operation itself stays discoverable for a delete request.
    await expect(
      (await workflowCandidates(ctx, 'delete', 'room')).and(page.locator('[data-target="delete"]')),
    ).toHaveCount(1);
  });
}
