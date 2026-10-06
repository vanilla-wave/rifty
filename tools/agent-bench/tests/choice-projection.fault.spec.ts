import { chromium, expect, test } from '@playwright/test';
import { describedEditableControl, selectChoices, selectedChoice } from '../src/judge/context.ts';

test('selects real identities and rejects missing/ambiguous choices before mutation', async () => {
  test.setTimeout(30000);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(1000);
    await page.setContent(
      '<select aria-label="Room"><option value="a">Amber · 4 seats</option><option value="b">Bay · 2 seats</option></select>',
    );
    const field = page.getByRole('combobox');
    await selectChoices(field, ['Bay']);
    expect(await field.inputValue()).toBe('b');
    expect(await selectedChoice(field, ['Amber', 'Bay'])).toBe('Bay');
    await expect(selectChoices(field, ['Missing'])).rejects.toThrow('Missing/ambiguous');
    expect(await field.inputValue()).toBe('b');
    await expect(selectedChoice(field, ['Amber'])).rejects.toThrow('Missing/ambiguous');
    await page.setContent(
      '<select aria-label="Room"><option value="a">Amber · 4 seats</option><option value="b">Amber · 2 seats</option></select>',
    );
    await expect(selectChoices(field, ['Amber'])).rejects.toThrow('Missing/ambiguous');
    expect(await field.inputValue()).toBe('a');
    await page.setContent(
      '<label>Reservation room<select><option>Amber · 4 seats</option></select></label><label>Seats<input></label>',
    );
    const seats = describedEditableControl({ view: page, previewUrl: 'about:blank' }, 'seats', {
      room: ['Room'],
      seats: ['Seats'],
    });
    expect(await seats.count()).toBe(1);
    await seats.fill('3');
    expect(await seats.inputValue()).toBe('3');
  } finally {
    await browser.close();
  }
});
