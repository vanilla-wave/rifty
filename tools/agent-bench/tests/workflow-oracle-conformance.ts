import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { actionCaption, namedActions } from '../src/judge/context.ts';
import type { JudgeContext } from '../src/judge/context.ts';

const root = await mkdtemp(join(tmpdir(), 'rifty-workflow-oracle-conformance-'));
for (const name of ['booking', 'expense']) {
  const source = await readFile(`tools/agent-bench/tests/workflow-oracles/${name}.ts`, 'utf8');
  await writeFile(
    join(root, `${name}.ts`),
    `${source.replaceAll('../../src/judge/context.ts', resolve('tools/agent-bench/src/judge/context.ts'))}\nexport { ${name === 'booking' ? 'saveRoom, saveBooking, edits' : 'save, balances, transfers'} };\n`,
  );
}
const booking = (await import(pathToFileURL(join(root, 'booking.ts')).href)) as {
  judge: unknown;
  saveRoom: (ctx: JudgeContext) => Promise<void>;
  saveBooking: (ctx: JudgeContext) => Promise<void>;
  edits: (ctx: JudgeContext) => ReturnType<typeof namedActions>;
};
const expense = (await import(pathToFileURL(join(root, 'expense.ts')).href)) as {
  judge: unknown;
  save: (ctx: JudgeContext) => Promise<void>;
  balances: (ctx: JudgeContext) => Promise<unknown>;
  transfers: (
    ctx: JudgeContext,
    rows: { name: string; paid: number; owed: number; net: number }[],
  ) => Promise<{ valid: boolean }>;
};
assert.equal(typeof booking.judge, 'function');
assert.equal(typeof expense.judge, 'function');
const browser = await chromium.launch();
const evidence = [];
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(1000);
  for (const tag of ['button', 'a']) {
    for (const [subject, save] of [
      ['room', booking.saveRoom],
      ['booking', booking.saveBooking],
      ['expense', expense.save],
    ] as const) {
      for (const text of [
        `Add ${subject}`,
        `${subject} add`,
        `${subject} save`,
        `Save ${subject}`,
      ]) {
        await page.setContent(
          `<${tag} href="#" onclick="event.preventDefault();this.dataset.clicked='yes'">${text}</${tag}>`,
        );
        await save({ view: page, previewUrl: 'about:blank' });
        assert.equal(await page.locator(tag).getAttribute('data-clicked'), 'yes');
        evidence.push({ kind: 'named save action', tag, text, accepted: true });
      }
    }
    for (const verb of ['new', 'edit', 'delete']) {
      for (const subject of ['room', 'booking', 'expense', 'person']) {
        await page.setContent(`<${tag} href="#">Amber ${subject} ${verb}</${tag}>`);
        const ctx = { view: page, previewUrl: 'about:blank' };
        assert.equal(await namedActions(ctx, actionCaption(verb, subject, 'Amber')).count(), 1);
        if (verb === 'edit' && subject === 'booking')
          assert.equal(await booking.edits(ctx).count(), 1);
      }
    }
  }
  for (const subject of ['person', 'expense', 'reservation', 'booking']) {
    for (const verb of ['add', 'save', 'edit', 'delete']) {
      for (const text of [`${verb} ${subject} Amber`, `Amber ${subject} ${verb}`]) {
        await page.setContent(`<button>${text}</button>`);
        assert.equal(
          await page.getByRole('button', { name: actionCaption(verb, subject, 'Amber') }).count(),
          1,
        );
      }
    }
  }
  const totals = [
    { name: 'Zed', paid: 1001, owed: 34, net: 967 },
    { name: 'Ada', paid: 100, owed: 534, net: -434 },
    { name: 'Cara', paid: 0, owed: 533, net: -533 },
  ];
  for (const tag of ['section', 'article', 'div']) {
    for (const name of ['Transfer', 'Payment', 'Settlement']) {
      await page.setContent(
        `<${tag} aria-label="${name} Ada to Zed"><span aria-label="Payer">Ada</span><span aria-label="Receiver">Zed</span><span aria-label="Amount">4.34</span></${tag}><${tag} aria-label="${name} Cara to Zed"><span aria-label="Payer">Cara</span><span aria-label="Receiver">Zed</span><span aria-label="Amount">5.33</span></${tag}>`,
      );
      const result = await expense.transfers({ view: page, previewUrl: 'about:blank' }, totals);
      assert.equal(result.valid, true, `${tag}/${name}`);
      evidence.push({ kind: 'named clearing payment', tag, name, result });
    }
  }
  const paymentMarkup = (layout: string, hiding: string) => {
    const value = (text: string) => `<span ${hiding}>${text}</span>`;
    if (layout === 'table')
      return `<table><thead><tr><th>Payer</th><th>Receiver</th><th>Amount</th></tr></thead><tbody>${[
        ['Ada', '4.34'],
        ['Cara', '5.33'],
      ]
        .map(
          ([from, amount]) =>
            `<tr><td>${from}</td><td>${value('Zed')}</td><td>${value(amount!)}</td></tr>`,
        )
        .join('')}</tbody></table>`;
    return [
      ['Ada', '4.34'],
      ['Cara', '5.33'],
    ]
      .map(
        ([from, amount]) =>
          `<section><span aria-label="Payer">${from}</span><span aria-label="Receiver">${value('Zed')}</span><span aria-label="Amount">${value(amount!)}</span></section>`,
      )
      .join('');
  };
  for (const layout of ['cards', 'table']) {
    for (const hiding of ['', 'hidden', 'style="display:none"', 'style="visibility:hidden"']) {
      await page.setContent(paymentMarkup(layout, hiding));
      let accepted = false;
      let error: string | undefined;
      try {
        accepted = (await expense.transfers({ view: page, previewUrl: 'about:blank' }, totals))
          .valid;
      } catch (failure) {
        error = String(failure);
      }
      assert.equal(accepted, !hiding, `${layout}/${hiding}`);
      evidence.push({
        kind: 'rendered payment',
        layout,
        hiding,
        accepted,
        error,
        visible: await page.locator('body').innerText(),
      });
    }
  }
  for (const layout of ['named', 'table']) {
    for (const hiding of ['', 'hidden', 'style="display:none"', 'style="visibility:hidden"']) {
      const output = totals
        .map((row) => {
          const values = [
            ['Paid', row.paid],
            ['Owed', row.owed],
            ['Net', row.net],
          ] as const;
          return layout === 'named'
            ? values
                .map(
                  ([key, amount]) =>
                    `<span aria-label="${row.name} ${key}"><span ${hiding}>${(amount / 100).toFixed(2)}</span></span>`,
                )
                .join('')
            : `<tr><td>${row.name}</td>${values.map(([, amount]) => `<td><span ${hiding}>${(amount / 100).toFixed(2)}</span></td>`).join('')}</tr>`;
        })
        .join('');
      await page.setContent(
        layout === 'named'
          ? output
          : `<table><thead><tr><th>Person</th><th>Paid</th><th>Owed</th><th>Net</th></tr></thead><tbody>${output}</tbody></table>`,
      );
      let result: unknown;
      let error: string | undefined;
      try {
        result = await expense.balances({ view: page, previewUrl: 'about:blank' });
      } catch (failure) {
        error = String(failure);
      }
      assert.equal(
        JSON.stringify(result) === JSON.stringify(totals),
        !hiding,
        `${layout}/${hiding}`,
      );
      evidence.push({
        kind: 'rendered balances',
        layout,
        hiding,
        result,
        error,
        visible: await page.locator('body').innerText(),
      });
    }
  }
  for (const [a, b] of [
    ['4.345', '5.335'],
    ['4.35', '5.33'],
    ['0.00', '5.33'],
  ]) {
    await page.setContent(
      `<section aria-label="Payment Ada to Zed"><span aria-label="Payer">Ada</span><span aria-label="Receiver">Zed</span><span aria-label="Amount">${a}</span></section><section aria-label="Payment Cara to Zed"><span aria-label="Payer">Cara</span><span aria-label="Receiver">Zed</span><span aria-label="Amount">${b}</span></section>`,
    );
    let accepted = false;
    let error: string | undefined;
    try {
      accepted = (await expense.transfers({ view: page, previewUrl: 'about:blank' }, totals)).valid;
    } catch (failure) {
      error = String(failure);
    }
    assert.equal(accepted, false, `${a}/${b}`);
    evidence.push({ kind: 'invalid payment', a, b, accepted, error });
  }
} finally {
  await browser.close();
  await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
console.log(`WORKFLOW_ORACLE_CONFORMANCE ${root}`);
