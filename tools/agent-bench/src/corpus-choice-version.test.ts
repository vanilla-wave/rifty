import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { loadCorpus } from './corpus.ts';

it('preserves prior source/prompts/controls while versioning the repaired judges', async () => {
  const prior = await loadCorpus('eval-v1');
  const next = await loadCorpus('eval-v2');
  expect(next).toHaveLength(8);
  for (const task of prior) {
    const changed = ['booking-workflow', 'expense-settlement'].includes(task.id);
    const id = changed ? `${task.id}-v2` : task.id;
    const replacement = next.find((candidate) => candidate.id === id)!;
    expect(replacement.files).toEqual(task.files);
    expect(replacement.prompt).toBe(task.prompt);
    expect(replacement.controls).toEqual(task.controls);
    expect(replacement.family).toBe(task.family);
    expect(replacement.split).toBe(task.split);
    if (changed) {
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
      const stem = task.id === 'booking-workflow' ? 'booking' : 'expense';
      const certified = await readFile(
        `tools/agent-bench/tests/workflow-oracles/${stem}-v2.ts`,
        'utf8',
      );
      expect(await readFile(`tools/agent-bench/corpus/cases/${id}/judge.ts`, 'utf8')).toBe(
        certified.replaceAll('../../src/judge/context.ts', '../../../src/judge/context.ts'),
      );
    }
  }
});
