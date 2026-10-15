import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { asyncState } from './boundary-public-probes.ts';

const root = await mkdtemp(join(resolve('.cache/pr341'), 'selection-membership-controls-'));
console.log(`SELECTION_MEMBERSHIP_CONTROLS_ROOT ${root}`);
const rows: {
  level: number;
  variant: string;
  checker: string;
  expected: boolean;
  actual: boolean;
  stderr: string;
}[] = [];
for (const level of [1, 2]) {
  const base = resolve(`tools/agent-bench/corpus/cases/async-search-${level}`);
  const patch = JSON.parse(await readFile(join(base, 'reference.json'), 'utf8')) as Record<
    string,
    string
  >;
  const original = patch['src/search-controller.mjs']!;
  const state = 'state:()=>clone(current),';
  const restore = 'current=clone(data.current);current.pending=false;';
  assert.ok(original.includes(state) && original.includes(restore));
  const variants = [
    { name: 'array', source: original, expected: true },
    {
      name: 'hardcoded-member',
      source: original.replace(state, "state:()=>({...clone(current),selectedIds:['a']}),"),
      expected: false,
    },
    {
      name: 'items-set',
      source: original.replace(
        state,
        'state:()=>({...clone(current),items:new Set(current.items)}),',
      ),
      expected: true,
    },
    {
      name: 'items-iterator',
      source: original.replace(
        state,
        'state:()=>({...clone(current),items:(function*(){yield* current.items})()}),',
      ),
      expected: true,
    },
    {
      name: 'reversed-items',
      source: original.replace(
        state,
        'state:()=>({...clone(current),items:[...current.items].reverse()}),',
      ),
      expected: false,
    },
    {
      name: 'set',
      source: original.replace(
        state,
        'state:()=>({...clone(current),selectedIds:new Set(current.selectedIds)}),',
      ),
      expected: true,
    },
    {
      name: 'iterator',
      source: original.replace(
        state,
        'state:()=>({...clone(current),selectedIds:(function*(){yield* current.selectedIds})()}),',
      ),
      expected: true,
    },
    {
      name: 'missing-member',
      source: original.replace(state, 'state:()=>({...clone(current),selectedIds:new Set()}),'),
      expected: false,
    },
    {
      name: 'extra-member',
      source: original.replace(
        state,
        "state:()=>({...clone(current),selectedIds:new Set([...current.selectedIds,'ghost'])}),",
      ),
      expected: false,
    },
    {
      name: 'lost-restored-member',
      source: original.replace(
        restore,
        'current=clone(data.current);current.selectedIds=[];current.pending=false;',
      ),
      expected: false,
    },
  ];
  for (const variant of variants) {
    const dir = join(root, `level${level}-${variant.name}`);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/search-controller.mjs'), variant.source);
    for (const checker of ['private', 'public']) {
      await writeFile(
        join(dir, `${checker}.mjs`),
        checker === 'private' ? await readFile(join(base, 'judge.mjs')) : asyncState(level === 2),
      );
      const result = spawnSync(process.execPath, [`${checker}.mjs`], {
        cwd: dir,
        encoding: 'utf8',
      });
      rows.push({
        level,
        variant: variant.name,
        checker,
        expected: variant.expected,
        actual: result.status === 0,
        stderr: result.stderr,
      });
      await writeFile(
        join(dir, `${checker}-result.json`),
        JSON.stringify(
          { status: result.status, stdout: result.stdout, stderr: result.stderr },
          null,
          2,
        ),
      );
    }
  }
}
await writeFile(join(root, 'results.json'), JSON.stringify(rows, null, 2));
assert.ok(
  rows.every((row) => row.actual === row.expected),
  JSON.stringify(rows),
);
console.log(
  JSON.stringify({
    selected: rows.length,
    accepted: rows.filter((row) => row.actual).length,
    rejected: rows.filter((row) => !row.actual).length,
  }),
);
