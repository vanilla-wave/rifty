import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loadCorpus } from '../src/corpus.ts';
import { writeTree } from '../src/files.ts';
import {
  choiceOption,
  editableControl,
  editableControlForAction,
  fieldValue,
  optionLabel,
  workflowAction,
} from '../src/judge/context.ts';
import { expenseRecords } from '../src/judge/expense-records.ts';
import { roomRecords } from '../src/judge/room-records.ts';
import {
  freePort,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from '../src/proc.ts';

const parent = resolve('.cache/pr341');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'record-adapters-'));
const corpus = await loadCorpus('eval-v14');
const browser = await chromium.launch();
const evidence: unknown[] = [];
function replace(source: string, before: string, after: string) {
  assert.ok(source.includes(before), `Missing native fixture seam: ${before}`);
  return source.replace(before, after);
}
async function fixture(
  family: string,
  transform: (source: string) => string,
  probe: (page: Page, url: string) => Promise<unknown>,
  suffix = '',
) {
  const task = corpus.find((entry) => entry.family === family)!;
  const app = family === 'expense-conservation' ? 'src/App.svelte' : 'src/App.vue';
  const directory = join(root, `${family}${suffix}`);
  await writeTree(directory, {
    ...task.files,
    ...task.controls!.reference!,
    [app]: transform(task.controls!.reference![app]!),
  });
  await runOrThrow('npm', ['ci', '--no-audit', '--no-fund'], { cwd: directory, timeoutMs: 300000 });
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const server = spawnLoggedServer(
    join(directory, 'node_modules/.bin/vite'),
    ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: directory, env: process.env, logPath: join(directory, 'server.log'), detached: true },
  );
  const context = await browser.newContext();
  try {
    await waitHttpReady(url, 30000, family);
    const page = await context.newPage();
    page.setDefaultTimeout(4000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const result = await probe(page, url);
    assert.deepEqual(errors, []);
    evidence.push({ family, suffix, pass: true, result, errors });
    console.log(JSON.stringify(evidence.at(-1)));
  } finally {
    await context.close();
    await killProcessGroup(server);
  }
}
try {
  for (const mode of ['payload', 'opaque-unpaired', 'dynamic-cancel']) {
    await fixture(
      'expense-conservation',
      (original) => {
        let source = original;
        source = replace(source, "let editId = '';", "let editId = '';\nlet selectedId = '';");
        source = replace(
          source,
          'function editExpense(row) { editId = row.id;',
          "function cancelExpense() { const row = state.expenses.find(row => row.id === selectedId); if (!row) { newExpense(); return; } description = row.description; payer = row.payer; amount = money(row.cents); participants = [...row.participants]; editId = ''; }\nfunction editExpense(row) { selectedId = row.id; editId = row.id;",
        );
        source = replace(
          source,
          '<button onclick={saveExpense}>Save expense</button>',
          mode === 'dynamic-cancel'
            ? '<button onclick={saveExpense}>Save expense</button>{#if editId}<button onclick={cancelExpense}>Discard expense edit</button>{/if}'
            : '<button onclick={saveExpense}>Save expense</button><button onclick={cancelExpense}>Discard expense edit</button>',
        );
        source = replace(
          source,
          '{#each state.expenses as row (row.id)}',
          '{#each [...state.expenses].sort((a,b) => a.description.localeCompare(b.description)) as row (row.id)}',
        );
        const edit =
          '<button onclick={() => editExpense(row)}>Edit expense {row.description}</button>';
        if (mode !== 'dynamic-cancel') source = replace(source, edit, edit + edit);
        source = replace(
          source,
          '<section aria-label="Expenses">',
          '{#key state}<section aria-label="Expenses">',
        );
        source = replace(
          source,
          '</section>\n<section aria-label="Balances">',
          '</section>{/key}\n<section aria-label="Balances">',
        );
        if (mode === 'opaque-unpaired') {
          source = source.replaceAll(
            'Edit expense {row.description}',
            'Edit expense record {row.id}',
          );
          source = replace(
            source,
            '<button onclick={() => deleteExpense(row.id)}>Delete expense {row.description}</button>',
            '',
          );
          source = replace(
            source,
            '<section aria-label="Balances">',
            '<section aria-label="Expense removals"><h2>Expenses</h2>{#each state.expenses as row (row.id)}<div>{row.description}<button onclick={() => deleteExpense(row.id)}>Delete expense {row.id}</button></div>{/each}</section><section aria-label="Balances">',
          );
        }
        return source;
      },
      async (page, url) => {
        const input = (name: string) => page.getByRole('textbox', { name, exact: true });
        const button = (name: string) => page.getByRole('button', { name, exact: true });
        // Private storage is a fixture rollback oracle, never a source adapter input.
        const state = () => page.evaluate(() => localStorage.getItem('expense-settlement-v1'));
        const paid = async () => {
          const text = await page
            .getByRole('row')
            .filter({ has: page.getByRole('cell', { name: 'Zed', exact: true }) })
            .getByRole('cell')
            .nth(1)
            .innerText();
          assert.match(text, /^\d+\.\d{2}$/);
          const [whole, fraction] = text.split('.');
          return Number(whole) * 100 + Number(fraction);
        };
        await page.goto(url);
        await page.getByRole('heading', { name: 'Shared expenses', exact: true }).waitFor();
        for (const name of ['Zed', 'Ada']) {
          await input('Person name').fill(name);
          await button('Add person').click();
        }
        for (let index = 0; index < 3; index++) {
          await input('Expense description').fill(
            mode === 'dynamic-cancel' ? ['First', 'Second', 'Third'][index]! : 'Same',
          );
          await page
            .getByRole('combobox', { name: 'Payer', exact: true })
            .selectOption({ label: 'Zed' });
          await input('Amount').fill('1.00');
          await page.getByRole('checkbox', { name: 'Ada', exact: true }).check();
          await button('Save expense').click();
        }
        await page.reload();
        const before = await state();
        const records = await expenseRecords(
          { view: page, previewUrl: url },
          {
            async load(action) {
              await action.click();
              return {
                description: await input('Expense description').inputValue(),
                amount: await input('Amount').inputValue(),
              };
            },
            async write(value) {
              await input('Expense description').fill(value.description);
              await input('Amount').fill(value.amount);
            },
            save: async () => {
              await button('Save expense').click();
            },
            paid,
          },
        );
        assert.deepEqual(
          [...records].sort((a, b) => a.description.localeCompare(b.description)),
          (mode === 'dynamic-cancel' ? ['First', 'Second', 'Third'] : ['Same', 'Same', 'Same']).map(
            (description) => ({ description, amount: '1.00' }),
          ),
        );
        assert.equal(await state(), before);
        assert.equal(await paid(), 300);
        return {
          records,
          aliases: 6,
          cancelRetainsFieldsAndClearsId: true,
          sortingFullRerender: true,
          savedBytesExact: true,
        };
      },
      `-${mode}`,
    );
  }
  await fixture(
    'booking-constraints',
    (original) => {
      let source = original;
      source = replace(
        source,
        "const roomForm = reactive({ id: '', name: '', capacity: '' });",
        "const roomForm = reactive({ id: '', name: '', capacity: '' });\nconst roomEdit = reactive({ id: '', name: '', capacity: '' });\nconst inlineOwner = ref('');",
      );
      const start = source.indexOf('function saveRoom() {');
      const end = source.indexOf('function editRoom(row)', start);
      assert.ok(start >= 0 && end > start);
      const save = source
        .slice(start, end)
        .replace('function saveRoom() {', 'function saveRoomFrom(form) {')
        .replaceAll('roomForm', 'form');
      source = `${
        source.slice(0, start) + save
      }function saveRoom() { saveRoomFrom(roomForm); }\nfunction saveInline() { saveRoomFrom(roomEdit); }\n${source.slice(end)}`;
      source = replace(
        source,
        'function editRoom(row) { Object.assign(roomForm, row); }',
        'function editRoom(row) { inlineOwner.value = row.id; Object.assign(roomEdit, row); }',
      );
      const form =
        '<label>Room name <input v-model="roomForm.name"></label><label>Capacity <input v-model="roomForm.capacity" inputmode="numeric"></label><button @click="saveRoom">Save room</button>';
      source = replace(
        source,
        form,
        `<form @submit.prevent>${form.replace('Save room</button>', 'Add room</button>')}</form>`,
      );
      source = replace(source, 'Edit room {{row.name}}', 'Edit room details for {{row.name}}');
      return replace(
        source,
        '</button></li></ul></section>',
        '</button><form v-if="inlineOwner === row.id" @submit.prevent><label>Room name <input v-model="roomEdit.name"></label><label>Capacity <input v-model="roomEdit.capacity" inputmode="numeric"></label><button type="button" @click="saveInline">Save room {{row.name}}</button></form></li></ul></section>',
      );
    },
    async (page, url) => {
      const ctx = { view: page, previewUrl: url };
      const button = (name: string) => page.getByRole('button', { name, exact: true });
      const field = async (name: string, creation = false) => {
        const purpose = new RegExp(`^${name}$`);
        return editableControlForAction(
          ctx,
          purpose,
          await workflowAction(ctx, 'room', creation, editableControl(ctx, purpose)),
        );
      };
      const state = () => page.evaluate(() => localStorage.getItem('booking-workflow-v1'));
      const picker = page.getByRole('combobox', { name: 'Reservation room', exact: true });
      await page.goto(url);
      await page.getByRole('heading', { name: 'Room reservations', exact: true }).waitFor();
      for (const name of ['Bay', 'Discard']) {
        await (await field('Room name', true)).fill(name);
        await (await field('Capacity', true)).fill('2');
        await button('Add room').click();
      }
      await picker.selectOption({ label: 'Bay' });
      for (const [name, value] of [
        ['Date', '2030-01-10'],
        ['Start', '10:00'],
        ['End', '11:00'],
        ['Seats', '1'],
      ] as const)
        await page.getByRole('textbox', { name, exact: true }).fill(value);
      await button('Save reservation').click();
      const before = await state();
      const records = await roomRecords(ctx, {
        async load(action) {
          await action.click();
          return {
            name: await fieldValue(await field('Room name')),
            capacity: Number(await fieldValue(await field('Capacity'))),
          };
        },
        async write(value) {
          await (await field('Room name')).fill(value.name);
          await (await field('Capacity')).fill(String(value.capacity));
        },
        save: async () => {
          await (
            await workflowAction(ctx, 'room', false, editableControl(ctx, /^Room name$/))
          ).click();
        },
        reload: async () => {
          await page.reload();
        },
        labels: async () => Promise.all((await picker.getByRole('option').all()).map(optionLabel)),
        label: async (name) => optionLabel(await choiceOption(picker, name)),
      });
      assert.deepEqual(records, [
        { name: 'Bay', capacity: 2 },
        { name: 'Discard', capacity: 2 },
      ]);
      await page.reload();
      assert.equal(await state(), before);
      return { records, separateCreateEditOwners: true, savedGraphBytesExact: true };
    },
  );
} finally {
  await browser.close();
  await writeFile(
    join(root, 'proof.json'),
    `${JSON.stringify(
      { root, versions: { node: process.version, chromium: browser.version() }, evidence },
      null,
      2,
    )}\n`,
  );
  console.log(`RECORD_ADAPTER_ROOT ${root}`);
}
