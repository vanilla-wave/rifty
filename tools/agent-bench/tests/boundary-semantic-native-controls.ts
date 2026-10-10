import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { prepareLocal } from '../src/lanes/local-reference.ts';
import { probeBoundaryPublicScenario } from './boundary-public-probes.ts';

const corpusRoot = process.argv[2] ? resolve(process.argv[2]) : undefined;
const tasks = await loadCorpus('boundary-v1', corpusRoot);
const root = await mkdtemp(join(resolve('.cache/pr341'), 'boundary-semantic-native-'));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
assert.ok(config.endpoint);
const browser = await chromium.launch({ handleSIGINT: false });
const rows: { task: string; control: string; pass: boolean; error?: string; result?: unknown }[] =
  [];
console.log(`BOUNDARY_SEMANTIC_ROOT ${root}`);
try {
  for (const task of tasks) {
    for (const control of ['reference', 'alternative']) {
      const dir = join(root, task.id, control);
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
        await prepared.apply(task.controls![control]!);
        const result = await probeBoundaryPublicScenario(prepared, task);
        rows.push({ task: task.id, control, pass: true, result });
      } catch (error) {
        rows.push({ task: task.id, control, pass: false, error: String(error) });
      } finally {
        await prepared.close();
      }
      await writeFile(join(root, 'results.json'), JSON.stringify(rows, null, 2));
    }
  }
} finally {
  await browser.close();
}
assert.equal(rows.length, 16);
assert.ok(
  rows.every((row) => row.pass),
  JSON.stringify(rows.filter((row) => !row.pass)),
);
