import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadCorpus, validateFiles } from './corpus.ts';
import { digest } from './plan.ts';
it.each(['project', 'prompt', 'judge', 'card', 'provenance', 'lock', 'path', 'family'])(
  'rejects corrupted %s without admitting a series',
  async (field) => {
    const root = await mkdtemp(join(tmpdir(), 'rifty-corpus-corrupt-'));
    await cp('tools/agent-bench/corpus', root, { recursive: true });
    const manifestPath = join(root, 'pilot-v1.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.cases = manifest.cases.slice(0, 2);
    const card = manifest.cases[0];
    const dir = join(root, 'cases', card.id);
    if (['project', 'prompt', 'judge'].includes(field)) {
      await writeFile(join(dir, card[field]), 'corrupt bytes');
    } else if (field === 'card' || field === 'provenance') {
      const path = join(dir, 'card.json');
      const data = JSON.parse(await readFile(path, 'utf8'));
      if (field === 'card') data.family = 'wrong';
      else data.origin.commit = 'wrong';
      await writeFile(path, JSON.stringify(data));
    } else if (field === 'family') {
      manifest.cases[1].split = 'evaluation';
    } else {
      const path = join(dir, 'project.json');
      const files = JSON.parse(await readFile(path, 'utf8'));
      if (field === 'path') files['../escape'] = 'outside';
      else {
        const lock = JSON.parse(files['package-lock.json']);
        lock.lockfileVersion = 2;
        files['package-lock.json'] = JSON.stringify(lock);
        card.lockSha256 = digest(files['package-lock.json']);
      }
      const text = JSON.stringify(files);
      card.inputsSha256 = digest(text);
      await writeFile(path, text);
    }
    await writeFile(manifestPath, JSON.stringify(manifest));
    const result = await loadCorpus('pilot-v1', root).then(
      () => 'admitted',
      (error) => String(error),
    );
    expect(result).not.toBe('admitted');
  },
);
it('rejects unsafe and conflicting private tree paths', () => {
  for (const path of ['/root', 'a/../escape', 'a\\escape', 'node_modules/x', '.git/x', 'dist/x'])
    expect(() => validateFiles({ [path]: 'bytes' })).toThrow();
  expect(() => validateFiles({ a: 'file', 'a/b': 'descendant' })).toThrow();
});
