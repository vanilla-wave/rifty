import { caption, fieldValue, verdict } from '../../src/judge/context.ts';
import type { JudgeContext, JudgeProbe, TaskJudge } from '../../src/judge/context.ts';

async function click(ctx: JudgeContext, name: RegExp) {
  const matches = ctx.view.getByRole('button', { name }).or(ctx.view.getByRole('link', { name }));
  for (const node of await matches.all())
    if (await node.isVisible()) {
      await node.click();
      return;
    }
  throw new Error(`Missing named action ${name}`);
}
const input = (ctx: JudgeContext, name: RegExp) => ctx.view.getByLabel(name);
function cents(text: string) {
  const normalized = text.replaceAll('−', '-').replaceAll(',', '');
  const value = /[+-]?\d+(?:\.\d{1,2})?/.exec(normalized)?.[0];
  if (!value) throw new Error(`Missing readable amount: ${text}`);
  const negative = value.startsWith('-') || /^\s*\(/.test(normalized);
  const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  return (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (negative ? -1 : 1);
}
async function person(ctx: JudgeContext, name: string) {
  const field = input(ctx, /(?=.*\bperson\b)(?=.*\bname\b)/i);
  if (!(await field.isVisible())) await click(ctx, /\b(?:new|add|create)\b.*\bperson\b/i);
  await field.fill(name);
  await click(ctx, /\b(?:add|create|save)\b.*\bperson\b/i);
}
async function payer(ctx: JudgeContext, name: string) {
  const field = input(ctx, /\bpayer\b/i);
  if ((await field.evaluate((node) => node.tagName)) === 'SELECT')
    await field.selectOption({ label: name });
  else {
    await field.fill(name);
    const option = ctx.view.getByRole('option', { name, exact: true });
    if (await option.count()) await option.click();
  }
}
async function participants(ctx: JudgeContext, names: string[]) {
  const select = input(ctx, /\bparticipants\b/i);
  if (
    (await select.count()) &&
    (await select.first().evaluate((node) => node.tagName)) === 'SELECT'
  ) {
    await select.first().selectOption(names.map((label) => ({ label })));
    return;
  }
  for (const name of ['Zed', 'Ada', 'Cara']) {
    const checkbox = ctx.view.getByRole('checkbox', { name: caption(name) });
    if (await checkbox.count()) await checkbox.setChecked(names.includes(name));
    else {
      const toggle = ctx.view.getByRole('button', {
        name: caption(name),
        pressed: !names.includes(name),
      });
      if (await toggle.count()) await toggle.click();
    }
  }
}
async function save(ctx: JudgeContext) {
  const update = /\b(?:save|update)\b.*\bexpense\b/i;
  if (await ctx.view.getByRole('button', { name: update }).count()) await click(ctx, update);
  else await click(ctx, /\b(?:add|create)\b.*\bexpense\b/i);
}
async function expense(
  ctx: JudgeContext,
  description: string,
  paidBy: string,
  amount: string,
  selected: string[],
) {
  const fresh = ctx.view.getByRole('button', { name: /\bnew\b.*\bexpense\b/i });
  if (await fresh.count()) await fresh.first().click();
  if (!(await input(ctx, /\bdescription\b/i).isVisible()))
    await click(ctx, /\b(?:new|add|create)\b.*\bexpense\b/i);
  await input(ctx, /\bdescription\b/i).fill(description);
  await payer(ctx, paidBy);
  await input(ctx, /\bamount\b/i).fill(amount);
  await participants(ctx, selected);
  await save(ctx);
}
async function balances(ctx: JudgeContext) {
  const rows = [];
  for (const name of ['Zed', 'Ada', 'Cara']) {
    const amounts: Record<string, number> = {};
    for (const key of ['Paid', 'Owed', 'Net']) {
      const label = new RegExp(`(?=.*${caption(name).source})(?=.*${caption(key).source})`, 'i');
      const named = ctx.view.getByLabel(label);
      if (await named.count()) amounts[key] = cents(await fieldValue(named.first()));
      else {
        let found = false;
        for (const table of await ctx.view.getByRole('table').all()) {
          const headings = await table.getByRole('columnheader').allTextContents();
          const column = headings.findIndex((text) => caption(key).test(text));
          if (column < 0) continue;
          for (const row of await table.getByRole('row').all()) {
            const cells = row.getByRole('cell').or(row.getByRole('rowheader'));
            const texts = await cells.allTextContents();
            if (texts.some((text) => text.trim() === name)) {
              amounts[key] = cents(texts[column]!);
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (!found) throw new Error(`Missing accessible ${key} output for ${name}`);
      }
    }
    rows.push({ name, paid: amounts.Paid!, owed: amounts.Owed!, net: amounts.Net! });
  }
  return rows;
}
async function transfers(ctx: JudgeContext, totals: Awaited<ReturnType<typeof balances>>) {
  const remaining = new Map(totals.map((row) => [row.name, row.net]));
  const rows = [];
  for (const table of await ctx.view.getByRole('table').all()) {
    const headings = await table.getByRole('columnheader').allTextContents();
    const from = headings.findIndex((text) => /\b(?:from|payer|debtor)\b/i.test(text));
    const to = headings.findIndex((text) => /\b(?:to|receiver|creditor)\b/i.test(text));
    const amount = headings.findIndex((text) => /\bamount\b/i.test(text));
    if (from < 0 || to < 0 || amount < 0) continue;
    for (const row of await table.getByRole('row').all()) {
      const cells = await row.getByRole('cell').or(row.getByRole('rowheader')).allTextContents();
      if (cells.length !== headings.length) continue;
      const a = cells[from]!.trim();
      const b = cells[to]!.trim();
      const value = cents(cells[amount]!);
      if (!remaining.has(a) || !remaining.has(b)) continue;
      rows.push({ from: a, to: b, cents: value });
    }
  }
  // Named transfer regions also permit cards rather than table DOM.
  if (!rows.length)
    for (const region of await ctx.view.getByRole('region', { name: /\btransfer\b/i }).all()) {
      const a = (await region.getByLabel(/\b(?:from|payer|debtor)\b/i).textContent())?.trim();
      const b = (await region.getByLabel(/\b(?:to|receiver|creditor)\b/i).textContent())?.trim();
      if (a && b)
        rows.push({
          from: a,
          to: b,
          cents: cents(await region.getByLabel(/\bamount\b/i).innerText()),
        });
    }
  let valid = rows.length > 0;
  for (const row of rows) {
    const debtor = totals.find((item) => item.name === row.from);
    const creditor = totals.find((item) => item.name === row.to);
    valid &&= row.cents > 0 && (debtor?.net ?? 0) < 0 && (creditor?.net ?? 0) > 0;
    remaining.set(row.from, (remaining.get(row.from) ?? 0) + row.cents);
    remaining.set(row.to, (remaining.get(row.to) ?? 0) - row.cents);
  }
  return { valid: valid && [...remaining.values()].every((value) => value === 0), rows };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const judge: TaskJudge = async (ctx) => {
  const probes: JudgeProbe[] = [];
  try {
    for (const name of ['Zed', 'Ada', 'Cara']) await person(ctx, name);
    await expense(ctx, 'Train', 'Zed', '10.01', ['Ada', 'Cara']);
    await expense(ctx, 'Lunch', 'Ada', '1.00', ['Zed', 'Ada', 'Cara']);
    const expected = [
      { name: 'Zed', paid: 1001, owed: 34, net: 967 },
      { name: 'Ada', paid: 100, owed: 534, net: -434 },
      { name: 'Cara', paid: 0, owed: 533, net: -533 },
    ];
    const initial = await balances(ctx);
    probes.push({
      name: 'payer outside participants, integer cents and creation-order remainder',
      pass: same(initial, expected),
      evidence: initial,
    });
    const settlement = await transfers(ctx, initial);
    probes.push({
      name: 'any positive debtor-to-creditor transfers clear conserved nets',
      pass: initial.reduce((sum, row) => sum + row.net, 0) === 0 && settlement.valid,
      evidence: settlement,
    });
    await expense(ctx, 'Invalid', 'Zed', '1.005', ['Ada']);
    probes.push({
      name: 'excess precision rejected without total mutation',
      pass: same(initial, await balances(ctx)),
      evidence: await balances(ctx),
    });
    await expense(ctx, 'Empty participants', 'Zed', '1.00', []);
    probes.push({
      name: 'empty participants rejected without mutation',
      pass: same(initial, await balances(ctx)),
      evidence: await balances(ctx),
    });
    await click(ctx, /\bdelete\b.*\bperson\b.*\bZed\b/i);
    probes.push({
      name: 'referenced person deletion rejected',
      pass: same(initial, await balances(ctx)),
      evidence: await balances(ctx),
    });
    await ctx.view.goto(ctx.view.url());
    probes.push({
      name: 'people/expenses/remainder order persist',
      pass: same(initial, await balances(ctx)),
      evidence: await balances(ctx),
    });
    await click(ctx, /\bedit\b.*\bexpense\b.*\bLunch\b/i);
    await input(ctx, /\bamount\b/i).fill('2.00');
    await save(ctx);
    const changed = await balances(ctx);
    probes.push({
      name: 'expense edit recomputes paid/owed/net',
      pass: same(changed, [
        { name: 'Zed', paid: 1001, owed: 67, net: 934 },
        { name: 'Ada', paid: 200, owed: 568, net: -368 },
        { name: 'Cara', paid: 0, owed: 566, net: -566 },
      ]),
      evidence: changed,
    });
    await click(ctx, /\bdelete\b.*\bexpense\b.*\bLunch\b/i);
    const afterDelete = await balances(ctx);
    probes.push({
      name: 'expense deletion recomputes totals and transfers',
      pass:
        same(afterDelete, [
          { name: 'Zed', paid: 1001, owed: 0, net: 1001 },
          { name: 'Ada', paid: 0, owed: 501, net: -501 },
          { name: 'Cara', paid: 0, owed: 500, net: -500 },
        ]) && (await transfers(ctx, afterDelete)).valid,
      evidence: afterDelete,
    });
  } catch (error) {
    probes.push({ name: 'expense workflow completed', pass: false, evidence: String(error) });
  }
  return verdict(probes);
};
export default judge;
