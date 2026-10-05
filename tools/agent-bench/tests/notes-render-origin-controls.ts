import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import { run } from '../src/runner.ts';
const root = await mkdtemp(join(tmpdir(), 'rifty-notes-render-origins-'));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const apps = (await loadCorpus('pilot-v4')).filter((t) => t.group === 'app');
const lanes = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'] as const;
const refs = await run(config, apps, [...lanes], join(root, 'references'), 'reference');
assert.equal(refs.runs.length, 8);
for (const row of refs.runs) assert.equal(row.judge.pass, true, JSON.stringify(row));
const task = apps.find((t) => t.family === 'linked-knowledge')!;
const judge = task.judge!;
for (const n of [1, 3, 'responsive3'] as const) {
  const original = n === 'responsive3' ? 3 : n;
  const files = JSON.parse(
    gunzipSync(
      await readFile(
        `tools/agent-bench/tests/fixtures/notes-pilot-v3-programme${original}.json.gz`,
      ),
    ).toString(),
  ) as FileTree;
  if (n === 'responsive3') {
    const text = files['src/main.js']!;
    files['src/main.js'] = text.replace(
      '.section-label,.note-list,.sidebar-foot{display:none}',
      '.section-label,.sidebar-foot{display:none}',
    );
    assert.notEqual(files['src/main.js'], text);
  }
  const presentation: { width: number; media700: boolean; navDisplay: string | null }[] = [];
  task.judge = async (ctx) => {
    const result = await judge(ctx);
    presentation.push(
      await ctx.view.evaluate(() => {
        const nav = document.querySelector('.note-list');
        return {
          width: innerWidth,
          media700: matchMedia('(max-width:700px)').matches,
          navDisplay: nav ? getComputedStyle(nav).display : null,
        };
      }),
    );
    return result;
  };
  task.controls!.reference = files;
  const name = `actual-programme${n}`;
  const report = await run(config, [task], [...lanes], join(root, name), 'reference');
  assert.equal(report.runs.length, 4);
  for (const [index, row] of report.runs.entries()) {
    assert.equal(row.agentStatus, 'not-run');
    const expectedPass = !(n === 3 && row.lane === 'rifty');
    assert.equal(row.judge.pass, expectedPass, JSON.stringify(row));
    if (!expectedPass) {
      assert(presentation[index]!.width <= 700);
      assert.equal(presentation[index]!.media700, true);
      assert.equal(presentation[index]!.navDisplay, 'none');
    }
    const dir = join(root, name, task.id, row.lane, '1');
    const before = JSON.parse(await readFile(join(dir, 'before.json'), 'utf8')) as FileTree;
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'after.json'), 'utf8')), {
      ...before,
      ...files,
    });
  }
  await writeFile(join(root, name, 'presentation.json'), JSON.stringify(presentation, null, 2));
}
console.log(`NOTES_RENDER_ORIGIN_ARTIFACTS ${root}`);
