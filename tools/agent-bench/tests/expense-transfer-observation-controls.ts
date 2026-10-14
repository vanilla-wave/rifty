import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import type { JudgeContext } from '../src/judge/context.ts';

const root = resolve('tools/agent-bench');
const path = join(root, 'corpus/cases/expense-settlement-v11/judge.ts');
const source = await readFile(path, 'utf8');
const directory = await mkdtemp(join(tmpdir(), 'rifty-transfer-observation-'));
const totals = [
  { name: 'Zed', paid: 1001, owed: 34, net: 967 },
  { name: 'Ada', paid: 100, owed: 534, net: -434 },
  { name: 'Cara', paid: 0, owed: 533, net: -533 },
];
const card = (name: string, amount: string) =>
  `<div><strong>${name}</strong> pays <strong>Zed</strong><strong>$${amount}</strong></div>`;
const named = (name: string, amount: string) =>
  `<article><span aria-label="Payer">${name}</span><span aria-label="Receiver">Zed</span><span aria-label="Amount">$${amount}</span></article>`;
const table = (extra = '') =>
  `<table><tr><th>Payer</th><th>Receiver</th><th>Amount</th></tr><tr><td>Ada</td><td>Zed</td><td>4.34</td></tr><tr><td>Cara</td><td>Zed</td><td>5.33</td></tr>${extra}</table>`;
const ordinary = card('Ada', '4.34') + card('Cara', '5.33');
const cases = [
  ['plain', ordinary, true],
  ['split-settlement', card('Ada', '2.17') + card('Ada', '2.17') + card('Cara', '5.33'), true],
  ['nested', `<div>${card('Ada', '4.34')}</div><div>${card('Cara', '5.33')}</div>`, true],
  ['named', named('Ada', '4.34') + named('Cara', '5.33'), true],
  ['table', table(), true],
  ['mixed', named('Ada', '4.34') + card('Cara', '5.33'), true],
  [
    'mixed-table',
    table().replace('<tr><td>Cara</td><td>Zed</td><td>5.33</td></tr>', '') + card('Cara', '5.33'),
    true,
  ],
  ['extra', named('Ada', '4.34') + named('Cara', '5.33') + card('Ada', '4.34'), false],
  ['duplicate', ordinary + ordinary, false],
  [
    'hidden-receiver',
    ordinary.replaceAll('<strong>Zed</strong>', '<strong hidden>Zed</strong>'),
    false,
  ],
  ['hidden-edit', ordinary.replaceAll('<div>', '<div><input hidden value="edit">'), true],
  [
    'editable',
    ordinary.replace(/<strong>\$(.*?)<\/strong>/g, '<select><option>$$$1</option></select>'),
    false,
  ],
  ['unknown-table', table('<tr><td>Ghost</td><td>Zed</td><td>1.00</td></tr>'), false],
  ['precision', card('Ada', '4.340') + card('Cara', '5.33'), false],
] as const;
function replace(text: string, before: string, after: string) {
  assert.equal(text.split(before).length, 2, `Guard seam: ${before}`);
  return text.replace(before, after);
}
function replaceTransfer(text: string, before: string, after: string) {
  const start = text.indexOf('async function transfers(');
  assert.ok(start >= 0);
  return text.slice(0, start) + replace(text.slice(start), before, after);
}
const variants = [
  ['current', source],
  [
    'semantic-dedup',
    replace(
      source,
      'const cards = await transferCards(ctx);',
      'const cards = (await transferCards(ctx)).filter((row, index, all) => all.findIndex((peer) => peer.from === row.from && peer.to === row.to && peer.amount === row.amount) === index);',
    ),
  ],
  [
    'exclusive-forms',
    replaceTransfer(
      replaceTransfer(
        source,
        "for (const table of await ctx.view.getByRole('table').all()) {",
        "for (const table of await ctx.view.getByRole('table').all()) { if (cards.length) continue;",
      ),
      'for (const from of await ctx.view.getByLabel(/\\b(?:from|payer|debtor)\\b/i).all()) {',
      'for (const from of await ctx.view.getByLabel(/\\b(?:from|payer|debtor)\\b/i).all()) { if (cards.length) continue;',
    ),
  ],
  [
    'no-cards',
    replace(
      source,
      'const cards = await transferCards(ctx);',
      'const cards: Awaited<ReturnType<typeof transferCards>> = [];',
    ),
  ],
  ['hidden-text', replace(source, 'node.innerText.replace', 'node.textContent!.replace')],
  [
    'editable-amount',
    replace(
      source,
      "[...node.querySelectorAll<HTMLElement>(':read-write, select')].some(",
      "false && [...node.querySelectorAll<HTMLElement>(':read-write, select')].some(",
    ),
  ],
  [
    'ancestor-rows',
    replace(
      source,
      '.filter((row) => !candidates.some((child) => child !== row && row.node.contains(child.node)))',
      '.filter(() => true)',
    ),
  ],
  [
    'skip-unknown-table',
    replace(
      source,
      'rows.push({ from: a, to: b, cents: value });',
      'if (!remaining.has(a) || !remaining.has(b)) continue;\n      rows.push({ from: a, to: b, cents: value });',
    ),
  ],
] as const;
const browser = await chromium.launch();
const results = [];
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(1000);
  for (const [variant, text] of variants) {
    // Export actual private owner for this test only; no production interface or sibling substitute.
    const file = join(directory, `${variant}.ts`);
    await writeFile(
      file,
      `${text.replaceAll("'../../../src/", `'${root}/src/`)}\nexport { transfers };\n`,
    );
    const { transfers } = (await import(pathToFileURL(file).href)) as {
      transfers: (
        ctx: JudgeContext,
        rows: typeof totals,
      ) => Promise<{ valid: boolean; rows: unknown[] }>;
    };
    const observations = [];
    for (const [name, html, expected] of cases) {
      await page.setContent(html);
      let actual = false;
      let error: string | null = null;
      try {
        actual = (await transfers({ view: page, previewUrl: 'about:blank' }, totals)).valid;
      } catch (caught) {
        error = String(caught);
      }
      observations.push({ name, expected, actual, error });
    }
    const mismatches = observations.filter((row) => row.actual !== row.expected);
    if (variant === 'current') assert.equal(mismatches.length, 0, JSON.stringify(observations));
    else assert.ok(mismatches.length > 0, `Surviving guard reversion: ${variant}`);
    results.push({
      variant,
      observations,
      discriminated: variant === 'current' || mismatches.length > 0,
    });
  }
} finally {
  try {
    await browser.close();
  } finally {
    await writeFile(
      join(directory, 'proof.json'),
      JSON.stringify(
        { sourceSha256: createHash('sha256').update(source).digest('hex'), results },
        null,
        2,
      ),
    );
  }
}
console.log(
  JSON.stringify({ directory, currentCases: cases.length, revertedGuards: variants.length - 1 }),
);
