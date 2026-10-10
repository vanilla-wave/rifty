import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { asyncState, linked } from '../tests/boundary-public-probes.ts';

function execute(moduleName: string, source: string, scenario: string) {
  const root = mkdtempSync(join(tmpdir(), 'boundary-probe-mutant-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', moduleName), source);
    writeFileSync(join(root, 'scenario.mjs'), scenario);
    const result = spawnSync(process.execPath, ['scenario.mjs'], { cwd: root, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('AssertionError');
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    return result.stderr;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it('rejects an actual simple CSV workbook that lacks new quoted/linked transactions', () => {
  const error = execute(
    'workbook.mjs',
    `
export function createWorkbook(){
let state={customers:[],invoices:[]};
const parse=text=>text.trim().split(/\\r?\\n/).slice(1).map(line=>line.split(','));
return{importFiles({customers,invoices}){state={customers:parse(customers).map(([id,name])=>({id,name})),invoices:parse(invoices).map(([id,customerId,amount,currency])=>({id,customerId,cents:Math.round(Number(amount)*100),currency}))};},snapshot(){return state;}};
}`,
    linked(false),
  );
  expect(error).toContain('Alpha');
});

it('rejects a real sequential-search controller when stale concurrent responses overwrite latest results', () => {
  const error = execute(
    'search-controller.mjs',
    `
export function createController(client){
let state={query:null,items:[],total:0,pending:false,selectedIds:[]};
return{async search(q){state.query=q;state.pending=true;const result=await client.search(q);state.items=result.items;state.total=result.total;state.pending=false;},state(){return state;}};
}`,
    asyncState(false),
  );
  expect(error).toContain("'a'");
  expect(error).toContain("'b'");
});
