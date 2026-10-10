import { expect, test } from '@playwright/test';
import { editableControl } from '../src/judge/context.ts';

// W3C ARIA in HTML, input rows: https://www.w3.org/TR/html-aria/
const buttonRoles = [
  'button',
  'checkbox',
  'combobox',
  'gridcell',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'separator',
  'slider',
  'switch',
  'tab',
  'treeitem',
] as const;
const inputRoles = [
  ...(['button', 'reset', 'submit', 'image'] as const).flatMap((type) =>
    buttonRoles
      .filter((role) => type !== 'image' || role !== 'combobox')
      .map((role) => ({ type, role })),
  ),
  ...(['switch', 'menuitemcheckbox', 'option', 'button'] as const).map((role) => ({
    type: 'checkbox',
    role,
  })),
  { type: 'radio', role: 'menuitemradio' as const },
];

for (const { type, role } of inputRoles) {
  test(`named native ${type} with ${role} retains interaction`, async ({ page }) => {
    await page.setContent(
      `<form onsubmit="event.preventDefault()"><label>Flag<input id="control" type="${type}" role="${role}" aria-label="Flag" aria-pressed="false" value="Run" onclick="this.dataset.clicked='yes'"></label></form>`,
    );
    // External native semantic premise, independent of the judge getter.
    await expect(page.getByRole(role, { name: /^Flag$/ })).toHaveCount(1);
    const control = editableControl({ view: page, previewUrl: 'about:blank' }, /^Flag$/);
    expect(await control.count()).toBe(1);
    if (type === 'checkbox' || type === 'radio') {
      await control.check();
      await expect(page.locator('#control')).toBeChecked();
    } else {
      await control.click();
    }
    await expect(page.locator('#control')).toHaveAttribute('data-clicked', 'yes');
  });
}

test('HTML label names native switch without an ARIA label', async ({ page }) => {
  await page.setContent('<label>Flag<input id="flag" type="checkbox" role="switch"></label>');
  await expect(page.getByRole('switch', { name: /^Flag$/ })).toHaveCount(1);
  const control = editableControl({ view: page, previewUrl: 'about:blank' }, /^Flag$/);
  expect(await control.count()).toBe(1);
  await control.check();
  await expect(page.locator('#flag')).toBeChecked();
});
