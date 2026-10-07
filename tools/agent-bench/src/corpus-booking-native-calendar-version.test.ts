import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { loadCorpus } from './corpus.ts';
import { digest, resolvePlan } from './plan.ts';

it('versions native input interaction, preserving eight public tasks and six other judges', async () => {
  const before = await loadCorpus('eval-v5');
  const after = await loadCorpus('eval-v6');
  const ids: Record<string, string> = {
    'booking-workflow-v2': 'booking-workflow-v3',
    'expense-settlement-v2': 'expense-settlement-v3',
  };
  expect(after).toHaveLength(8);
  const plan = await resolvePlan(await loadConfig(), after, ['local-reference']);
  for (const task of before) {
    const id = ids[task.id] ?? task.id;
    const next = after.find((candidate) => candidate.id === id)!;
    expect(next.files).toEqual(task.files);
    expect(next.prompt).toBe(task.prompt);
    expect(next.controls).toEqual(task.controls);
    expect(next.family).toBe(task.family);
    expect(next.split).toBe(task.split);
    for (const name of [
      'project.json',
      'prompt.md',
      'reference.json',
      'partial.json',
      'alternative.json',
    ])
      expect(await readFile(`tools/agent-bench/corpus/cases/${id}/${name}`)).toEqual(
        await readFile(`tools/agent-bench/corpus/cases/${task.id}/${name}`),
      );
    if (!ids[task.id]) {
      expect(await readFile(next.judgeFiles![0]!)).toEqual(await readFile(task.judgeFiles![0]!));
      expect(next.judgeFiles).toEqual(task.judgeFiles);
    } else {
      expect(next.judgeFiles!.slice(1)).toEqual([
        'tools/agent-bench/src/judge/context.ts',
        'tools/agent-bench/src/judge/native-input.ts',
      ]);
      const files = await Promise.all(next.judgeFiles!.map((path) => readFile(path, 'utf8')));
      expect(plan.tasks.find((row) => row.id === id)!.judgeSha256).toBe(digest(files.join('\n')));
      const oracle = id.startsWith('booking') ? 'booking-v3.ts' : 'expense-v3.ts';
      expect(await readFile(next.judgeFiles![0]!, 'utf8')).toBe(
        (await readFile(`tools/agent-bench/tests/workflow-oracles/${oracle}`, 'utf8')).replaceAll(
          '../../src/judge/',
          '../../../src/judge/',
        ),
      );
    }
  }
});

it('rejects unknown private support before reading or importing a task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rifty-native-input-support-fault-'));
  try {
    const manifest = JSON.parse(await readFile('tools/agent-bench/corpus/eval-v6.json', 'utf8'));
    const card = manifest.cases.find((row: { id: string }) => row.id === 'booking-workflow-v3');
    await writeFile(
      join(root, 'invalid-support.json'),
      JSON.stringify({
        version: 'invalid-support',
        cases: [{ ...card, judgeSupport: 'unknown-profile' }],
      }),
    );
    await expect(loadCorpus('invalid-support', root)).rejects.toThrow('Invalid corpus card');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
