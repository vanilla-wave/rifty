import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { loadCorpus } from '../src/corpus.ts';
import { writeTree } from '../src/files.ts';
import {
  freePort,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from '../src/proc.ts';

// Native projects/ports/contexts independent; no shared Rifty/Vite-WASI host.
test.describe.configure({ mode: 'parallel' });

const labelled =
  '<article><span aria-label="Payer">{row.from}</span> → <span aria-label="Receiver">{row.to}</span>: <span aria-label="Amount">{money(row.cents)}</span></article>';
const card =
  '<div><div><strong>{row.from}</strong><span> pays <strong>{row.to}</strong></span></div><strong>${money(row.cents)}</strong></div>';
const named = labelled.replace(' → ', ' ').replace(': ', ' ');
const modes = [
  ['labelled', labelled, true],
  ['named-only', named, true],
  ['plain-card', card, true],
  [
    'hidden-edit-control',
    card.replace('<div><div>', '<div><input hidden value="editing"><div>'),
    true,
  ],
  ['mixed-named-card', `{#if row.from === 'Ada'}${named}{:else}${card}{/if}`, true],
  [
    'mixed-table-card',
    `{#if row.from === 'Ada'}<table><tbody><tr><th>Payer</th><th>Receiver</th><th>Amount</th></tr><tr><td>{row.from}</td><td>{row.to}</td><td>{money(row.cents)}</td></tr></tbody></table>{:else}${card}{/if}`,
    true,
  ],
  ['mixed-extra-card', named + card, false],
  [
    'arrow-list',
    '<li><b>{row.from}</b> → <b>{row.to}</b><span>${money(row.cents)}</span></li>',
    true,
  ],
  [
    'reverse',
    card
      .replace('{row.from}', '{row.to}')
      .replace('pays <strong>{row.to}', 'pays <strong>{row.from}'),
    false,
  ],
  ['extra-cent', card.replace('money(row.cents)', 'money(row.cents + 1n)'), false],
  [
    'editable-select',
    card.replace(
      '<strong>${money(row.cents)}</strong>',
      '<select><option>${money(row.cents)}</option></select>',
    ),
    false,
  ],
  [
    'editable-content',
    card.replace(
      '<strong>${money(row.cents)}</strong>',
      '<strong contenteditable>${money(row.cents)}</strong>',
    ),
    false,
  ],
  ['unknown-receiver', card.replace('{row.to}', 'Ghost'), false],
  ['duplicate', card + card, false],
  ['hidden', `<div hidden>${card}</div>`, false],
  [
    'hidden-receiver',
    card.replace('<strong>{row.to}</strong>', '<strong hidden>{row.to}</strong>'),
    false,
  ],
  [
    'hidden-amount',
    card.replace(
      '<strong>${money(row.cents)}</strong>',
      '<strong hidden>${money(row.cents)}</strong>',
    ),
    false,
  ],
  [
    'invisible-receiver',
    card.replace(
      '<strong>{row.to}</strong>',
      '<strong style="visibility:hidden">{row.to}</strong>',
    ),
    false,
  ],
  ['missing', '', false],
] as const;

for (const [mode, renderer, pass] of modes) {
  test(`ordinary expense transfer ${mode} retains semantic acceptance`, async ({ browser }) => {
    const task = (await loadCorpus('eval-v17')).find(
      (entry) => entry.id === 'expense-settlement-v11',
    )!;
    const source = task.controls!.reference!['src/App.svelte']!;
    expect(source.split(labelled)).toHaveLength(2);
    const directory = await mkdtemp(join(tmpdir(), 'rifty-transfer-cards-'));
    await writeTree(directory, {
      ...task.files,
      ...task.controls!.reference!,
      'src/App.svelte': source.replace(labelled, renderer),
    });
    await runOrThrow('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: directory,
      env: { ...process.env, NODE_PATH: undefined },
      timeoutMs: 300000,
    });
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    const server = spawnLoggedServer(
      join(directory, 'node_modules/.bin/vite'),
      ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      {
        cwd: directory,
        env: { ...process.env, NODE_PATH: undefined },
        logPath: join(directory, 'server.log'),
        detached: true,
      },
    );
    const context = await browser.newContext();
    try {
      await waitHttpReady(url, 30000, mode);
      const page = await context.newPage();
      await page.goto(url);
      const result = await task.judge!({ view: page, previewUrl: url });
      await writeFile(join(directory, 'judge.json'), JSON.stringify(result, null, 2));
      expect(result.pass, JSON.stringify(result)).toBe(pass);
      const transferNames = [
        'any positive debtor-to-creditor transfers clear conserved nets',
        'expense deletion recomputes totals and transfers',
      ];
      expect(result.probes.filter((probe) => !probe.pass).map((probe) => probe.name)).toEqual(
        pass ? [] : transferNames,
      );
    } finally {
      try {
        await context.close();
      } finally {
        await killProcessGroup(server);
      }
    }
  });
}
