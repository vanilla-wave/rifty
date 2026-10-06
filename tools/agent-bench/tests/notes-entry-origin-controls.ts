import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import type { Lane } from '../src/lanes/types.ts';
import { resolvePlan } from '../src/plan.ts';
import { run } from '../src/runner.ts';

const root = await mkdtemp(join(tmpdir(), 'rifty-notes-entry-origins-'));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const original = (await loadCorpus('eval-v4')).find((task) => task.family === 'linked-knowledge')!;
const native = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as {
  variant: string;
  files: FileTree;
  expectedPass: boolean;
}[];
assert.equal(native.length, 14);
const captured = JSON.parse(
  gunzipSync(
    await readFile('tools/agent-bench/tests/fixtures/notes-composed-entry-programme.json.gz'),
  ).toString(),
) as FileTree;
const variants = [
  ...native.map((row) => ({
    ...row,
    // Native variants include unchanged public seed files; apply only the declared change.
    // Each origin's installed lockfile remains its own measured input.
    source: Object.fromEntries(
      Object.entries(row.files).filter(([path, text]) => original.files[path] !== text),
    ),
  })),
  { variant: 'captured-composed-entry', source: captured, expectedPass: true },
];
const lanes: Lane[] = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'];
const tasks = variants.map((variant) => ({
  ...original,
  controls: { ...original.controls, reference: variant.source },
}));
await writeFile(
  join(root, 'declared-input-plans.json'),
  JSON.stringify(
    await Promise.all(
      tasks.map(async (task, i) => ({
        variant: variants[i]!.variant,
        expectedPass: variants[i]!.expectedPass,
        plan: await resolvePlan(config, [task], lanes),
        patch: variants[i]!.source,
      })),
    ),
    null,
    2,
  ),
);
const evidence = [];
const outcomes: { variant: string; lane: Lane; actual: boolean; expected: boolean }[] = [];
try {
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i]!;
    const output = join(root, variant.variant);
    const control = ['baseline', 'partial'].includes(variant.variant)
      ? variant.variant
      : 'reference';
    const report = await run(config, [tasks[i]!], lanes, output, control);
    assert.equal(report.runs.length, 4);
    evidence.push({ variant: variant.variant, expectedPass: variant.expectedPass, output, report });
    for (const row of report.runs) {
      assert.equal(row.agentStatus, 'not-run');
      // Original programme3 hides its nav at the COI viewport; retain that host failure.
      const expected =
        variant.variant === 'actual-programme3' && row.lane === 'rifty'
          ? false
          : variant.expectedPass;
      outcomes.push({ variant: variant.variant, lane: row.lane, actual: row.judge.pass, expected });
      const before = JSON.parse(
        await readFile(join(output, row.artifacts.before!), 'utf8'),
      ) as FileTree;
      const after = JSON.parse(
        await readFile(join(output, row.artifacts.after!), 'utf8'),
      ) as FileTree;
      assert.deepEqual(after, { ...before, ...variant.source });
    }
  }
} finally {
  await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`NOTES_ENTRY_ORIGIN_ARTIFACTS ${root}`);
}

assert.equal(outcomes.length, 60);
for (const row of outcomes) assert.equal(row.actual, row.expected, JSON.stringify(row));
