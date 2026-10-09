import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { prepareLocal } from '../src/lanes/local-reference.ts';

const tasks = await loadCorpus('boundary-v1');
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
assert.ok(config.endpoint);
const root = await mkdtemp(join(resolve('.cache/pr341'), 'compiler-selection-guards-'));
console.log(`COMPILER_SELECTION_GUARDS_ROOT ${root}`);
const browser = await chromium.launch({ handleSIGINT: false });
const rows = [];
try {
  for (const [id, fault] of [
    ['compiler-dependency-1', 'ignored-target'],
    ['compiler-dependency-2', 'missing-typescript'],
  ] as const) {
    const task = tasks.find((candidate) => candidate.id === id)!;
    const dir = join(root, id);
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
      assert.equal(reference.pass, true, `${id}: working pinned compiler reference`);
      const base = original.replace(
        /export\s+async\s+function\s+transform/,
        'async function originalTransform',
      );
      assert.notEqual(base, original);
      const source =
        base +
        (fault === 'missing-typescript'
          ? '\nexport async function transform(args){if(args.compiler!=="esbuild")throw new Error("Not implemented: TypeScript mode");return originalTransform(args);}\n'
          : '\nexport async function transform(args){return originalTransform({...args,target:"es2015"});}\n');
      await prepared.apply({ 'src/engine.mjs': source });
      const rejected = await task.judge!(await prepared.preview());
      rows.push({ id, fault, source, reference, rejected });
      await writeFile(join(root, 'results.json'), JSON.stringify(rows, null, 2));
    } finally {
      await prepared.close();
    }
  }
} finally {
  await browser.close();
}
assert.equal(rows.length, 2);
assert.ok(
  rows.every((row) => !row.rejected.pass),
  JSON.stringify(rows),
);
