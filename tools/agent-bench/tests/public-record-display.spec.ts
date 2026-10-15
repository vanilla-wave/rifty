import { expect, test } from '@playwright/test';
import {
  publicReadOnlyText,
  publicRecordDisplay,
  publicRecordOrder,
} from '../src/judge/public-record-display.ts';

const original = ['Bay', '2030-01-10', '10:00', '10:01', '1'];
const moved = ['Bay', '2099-06-17', '10:00', '10:01', '1'];
const row = (values: string[]) => values.join(' ');
for (const tag of ['div', 'p', 'li', 'tr']) {
  test(`independent output has no prescribed row tag: ${tag}`, async ({ page }) => {
    const markup =
      tag === 'tr'
        ? `<table><tbody><tr><td>${row(moved)}</td></tr></tbody></table>`
        : `<${tag}>${row(moved)}</${tag}>`;
    await page.setContent(markup);
    const before = await page.locator('body').innerHTML();
    expect(
      await publicRecordDisplay({ view: page, previewUrl: page.url() }, moved, [original[1]!]),
    ).toBe(true);
    expect(
      await publicRecordDisplay({ view: page, previewUrl: page.url() }, original, [moved[1]!]),
    ).toBe(false);
    expect(await page.locator('body').innerHTML()).toBe(before);
  });
}
test('caption and editable draft cannot supply independent saved output', async ({ page }) => {
  await page.setContent(
    `<div>${row(original)}</div><button>Edit ${row(moved)}</button><label>Date<input value="${moved[1]}"></label>`,
  );
  expect(
    await publicRecordDisplay({ view: page, previewUrl: page.url() }, moved, [original[1]!]),
  ).toBe(false);
});
test('readonly native fields remain public output', async ({ page }) => {
  await page.setContent(
    `<section>${moved.map((value) => `<input readonly value="${value}">`).join('')}</section>`,
  );
  expect(
    await publicRecordDisplay({ view: page, previewUrl: page.url() }, moved, [original[1]!]),
  ).toBe(true);
});
test('owned Create retains original key; changed Update removes it', async ({ page }) => {
  await page.setContent(`<div>${row(original)}</div><div>${row(moved)}</div>`);
  const ctx = { view: page, previewUrl: page.url() };
  expect(await publicRecordDisplay(ctx, original, [moved[1]!])).toBe(true);
  expect(await publicRecordDisplay(ctx, moved, [original[1]!])).toBe(true);
  await page.setContent(`<div>${row(moved)}</div>`);
  expect(await publicRecordDisplay(ctx, original, [moved[1]!])).toBe(false);
  expect(await publicRecordDisplay(ctx, moved, [original[1]!])).toBe(true);
});
test('chronology reads shown records independently of action order', async ({ page }) => {
  const earlier = ['Amber', '2030-01-10', '09:00', '10:00', '3'];
  const later = ['Bay', '2030-01-10', '10:00', '11:00', '2'];
  await page.setContent(
    `<div>${row(later)}</div><div>${row(earlier)}</div><button>Edit earlier</button><button>Edit later</button>`,
  );
  expect(await publicRecordOrder({ view: page, previewUrl: page.url() }, [earlier, later])).toEqual(
    [1, 0],
  );
});
test('display contents text is rendered public output', async ({ page }) => {
  await page.setContent(`<div style="display:contents">${row(moved)}</div>`);
  expect(await page.locator('body').innerText()).toContain(row(moved));
  expect(
    await publicRecordDisplay({ view: page, previewUrl: page.url() }, moved, [original[1]!]),
  ).toBe(true);
  expect(await publicReadOnlyText(page.locator('body'))).toContain(row(moved));
});

test('calendar display formatting does not reinterpret literal names', async ({ page }) => {
  await page.setContent('<p>Bay 10/01/2030 10:00–10:01; 1 seats</p>');
  const ctx = { view: page, previewUrl: page.url() };
  expect(
    await publicRecordDisplay(
      ctx,
      ['Bay', { calendarDate: '2030-01-10' }, '10:00', '10:01', '1'],
      [{ calendarDate: '2099-06-17' }],
    ),
  ).toBe(true);
  expect(await publicRecordDisplay(ctx, ['2030-01-10'], [])).toBe(false);
});
