import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import {
  action,
  caption,
  editableControl,
  fieldValue,
  renderedValue,
} from '../src/judge/context.ts';
import type { Prepared } from '../src/lanes/types.ts';
import type { Task } from '../src/tasks.ts';
import compilerGoldens from './boundary-compiler-goldens.json';

export const csvDiagnosticLocationSource = String.raw`
function csvDiagnosticLocation(error) {
  const text = typeof error?.message === 'string' ? error.message : '';
  const named = /\bline\s*:?\s*(\d+)\s*[,;]?\s*(?:column|col)\s*:?\s*(\d+)/i.exec(text);
  const compact = /(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)/.exec(text);
  const position = named ?? compact;
  if (position) return { line: Number(position[1]), column: Number(position[2]) };
  return error ? { line: Number(error.line), column: Number(error.column) } : null;
}
`;

export const linked = (higher: boolean) => `
import assert from 'node:assert/strict';
import {createWorkbook} from './src/workbook.mjs';
${csvDiagnosticLocationSource}
const book=createWorkbook();
const customers='id,name\\r\\nc1,"Alpha, A"\\r\\nc2,"Beta ""B"""\\r\\n';
const invoices='id,customer_id,amount,currency\\nc1-i,c1,100.01,USD\\nc2-i,c2,2.00,EUR\\n';
book.importFiles({customers,invoices});
assert.deepEqual(book.snapshot().customers,[{id:'c1',name:'Alpha, A'},{id:'c2',name:'Beta "B"'}]);
assert.deepEqual(book.snapshot().invoices,[{id:'c1-i',customerId:'c1',cents:10001,currency:'USD'},{id:'c2-i',customerId:'c2',cents:200,currency:'EUR'}]);
const before=structuredClone(book.snapshot());
assert.throws(()=>book.importFiles({customers,invoices:'id,customer_id,amount,currency\\nx,missing,1.00,USD\\n'}));
assert.deepEqual(book.snapshot(),before);
assert.throws(()=>book.importFiles({customers:'id,name\\nc1,A\\nc1,B\\n',invoices}));
assert.deepEqual(book.snapshot(),before);
assert.throws(()=>book.importFiles({customers,invoices:'id,customer_id,amount,currency\\nx,c1,1.005,USD\\n'}));
assert.deepEqual(book.snapshot(),before);
const malformed=(()=>{try{book.importFiles({customers:'id,name\\nc1,"unfinished',invoices});}catch(e){return e;}})();
assert.deepEqual(csvDiagnosticLocation(malformed),{line:2,column:4});
assert.deepEqual(book.snapshot(),before);
const multiline='id,name\\nc1,"Alpha\\nSecond"\\nc2,Beta\\n';
book.importFiles({customers:multiline,invoices});
assert.equal(book.snapshot().customers[0].name,'Alpha\\nSecond');
${
  higher
    ? `
const credits='id,invoice_id,amount\\nk1,c1-i,0.01\\nk2,c1-i,0.02\\n';
book.importFiles({customers:multiline,invoices,credits});
assert.deepEqual(book.snapshot().totals,{USD:9998,EUR:200});
const credited=structuredClone(book.snapshot());
assert.throws(()=>book.importFiles({customers:multiline,invoices,credits:'id,invoice_id,amount\\nx,c1-i,100.02\\n'}));
assert.deepEqual(book.snapshot(),credited);
const restored=createWorkbook();restored.restoreJson(book.exportJson());
assert.deepEqual(restored.snapshot(),credited);restored.undo();
assert.deepEqual(restored.snapshot().totals,{USD:10001,EUR:200});
`
    : 'const restored=createWorkbook();restored.restoreJson(book.exportJson());assert.deepEqual(restored.snapshot(),book.snapshot());'
}
console.log('BOUNDARY_PUBLIC_SCENARIO_PASS');
`;

