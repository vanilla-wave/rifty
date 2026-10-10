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

for (const representation of ['text', 'aria', 'label', 'labelledby'] as const) {
  for (const reversed of [false, true]) {
    test(`literal overlapping identities follow native selection: ${representation}, reversed=${reversed}`, async ({
      page,
    }) => {
      const names = reversed ? ['(Amber)', 'Amber'] : ['Amber', '(Amber)'];
      const option = (name: string, index: number) =>
        representation === 'aria'
          ? `<option value="${index}" aria-label="${name}">Display ${index}</option>`
          : representation === 'label'
            ? `<option value="${index}" label="${name}">Display ${index}</option>`
            : representation === 'labelledby'
              ? `<option value="${index}" aria-labelledby="name-${index}">Display ${index}</option>`
              : `<option value="${index}">${name}</option>`;
      await page.setContent(
        `${names.map((name, index) => `<span id="name-${index}">${name}</span>`).join('')}<select aria-label="Room">${names.map(option).join('')}</select>`,
      );
      const field = page.getByRole('combobox');
      for (const name of names) {
        await selectChoices(field, [name]);
        expect(await field.inputValue()).toBe(String(names.indexOf(name)));
        expect(await selectedChoice(field, names)).toBe(name);
      }
    });
  }
}
