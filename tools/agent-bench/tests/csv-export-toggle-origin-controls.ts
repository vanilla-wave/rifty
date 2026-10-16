import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import type { Lane } from '../src/lanes/types.ts';
import { resolvePlan } from '../src/plan.ts';
import { run } from '../src/runner.ts';

const root = await mkdtemp(join(tmpdir(), 'rifty-csv-export-toggle-origins-'));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const original = (await loadCorpus('eval-v5')).find((task) => task.family === 'contact-import')!;
const native = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as {
  variant: string;
  source: FileTree;
  expectedPass: boolean;
}[];
assert.equal(native.length, 8);
const variants = [
  { name: 'baseline', expectedPass: false, patch: {} as FileTree },
  { name: 'partial', expectedPass: false, patch: original.controls!.partial! },
  ...native.map((row) => ({
    name: row.variant,
    expectedPass: row.expectedPass,
    patch: Object.fromEntries(
      Object.entries(row.source).filter(([path, text]) => original.files[path] !== text),
    ),
  })),
];
const lanes: Lane[] = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'];
// Unique control identities let the existing runner own one finite matrix and one host setup.
const tasks = variants.map((variant) => ({
  ...original,
  id: `${original.id}-${variant.name}`,
  controls: { ...original.controls, reference: variant.patch },
}));
const declaration = {
  originalCase: original.id,
  purpose: 'controls only; ten programme variants, one task family, no quality evidence',
  variants,
  plan: await resolvePlan(config, tasks, lanes),
};
await writeFile(join(root, 'declared-input-plan.json'), JSON.stringify(declaration, null, 2));
const report = await run(config, tasks, lanes, join(root, 'series'), 'reference');
assert.equal(report.runs.length, 40);
assert.deepEqual(report.header.plan, declaration.plan);
const physical = [];
for (const row of report.runs) {
  const variant = variants.find((variant) => `${original.id}-${variant.name}` === row.task)!;
  assert.equal(row.agentStatus, 'not-run');
  assert.equal(row.judge.pass, variant.expectedPass, JSON.stringify(row));
  const before = JSON.parse(
    await readFile(join(root, 'series', row.artifacts.before!), 'utf8'),
  ) as FileTree;
  const after = JSON.parse(
    await readFile(join(root, 'series', row.artifacts.after!), 'utf8'),
  ) as FileTree;
  assert.deepEqual(after, { ...before, ...variant.patch });
  const trace = JSON.parse(await readFile(join(root, 'series', row.artifacts.trace!), 'utf8'));
  assert.equal(trace.noModelInvocation, true);
  physical.push({
    task: row.task,
    lane: row.lane,
    physicalPatchExact: true,
    noModelInvocation: true,
  });
}
await writeFile(
  join(root, 'evidence.json'),
  JSON.stringify({ declaration, report, physical }, null, 2),
);
console.log(`CSV_EXPORT_TOGGLE_ORIGIN_ARTIFACTS ${root}`);
