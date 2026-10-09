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
    const source = original.replace('(!search||row.customer.includes(search))', 'true');
    assert.notEqual(source, original);
    await prepared.apply({ 'src/engine.mjs': source });
    const judge = await task.judge!(await prepared.preview());
    await writeFile(
      join(root, 'result.json'),
      `${JSON.stringify(
        {
          task: task.id,
          source,
          reference,
          judge,
          claim: 'Published Search filter omitted; capture current criterion result',
        },
        null,
        2,
      )}\n`,
    );
    assert.equal(judge.pass, false, 'Published Search must reject missing filtering');
    console.log(JSON.stringify({ referencePass: reference.pass, rejected: !judge.pass }));
  } finally {
    await prepared.close();
  }
} finally {
  await browser.close();
}
