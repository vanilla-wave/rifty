import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const base = resolve('tools/agent-bench/corpus/cases/async-search-2');
const patch = JSON.parse(await readFile(join(base, 'reference.json'), 'utf8')) as Record<
  string,
  string
>;
const original = patch['src/search-controller.mjs']!;
assert.ok(original.includes('catch(error){replace(before);'));
const variants = [
  { name: 'reference', source: original, expected: true },
  {
    name: 'wrapped-error',
    source: original.replaceAll('throw error;', "throw new Error('Request failed',{cause:error});"),
    expected: true,
  },
  { name: 'handled-error', source: original.replaceAll('throw error;', 'return;'), expected: true },
  {
    name: 'lost-query',
    source: original.replace(
      'catch(error){replace(before);',
      'catch(error){current.query=null;replace(before);',
    ),
    expected: false,
  },
  {
    name: 'lost-peer',
    source: original.replace(
      'catch(error){replace(before);',
      "catch(error){replace(before);current.items=current.items.filter(row=>row.id==='b');",
    ),
    expected: false,
  },
  {
    name: 'missing-rollback',
    source: original.replace('catch(error){replace(before);', 'catch(error){'),
    expected: false,
  },
];
const root = await mkdtemp(join(resolve('.cache/pr341'), 'async-failure-controls-'));
console.log(`ASYNC_FAILURE_CONTROLS_ROOT ${root}`);
const rows = [];
for (const variant of variants) {
  const dir = join(root, variant.name);
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src/search-controller.mjs'), variant.source);
  await writeFile(join(dir, 'judge.mjs'), await readFile(join(base, 'judge.mjs')));
  const result = spawnSync(process.execPath, ['judge.mjs'], { cwd: dir, encoding: 'utf8' });
  rows.push({
    variant: variant.name,
    expected: variant.expected,
    actual: result.status === 0,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}
await writeFile(join(root, 'results.json'), JSON.stringify(rows, null, 2));
assert.ok(
  rows.every((row) => row.expected === row.actual),
  JSON.stringify(rows),
);
console.log(
  JSON.stringify({
    selected: rows.length,
    accepted: rows.filter((row) => row.actual).length,
    rejected: rows.filter((row) => !row.actual).length,
  }),
);