export const asyncState = (higher: boolean) => `
import assert from 'node:assert/strict';
import {createController} from './src/search-controller.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let rows=[{id:'a',name:'Alpha',value:30},{id:'b',name:'Beta',value:20},{id:'c',name:'Gamma',value:10}];
let failNext=false;
// Controlled external data/clock boundary; controller and Node primitives are real.
const client={async search(q){const captured=structuredClone(rows);await wait(q.filter==='Alpha'?70:5);const matched=captured.filter(r=>r.name.includes(q.filter));matched.sort(q.sort==='value-desc'?(a,b)=>b.value-a.value:(a,b)=>a.name.localeCompare(b.name));return{items:matched.slice((q.page-1)*q.pageSize,q.page*q.pageSize),total:matched.length};},async update(id,patch){await wait(25);if(failNext){failNext=false;throw Error('Service unavailable');}rows=rows.map(r=>r.id===id?{...r,...patch}:r);return structuredClone(rows.find(r=>r.id===id));}};
const c=createController(client);
const slow=c.search({filter:'Alpha',page:1,pageSize:1,sort:'name-asc'});
const fast=c.search({filter:'',page:2,pageSize:1,sort:'value-desc'});
await Promise.all([slow,fast]);
assert.equal(c.state().query.page,2);assert.deepEqual(c.state().items.map(r=>r.id),['b']);assert.equal(c.state().total,3);assert.equal(c.state().pending,false);
c.select('a');await c.search({filter:'Alpha',page:1,pageSize:1,sort:'name-asc'});
assert.deepEqual(c.state().selectedIds,['a']);
assert.deepEqual(c.state().items.map(r=>r.id),['a']);assert.equal(c.state().total,1);
await c.back();assert.equal(c.state().query.page,2);assert.deepEqual(c.state().items.map(r=>r.id),['b']);
const restored=createController(client);restored.restoreJson(c.exportJson());
assert.deepEqual(restored.state().query,c.state().query);assert.deepEqual(restored.state().selectedIds,['a']);
// The external data changes: name order must not accidentally equal value order.
rows=rows.map(r=>r.id==='a'?{...r,value:5}:r);
await c.search({filter:'',page:1,pageSize:3,sort:'value-desc'});
assert.deepEqual(c.state().items.map(r=>r.id),['b','c','a']);
rows=rows.map(r=>r.id==='a'?{...r,value:30}:r);
${
  higher
    ? `
await c.search({filter:'',page:1,pageSize:5,sort:'name-asc'});
const publicState=s=>({query:s.query&&{filter:s.query.filter,page:s.query.page,pageSize:s.query.pageSize,sort:s.query.sort},items:s.items.map(({id,name,value})=>({id,name,value})),total:s.total,pending:s.pending,selectedIds:s.selectedIds});
const beforeFailure=structuredClone(publicState(c.state()));
failNext=true;const failed=c.update('b',{value:99});
assert.equal(c.state().items.find(r=>r.id==='b').value,99);
try{await failed;}catch{}
assert.deepEqual(publicState(c.state()),beforeFailure);
assert.equal(c.state().items.find(r=>r.id==='b').value,20);assert.deepEqual(c.state().selectedIds,['a']);
await c.retry();assert.equal(c.state().items.find(r=>r.id==='b').value,99);
const reload=createController(client);reload.restoreJson(c.exportJson());await reload.undo();
assert.equal(rows.find(r=>r.id==='b').value,20);
const stale=c.search({filter:'Alpha',page:1,pageSize:5,sort:'name-asc'});
await c.search({filter:'',page:1,pageSize:5,sort:'name-asc'});
await c.update('b',{value:77});await stale;
assert.equal(c.state().items.find(r=>r.id==='b').value,77);
`
    : ''
}
console.log('BOUNDARY_PUBLIC_SCENARIO_PASS');
`;

