import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

for (const fault of ['ignored-filter', 'ignored-sort'] as const) {
  it(`rejects a real controller with ${fault}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rifty-query-selector-'));
    await mkdir(join(dir, 'src'));
    const base = resolve('tools/agent-bench/corpus/cases/async-search-1');
    const patch = JSON.parse(await readFile(join(base, 'reference.json'), 'utf8')) as Record<
      string,
      string
    >;
    const original = patch['src/search-controller.mjs']!;
    const judge = await readFile(join(base, 'judge.mjs'), 'utf8');
    await writeFile(join(dir, 'judge.mjs'), judge);
    await writeFile(join(dir, 'src/search-controller.mjs'), original);
    execFileSync(process.execPath, ['judge.mjs'], { cwd: dir, stdio: 'pipe' });
    const source = original.replace(
      'client.search(clone(q))',
      fault === 'ignored-filter'
        ? "client.search({...clone(q),filter:''})"
        : "client.search({...clone(q),sort:'name-asc'})",
    );
    expect(source).not.toBe(original);
    await writeFile(join(dir, 'src/search-controller.mjs'), source);
    const result = spawnSync(process.execPath, ['judge.mjs'], { cwd: dir, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('AssertionError');
  });
}
