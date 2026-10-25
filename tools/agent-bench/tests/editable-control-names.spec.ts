import { expect, test } from '@playwright/test';
import { editableControl, fieldValue } from '../src/judge/context.ts';

test('reservation control keeps its accessible purpose as options change', async ({ page }) => {
  await page.setContent(
    '<label>Reservation room<select id="room"><option value="">Choose room</option></select></label>',
  );
  const purpose =
    /^(?!.*\bfilter\b)(?:(?:(?!\bname\b).)*\b(?:reservation|booking)\b.*\broom\b|(?!.*\bname\b).*\broom\b)/i;
  const ctx = { view: page, previewUrl: 'about:blank' };
  await expect(page.getByRole('combobox', { name: purpose })).toHaveCount(1);
  await page.locator('#room').evaluate((node) => {
    const select = node as HTMLSelectElement;
    select.add(new Option('Amber', 'a'));
    select.add(new Option('Bay East', 'b'));
  });
  await expect(page.getByRole('combobox', { name: purpose })).toHaveCount(1);
  const control = editableControl(ctx, purpose);
  await expect(control).toHaveCount(1);
  await control.selectOption('b');
  await expect(page.locator('#room')).toHaveValue('b');
});

test('textarea prose does not become another control purpose', async ({ page }) => {
  await page.setContent(
    '<label>Markdown<textarea id="body">Title in prose</textarea></label><label>Title<input id="title"></label>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  await expect(page.getByRole('textbox', { name: /title/i })).toHaveCount(1);
  const title = editableControl(ctx, /title/i);
  await expect(title).toHaveCount(1);
  await title.fill('Actual title');
  await expect(page.locator('#title')).toHaveValue('Actual title');
  expect(await fieldValue(page.locator('#body'))).toBe('Title in prose');
});

test('native multiple-select name excludes participant data', async ({ page }) => {
  await page.setContent(
    '<label>Participants<select id="participants" multiple><option value="a">Payer Ada</option><option value="b">Ben</option></select></label><label>Payer<select id="payer"><option value="b">Ben</option></select></label>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  await expect(page.getByRole('listbox', { name: /^Participants$/i })).toHaveCount(1);
  const participants = editableControl(ctx, /^Participants$/i);
  await expect(participants).toHaveCount(1);
  await participants.selectOption(['a', 'b']);
  await expect(page.locator('#participants')).toHaveValues(['a', 'b']);
  const payer = editableControl(ctx, /payer/i);
  await expect(payer).toHaveCount(1);
  await expect(payer).toHaveAttribute('id', 'payer');
});

test('named native input kinds retain editable values', async ({ page }) => {
  await page.setContent(
    '<label>Amount<input id="amount" type="number"></label><label>Date<input id="date" type="date"></label><label>Start<input id="time" type="time"></label><label>Password<input id="password" type="password"></label>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  for (const [purpose, value] of [
    ['Amount', '12.34'],
    ['Date', '2030-01-10'],
    ['Start', '12:00'],
    ['Password', 'literal'],
  ] as const) {
    const control = editableControl(ctx, new RegExp(`^${purpose}$`, 'i'));
    await expect(control).toHaveCount(1);
    await control.fill(value);
    expect(await fieldValue(control)).toBe(value);
  }
});

test('explicitly labelled contenteditable retains its own purpose', async ({ page }) => {
  await page.setContent(
    '<span id="caption">Markdown</span><div contenteditable="true" aria-labelledby="caption">Title in prose</div>',
  );
  const control = editableControl({ view: page, previewUrl: 'about:blank' }, /^Markdown$/i);
  await expect(control).toHaveCount(1);
  await control.fill('Updated prose');
  expect(await fieldValue(control)).toBe('Updated prose');
});

test('other named native input controls retain their interactions', async ({ page }) => {
  await page.setContent(
    '<label>Flag<input type="checkbox"></label><label>Choice<input type="radio"></label><label>Level<input type="range" min="0" max="10" value="2"></label><label>Trigger<input type="button" aria-label="Trigger" value="Run"></label><label>Month<input type="month"></label><label>Week<input type="week"></label><label>Local time<input type="datetime-local"></label><label>Colour<input type="color"></label><label>Attachment<input type="file"></label>',
  );
  const ctx = { view: page, previewUrl: 'about:blank' };
  for (const name of ['Flag', 'Choice']) {
    const control = editableControl(ctx, new RegExp(`^${name}$`, 'i'));
    await control.check();
    await expect(control).toBeChecked();
  }
  const level = editableControl(ctx, /^Level$/i);
  await level.focus();
  await level.press('ArrowRight');
  expect(await fieldValue(level)).toBe('3');
  const trigger = editableControl(ctx, /^Trigger$/i);
  await expect(page.getByRole('button', { name: /^Trigger$/i })).toHaveCount(1);
  await expect(trigger).toHaveCount(1);
  expect(await fieldValue(trigger)).toBe('Run');
  for (const [name, value] of [
    ['Month', '2030-01'],
    ['Week', '2030-W02'],
    ['Local time', '2030-01-10T12:00'],
  ] as const) {
    const control = editableControl(ctx, new RegExp(`^${name}$`, 'i'));
    await control.fill(value);
    expect(await fieldValue(control)).toBe(value);
  }
  await expect(editableControl(ctx, /^Colour$/i)).toHaveAttribute('type', 'color');
  const attachment = editableControl(ctx, /^Attachment$/i);
  await attachment.setInputFiles({
    name: 'proof.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('native file'),
  });
  expect(await attachment.evaluate((node) => (node as HTMLInputElement).files?.[0]?.name)).toBe(
    'proof.txt',
  );
});

test('read-only and disabled fields remain excluded', async ({ page }) => {
  await page.setContent(
    '<label>Room<select disabled><option>Amber</option></select></label><label>Room<textarea readonly>Amber</textarea></label><label>Room<input readonly></label>',
  );
  await expect(editableControl({ view: page, previewUrl: 'about:blank' }, /room/i)).toHaveCount(0);
});

test('placeholder or keyboard shortcut is not a named Search control', async ({ page }) => {
  await page.setContent(
    '<label><span aria-hidden="true">⌕</span><input type="search" placeholder="Search notes"><kbd>⌘ K</kbd></label>',
  );
  await expect(page.getByRole('searchbox', { name: /⌘/ })).toHaveCount(1);
  await expect(editableControl({ view: page, previewUrl: 'about:blank' }, /search/i)).toHaveCount(
    0,
  );
});
