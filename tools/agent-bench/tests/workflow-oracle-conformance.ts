import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { actionCaption } from '../src/judge/context.ts';
import type { JudgeContext } from '../src/judge/context.ts';

const root = await mkdtemp(join(tmpdir(), 'rifty-workflow-oracle-conformance-'));
for (const name of ['booking', 'expense']) {
  const source = await readFile(`tools/agent-bench/tests/workflow-oracles/${name}.ts`, 'utf8');
  await writeFile(
    join(root, `${name}.ts`),
    `${source.replaceAll('../../src/judge/context.ts', resolve('tools/agent-bench/src/judge/context.ts'))}\nexport { ${name === 'booking' ? 'saveRoom' : 'transfers'} };\n`,
  );
}
const booking = (await import(pathToFileURL(join(root, 'booking.ts')).href)) as {
  judge: unknown;
  saveRoom: (ctx: JudgeContext) => Promise<void>;
};
const expense = (await import(pathToFileURL(join(root, 'expense.ts')).href)) as {
  judge: unknown;
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
  for (const text of ['Add room', 'Room add', 'Room capacity save', 'Save room capacity']) {
    await page.setContent(`<button onclick="this.dataset.clicked='yes'">${text}</button>`);
    await booking.saveRoom({ view: page, previewUrl: 'about:blank' });
    assert.equal(await page.getByRole('button').getAttribute('data-clicked'), 'yes');
    evidence.push({ kind: 'named room action', text, accepted: true });
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