export async function probeBoundaryPublicScenario(prepared: Prepared, task: Task) {
  const higher = task.id.endsWith('-2');
  if (task.family === 'linked-data-import' || task.family === 'async-search-state') {
    await prepared.apply({
      '.bench-public-scenario.mjs':
        task.family === 'linked-data-import' ? linked(higher) : asyncState(higher),
    });
    const result = await prepared.command('node .bench-public-scenario.mjs');
    assert.equal(result.exitCode, 0, `${task.id}: ${result.stdout}\n${result.stderr}`);
    assert.ok(result.stdout.includes('BOUNDARY_PUBLIC_SCENARIO_PASS'));
    return { family: task.family, source: 'actual public module workflow', result };
  }
  assert.equal(task.group, 'app', `${task.id}: compiler/resource requires an actual browser task`);
  const ctx = await prepared.preview();
  if (task.family === 'compiler-integration') {
    const source = editableControl(ctx, /^Source$/i);
    const target = editableControl(ctx, /^Target$/i);
    const output = ctx.view.getByLabel('JavaScript', { exact: true });
    const diagnostics = ctx.view.getByLabel('Diagnostics', { exact: true });
    const compilers = higher ? (['typescript', 'esbuild'] as const) : (['typescript'] as const);
    const results = [];
    for (const compiler of compilers) {
      if (higher) await editableControl(ctx, /^Compiler$/i).selectOption(compiler);
      for (const selectedTarget of ['es2015', 'es2020'] as const) {
        await source.fill(compilerGoldens.source);
        await target.selectOption(selectedTarget);
        await action(ctx, caption('Compile')).click();
        await expect
          .poll(
            async () =>
              (await renderedValue(output)).trim() || (await renderedValue(diagnostics)).trim(),
            { timeout: 60000 },
          )
          .not.toBe('');
        assert.equal((await renderedValue(diagnostics)).trim(), '');
        const code = await renderedValue(output);
        const expected =
          selectedTarget === 'es2015'
            ? compilerGoldens[compiler]
            : compilerGoldens.es2020[compiler];
        assert.equal(code.trim(), expected.trim());
        const answer = await ctx.view.evaluate((text) => {
          const box: { answer?: number } = {};
          new Function('globalThis', text)(box);
          return box.answer;
        }, code);
        assert.equal(answer, 42);
        await source.fill('const = ;');
        await action(ctx, caption('Compile')).click();
        await expect.poll(() => renderedValue(diagnostics)).not.toBe('');
        assert.equal((await renderedValue(output)).trim(), '');
        results.push({ compiler, target: selectedTarget, answer });
      }
    }
    return {
      family: task.family,
      source:
        'actual browser compilation/syntax error/result clearing in each published mode/target',
      results,
    };
  }
  assert.equal(task.family, 'indexed-resource');
  const count = higher ? 1000000 : 100000;
  const search = editableControl(ctx, /^Search$/i);
  const status = await ctx.view.getByLabel('Status', { exact: true }).elementHandle();
  assert.ok(status);
  const inputObservation = await search.evaluateHandle((node, statusNode) => {
    const observation: { phase: string | null; eventTime: number | null } = {
      phase: null,
      eventTime: null,
    };
    node.addEventListener(
      'input',
      () => {
        observation.phase =
          statusNode instanceof HTMLInputElement || statusNode instanceof HTMLTextAreaElement
            ? statusNode.value
            : statusNode instanceof HTMLElement
              ? statusNode.innerText
              : (statusNode.textContent ?? '');
        observation.eventTime = performance.now();
      },
      { capture: true, once: true },
    );
    return observation;
  }, status);
  const interactionStarted = performance.now();
  await action(ctx, caption('Load')).click({ timeout: 2000 });
  // Generous admission target; final response deadline frozen from real references before exploration.
  const remaining = 2000 - (performance.now() - interactionStarted);
  assert.ok(remaining > 0, 'Indexing blocked the first user interaction deadline');
  await search.fill('Customer 100', { timeout: remaining });
  const firstInteractionMs = performance.now() - interactionStarted;
  assert.ok(firstInteractionMs <= 2000, 'Indexing blocked the first user interaction deadline');
  assert.equal(await fieldValue(search), 'Customer 100');
  const observedInput = await inputObservation.jsonValue();
  await inputObservation.dispose();
  await status.dispose();
  assert.ok(observedInput.phase !== null, 'Actual input event was not observed');
  const interactionDuringIndexing = /indexing|loading/i.test(observedInput.phase);
  const completedBeforeInteraction = /ready/i.test(observedInput.phase);
  assert.ok(interactionDuringIndexing || completedBeforeInteraction, 'Unknown indexing phase');
  await expect(ctx.view.getByLabel('Status', { exact: true })).toContainText(/ready/i, {
    timeout: 60000,
  });
  const matching = ctx.view.getByLabel('Matching rows', { exact: true });
  let searchedCount = 0;
  let combinedCount = 0;
  let regionCount = 0;
  for (let i = 0; i < count; i++) {
    if (`Customer ${i % 4096}`.includes('Customer 100')) {
      searchedCount++;
      if (i % 4 === 0) regionCount++;
      if (i % 4 === 0 && i % 12 === 0) combinedCount++;
    }
  }
  await expect.poll(() => renderedValue(matching)).toBe(String(searchedCount));
  await editableControl(ctx, /^Region$/i).selectOption('North');
  await expect.poll(() => renderedValue(matching)).toBe(String(regionCount));
  await editableControl(ctx, /^Month$/i).selectOption('1');
  await expect.poll(() => renderedValue(matching)).toBe(String(combinedCount));
  await search.fill('');
  await expect
    .poll(() => renderedValue(ctx.view.getByLabel('Matching rows', { exact: true })))
    .toBe(String(Math.ceil(count / 12)));
  await editableControl(ctx, /^Sort$/i).selectOption('cents-desc');
  const expectedOrder: { id: number; cents: number }[] = [];
  for (let i = 0; i < count; i += 12)
    expectedOrder.push({ id: i + 1, cents: (i * 7919) % 1000000 });
  expectedOrder.sort((a, b) => b.cents - a.cents || a.id - b.id);
  const table = ctx.view.getByRole('table');
  const headers = await table.getByRole('columnheader').allInnerTexts();
  const idColumn = headers.findIndex((text) => /^id$/i.test(text.trim()));
  assert.ok(idColumn >= 0, 'Published table must expose record IDs');
  const renderedIds = async () =>
    (await table.getByRole('cell').allInnerTexts()).filter(
      (_, index) => index % headers.length === idColumn,
    );
  await expect.poll(renderedIds).toEqual(expectedOrder.slice(0, 100).map((row) => String(row.id)));
  await action(ctx, caption('Next page')).click();
  await expect.poll(() => renderedValue(ctx.view.getByLabel('Page', { exact: true }))).toBe('2');
  await expect
    .poll(renderedIds)
    .toEqual(expectedOrder.slice(100, 200).map((row) => String(row.id)));
  const page = 'page' in ctx.view ? ctx.view.page() : ctx.view;
  const download = page.waitForEvent('download');
  await action(ctx, caption('Export')).click();
  const file = await download;
  const path = await file.path();
  assert.ok(path);
  const { readFile } = await import('node:fs/promises');
  const records = JSON.parse(await readFile(path, 'utf8')) as {
    id: number;
    cents: number;
    region: string;
    month: number;
  }[];
  assert.equal(records.length, Math.ceil(count / 12));
  assert.ok(
    records.every(
      (r) =>
        r.id >= 1 &&
        r.id <= count &&
        (r.id - 1) % 12 === 0 &&
        r.region === 'North' &&
        r.month === 1 &&
        r.cents === ((r.id - 1) * 7919) % 1000000,
    ),
  );
  for (let i = 1; i < records.length; i++)
    assert.ok(
      records[i - 1]!.cents > records[i]!.cents ||
        (records[i - 1]!.cents === records[i]!.cents && records[i - 1]!.id < records[i]!.id),
    );
  return {
    family: task.family,
    source: 'actual browser navigation/indexing/export',
    firstInteractionMs,
    observedInput,
    interactionDuringIndexing,
    completedBeforeInteraction,
    responsivenessEvidence: interactionDuringIndexing
      ? 'observed during indexing'
      : 'completed before interaction; no during-indexing proof',
    rows: count,
    exported: records.length,
  };
}
