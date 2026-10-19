import { describe, expect, it } from 'vitest';
import { loadCorpus } from './corpus.ts';

describe('boundary corpus admission', () => {
  it('loads pinned cases with two distinct higher levels for every declared path', async () => {
    const tasks = await loadCorpus('boundary-v1');
    const families = [
      'linked-data-import',
      'async-search-state',
      'compiler-integration',
      'indexed-resource',
    ];
    expect(tasks).toHaveLength(8);
    for (const family of families)
      expect(tasks.filter((task) => task.family === family)).toHaveLength(2);
    for (const task of tasks) {
      expect(task.corpus).toBe('boundary-v1');
      expect(task.controls).toHaveProperty('reference');
      expect(task.controls).toHaveProperty('alternative');
      expect(task.controls).toHaveProperty('partial');
      expect(task.files['package-lock.json']).toBeTruthy();
      expect(JSON.parse(task.files['package-lock.json']!).lockfileVersion).toBe(3);
      expect(task.prompt.trim()).not.toBe('');
    }
  });
});
