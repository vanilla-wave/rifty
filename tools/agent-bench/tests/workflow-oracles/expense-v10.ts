import {
  caption,
  choiceOption,
  controlsForAction,
  editableControl,
  editableControlForAction,
  fieldValue,
  renderedValue,
  selectChoices,
  verdict,
  workflowAction,
  workflowActions,
} from '../../src/judge/context.ts';
import type { JudgeContext, JudgeProbe, TaskJudge } from '../../src/judge/context.ts';
import {
  type ExpenseRecordControls,
  editExpenseRecord,
  expenseRecords,
} from '../../src/judge/expense-records.ts';
import { fillNativeInput } from '../../src/judge/native-input.ts';
import { recordCandidates } from '../../src/judge/record-candidates.ts';
import { recordObservationError } from '../../src/judge/record-observation.ts';

async function click(ctx: JudgeContext, verbs: string, subjects: string, identity?: string) {
  if (verbs === 'edit' && subjects === 'expense' && identity) {
    await editExpenseRecord(ctx, identity, recordControls(ctx));
    return;
  }
  if (verbs === 'delete' && subjects === 'expense' && identity) {
    const records = await expenseRecords(ctx, recordControls(ctx));
    if (records.filter((record) => record.description === identity).length !== 1)
      throw new Error('Missing/ambiguous confirmed expense deletion target');
    const matches = await recordCandidates(
      ctx,
      verbs,
      subjects,
      identity,
      records
        .filter((record) => record.description !== identity)
        .map((record) => record.description),
    );
    if (!(await matches.count())) throw new Error('Missing bound expense deletion');
    await matches.first().click();
    await ctx.view.goto(ctx.view.url());
    return;
  }
  const matches = await workflowActions(ctx, verbs, subjects, identity);
  for (const node of await matches.all())
    if (await node.isVisible()) {
      await node.click();
      return;
    }
  throw new Error(`Missing named action ${verbs}/${subjects}/${identity}`);
}
async function input(ctx: JudgeContext, name: RegExp, creation = false) {
  const person = /person/.test(name.source);
  return editableControlForAction(
    ctx,
    name,
    await workflowAction(
      ctx,
      person ? 'person' : 'expense',
      person || creation,
      editableControl(ctx, name),
    ),
  );
}
function cents(text: string) {
  const normalized = text.trim().replaceAll('−', '-');
  const tokens = normalized.match(/[+-]?\d[\d.,]*/g);
  if (tokens?.length !== 1) throw new Error(`Ambiguous/missing amount: ${text}`);
  const value = tokens[0]!;
  const unsigned = value.replace(/^[+-]/, '');
  const separator = Math.max(unsigned.lastIndexOf('.'), unsigned.lastIndexOf(','));
  let whole = unsigned;
  let fraction = '';
  if (separator >= 0) {
    fraction = unsigned.slice(separator + 1);
    if (!/^\d{1,2}$/.test(fraction)) throw new Error(`Non-cent precision: ${text}`);
    whole = unsigned.slice(0, separator).replaceAll(',', '').replaceAll('.', '');
  }
  if (!/^\d+$/.test(whole)) throw new Error(`Invalid amount: ${text}`);
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error(`Unsafe cent amount: ${text}`);
  const signs = normalized.match(/[+-]/g) ?? [];
  if (signs.length > 1) throw new Error(`Ambiguous amount sign: ${text}`);
  return result * (signs[0] === '-' || /^\s*\(/.test(normalized) ? -1 : 1);
}

async function person(ctx: JudgeContext, name: string) {
  if (
    !(
      await Promise.all(
        (
          await editableControl(ctx, /(?=.*\bperson\b)(?=.*\bname\b)/i).all()
        ).map((node) => node.isVisible()),
      )
    ).some(Boolean)
  )
    await click(ctx, 'new|add|create', 'person');
  await (await input(ctx, /(?=.*\bperson\b)(?=.*\bname\b)/i)).fill(name);
  await click(ctx, 'add|create|save', 'person');
}
async function payer(ctx: JudgeContext, name: string) {
  const field = await input(ctx, /\bpayer\b/i, true);
  if ((await field.evaluate((node) => node.tagName)) === 'SELECT')
    await selectChoices(field, [name]);
  else {
    await field.fill(name);
    if (await ctx.view.getByRole('option').count())
      await (await choiceOption(ctx.view, name)).click();
  }
}
export async function participants(ctx: JudgeContext, names: string[]) {
  const selects = editableControl(ctx, /\bparticipants\b/i);
  const identities = /\b(?:Zed|Ada|Cara)\b/i;
  const checkboxes = ctx.view.getByRole('checkbox', { name: identities });
  const toggles = ctx.view
    .getByRole('button', { name: identities })
    .and(
      ctx.view
        .getByRole('button', { pressed: true })
        .or(ctx.view.getByRole('button', { pressed: false })),
    );
  const candidates = selects.or(checkboxes).or(toggles);
  if (!(await candidates.count())) return;
  const groups = ['Zed', 'Ada', 'Cara'].map((name) =>
    selects
      .or(checkboxes.and(ctx.view.getByRole('checkbox', { name: caption(name) })))
      .or(toggles.and(ctx.view.getByRole('button', { name: caption(name) }))),
  );
  let purpose = editableControl(ctx, /\bdescription\b/i);
  if (!(await purpose.count())) {
    // Participant purposes anchor selection when descriptive fields are not visible.
    for (const group of groups)
      if (await group.count()) {
        purpose = group;
        if ((await group.count()) > 1) break;
      }
  }
  const action = await workflowAction(ctx, 'expense', true, purpose);
  const owned = await controlsForAction(candidates, action, groups);
  const select = owned.and(selects);
  if ((await select.count()) && (await select.evaluate((node) => node.tagName)) === 'SELECT') {
    await selectChoices(select, names);
    return;
  }
  for (const name of ['Zed', 'Ada', 'Cara']) {
    const checkbox = owned.and(ctx.view.getByRole('checkbox', { name: caption(name) }));
    if (await checkbox.count()) await checkbox.setChecked(names.includes(name));
    else {
      const toggle = owned.and(
        ctx.view.getByRole('button', { name: caption(name), pressed: !names.includes(name) }),
      );
      if (await toggle.count()) await toggle.click();
    }
  }
}
async function save(ctx: JudgeContext, creation = false) {
  if (creation) {
    await (
      await workflowAction(ctx, 'expense', true, editableControl(ctx, /\bdescription\b/i))
    ).click();
    return;
  }
  const update = await workflowActions(ctx, 'save|update', 'expense');
  if (await update.count()) await update.first().click();
  else await click(ctx, 'add|create', 'expense');
}
async function expense(
  ctx: JudgeContext,
  description: string,
  paidBy: string,
  amount: string,
  selected: string[],
) {
  const fresh = await workflowActions(ctx, 'new', 'expense');
  if (await fresh.count()) await fresh.first().click();
  if (
    !(
      await Promise.all(
        (await editableControl(ctx, /\bdescription\b/i).all()).map((node) => node.isVisible()),
      )
    ).some(Boolean)
  )
    await click(ctx, 'new|add|create', 'expense');
  await (await input(ctx, /\bdescription\b/i, true)).fill(description);
  await payer(ctx, paidBy);
  await fillNativeInput(await input(ctx, /\bamount\b/i, true), amount);
  await participants(ctx, selected);
  await save(ctx, true);
}
function recordControls(ctx: JudgeContext): ExpenseRecordControls {
  return {
    load: async (action) => {
      await action.click();
      return {
        description: await fieldValue(await input(ctx, /\bdescription\b/i)),
        amount: await fieldValue(await input(ctx, /\bamount\b/i)),
      };
    },
    write: async (value) => {
      await (await input(ctx, /\bdescription\b/i)).fill(value.description);
      await fillNativeInput(await input(ctx, /\bamount\b/i), value.amount);
    },
    save: () => save(ctx),
    paid: async () => (await balances(ctx)).reduce((sum, person) => sum + person.paid, 0),
  };
}

async function balances(ctx: JudgeContext) {
  const rows = [];
  for (const name of ['Zed', 'Ada', 'Cara']) {
    const amounts: Record<string, number> = {};
    for (const key of ['Paid', 'Owed', 'Net']) {
      const label = new RegExp(`(?=.*${caption(name).source})(?=.*${caption(key).source})`, 'i');
      const named = ctx.view.getByLabel(label);
      if (await named.count()) amounts[key] = cents(await renderedValue(named.first()));
      else {
        let found = false;
        for (const table of await ctx.view.getByRole('table').all()) {
          const headings = await Promise.all(
            (await table.getByRole('columnheader').all()).map(renderedValue),
          );
          const column = headings.findIndex((text) => caption(key).test(text));
          if (column < 0) continue;
          for (const row of await table.getByRole('row').all()) {
            const cells = row.getByRole('cell').or(row.getByRole('rowheader'));
            const texts = await Promise.all((await cells.all()).map(renderedValue));
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
    const headings = await Promise.all(
      (await table.getByRole('columnheader').all()).map(renderedValue),
    );
    const from = headings.findIndex((text) => /\b(?:from|payer|debtor)\b/i.test(text));
    const to = headings.findIndex((text) => /\b(?:to|receiver|creditor)\b/i.test(text));
    const amount = headings.findIndex((text) => /\bamount\b/i.test(text));
    if (from < 0 || to < 0 || amount < 0) continue;
    for (const row of await table.getByRole('row').all()) {
      const cells = await Promise.all(
        (await row.getByRole('cell').or(row.getByRole('rowheader')).all()).map(renderedValue),
      );
      if (cells.length !== headings.length) continue;
      const a = cells[from]!.trim();
      const b = cells[to]!.trim();
      const value = cents(cells[amount]!);
      if (!remaining.has(a) || !remaining.has(b)) continue;
      rows.push({ from: a, to: b, cents: value });
    }
  }
  // Related named outputs permit cards/groups without prescribing a region caption.
  if (!rows.length) {
    for (const from of await ctx.view.getByLabel(/\b(?:from|payer|debtor)\b/i).all()) {
      if (
        !(await from.isVisible()) ||
        (await from.evaluate(
          (node) => node.matches(':read-write') || node instanceof HTMLSelectElement,
        ))
      )
        continue;
      let container = from.locator('..');
      while (await container.count()) {
        const target = container.getByLabel(/\b(?:to|receiver|creditor)\b/i);
        const amount = container.getByLabel(/\bamount\b/i);
        if ((await target.count()) === 1 && (await amount.count()) === 1) {
          rows.push({
            from: (await renderedValue(from)).trim(),
            to: (await renderedValue(target)).trim(),
            cents: cents(await renderedValue(amount)),
          });
          break;
        }
        if ((await container.evaluate((node) => node.tagName)) === 'HTML') break;
        container = container.locator('..');
      }
    }
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
export const judge: TaskJudge = async (ctx) => {
  const probes: JudgeProbe[] = [];
  try {
    for (const name of [' Zed ', 'Ada', 'Cara']) await person(ctx, name);
    for (const name of ['zed', '']) {
      await person(ctx, name);
      const count = await (await workflowActions(ctx, 'delete', 'person')).count();
      probes.push({
        name: `duplicate/empty person rejected: ${name}`,
        pass: count === 3,
        evidence: count,
      });
    }
    await person(ctx, 'Unused');
    await click(ctx, 'delete', 'person', 'Unused');
    probes.push({
      name: 'unreferenced person deletion',
      pass: (await (await workflowActions(ctx, 'delete', 'person', 'Unused')).count()) === 0,
      evidence: await ctx.view.locator('body').innerText(),
    });
    await expense(ctx, ' Train ', 'Zed', '10.01', ['Ada', 'Cara']);
    await expense(ctx, 'Lunch', 'Ada', '1.00', ['Zed', 'Ada', 'Cara']);
    const expected = [
      { name: 'Zed', paid: 1001, owed: 34, net: 967 },
      { name: 'Ada', paid: 100, owed: 534, net: -434 },
      { name: 'Cara', paid: 0, owed: 533, net: -533 },
    ];
    await click(ctx, 'edit', 'expense', 'Train');
    probes.push({
      name: 'expense description trimmed',
      pass: (await fieldValue(await input(ctx, /\bdescription\b/i))) === 'Train',
      evidence: await fieldValue(await input(ctx, /\bdescription\b/i)),
    });
    await save(ctx);
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
    for (const value of ['', '0.00', '-1.00', '1e2', 'abc', '90071992547409.92']) {
      await expense(ctx, 'Invalid amount', 'Zed', value, ['Ada']);
      const after = await balances(ctx);
      probes.push({
        name: `invalid amount preserves totals: ${value}`,
        pass: same(initial, after) && (await expenseRecords(ctx, recordControls(ctx))).length === 2,
        evidence: after,
      });
    }
    await expense(ctx, '   ', 'Zed', '1.00', ['Ada']);
    probes.push({
      name: 'empty description rejected',
      pass: same(initial, await balances(ctx)),
      evidence: await balances(ctx),
    });
    await expense(ctx, 'Empty participants', 'Zed', '1.00', []);
    probes.push({
      name: 'empty participants rejected without mutation',
      pass: same(initial, await balances(ctx)),
      evidence: await balances(ctx),
    });
    await click(ctx, 'delete', 'person', 'Zed');
    probes.push({
      name: 'referenced person deletion rejected',
      pass: same(initial, await balances(ctx)),
      evidence: await balances(ctx),
    });
    await click(ctx, 'delete', 'person', 'Cara');
    probes.push({
      name: 'participant-only reference prevents person deletion',
      pass:
        same(initial, await balances(ctx)) &&
        (await (await workflowActions(ctx, 'delete', 'person', 'Cara')).count()) === 1,
      evidence: await balances(ctx),
    });
    await click(ctx, 'edit', 'expense', 'Lunch');
    await fillNativeInput(await input(ctx, /\bamount\b/i), '1.005');
    await save(ctx);
    probes.push({
      name: 'invalid expense edit preserves prior expense/totals',
      pass: same(initial, await balances(ctx)),
      evidence: await balances(ctx),
    });
    await ctx.view.goto(ctx.view.url());
    probes.push({
      name: 'people/expenses/remainder order persist',
      pass: same(initial, await balances(ctx)),
      evidence: await balances(ctx),
    });
    await click(ctx, 'edit', 'expense', 'Lunch');
    await fillNativeInput(await input(ctx, /\bamount\b/i), '2.00');
    await save(ctx);
    await ctx.view.goto(ctx.view.url());
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
    await click(ctx, 'delete', 'expense', 'Lunch');
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
    await click(ctx, 'delete', 'person', 'Zed');
    await ctx.view.goto(ctx.view.url());
    probes.push({
      name: 'payer-only reference prevents person deletion',
      pass:
        same(afterDelete, await balances(ctx)) &&
        (await (await workflowActions(ctx, 'delete', 'person', 'Zed')).count()) === 1,
      evidence: await balances(ctx),
    });
  } catch (error) {
    probes.push({
      name: 'expense workflow completed',
      pass: false,
      evidence: recordObservationError(error),
    });
  }
  return verdict(probes);
};
export default judge;
