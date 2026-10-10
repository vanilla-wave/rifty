import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { prepareLocal } from '../src/lanes/local-reference.ts';
const task = (await loadCorpus('boundary-v1')).find((t) => t.id === 'indexed-data-1')!;
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
assert.ok(config.endpoint);
const root = await mkdtemp(join(resolve('.cache/pr341'), 'resource-search-selector-'));
console.log('RESOURCE_SEARCH_SELECTOR_ROOT', root);
const browser = await chromium.launch({ handleSIGINT: false });
try {
  const dir = join(root, 'native');
  await mkdir(dir, { recursive: true });
  const prepared = await prepareLocal({
    browser,
    task,
    config,
    endpoint: config.endpoint,
    dir,
    playgroundUrl: '',
  });
  try {
    const original = task.controls!.reference!['src/engine.mjs']!;
    await prepared.apply({ 'src/engine.mjs': original });
    const reference = await task.judge!(await prepared.preview());
    assert.equal(reference.pass, true);
    const rows = [];
    for (const [fault, omitted] of [
      ['Search', '(!search||row.customer.includes(search))'],
      ['Region', '(!region||row.region===region)'],
    ] as const) {
      const source = original.replace(omitted, 'true');
      assert.notEqual(source, original);
      await prepared.apply({ 'src/engine.mjs': source });
      const judge = await task.judge!(await prepared.preview());
      rows.push({ task: task.id, fault, source, reference, judge });
      await writeFile(join(root, 'results.json'), JSON.stringify(rows, null, 2));
    }
    assert.ok(
      rows.every((row) => !row.judge.pass),
      'Published Search/Region must reject omitted filtering',
    );
    console.log(JSON.stringify({ referencePass: reference.pass, rejected: rows.length }));
  } finally {
    await prepared.close();
  }
} finally {
  await browser.close();
}
