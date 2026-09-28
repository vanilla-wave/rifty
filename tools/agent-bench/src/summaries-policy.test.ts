import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../reports/summaries/', import.meta.url));
const files = (await readdir(root, { recursive: true })).sort();

it('commits summary machine artifacts gzip-compressed only', async () => {
  expect(files.filter((file) => file.endsWith('.json'))).toEqual([]);
  const runs = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  expect(runs.length).toBeGreaterThan(0);
  for (const run of runs) expect(files).toContain(join(run.name, 'report.json.gz'));
});

it('keeps summary markdown links resolvable', async () => {
  const broken: string[] = [];
  for (const file of files.filter((file) => file.endsWith('.md')))
    for (const [, target] of (await readFile(join(root, file), 'utf8')).matchAll(
      /\]\(([^)#\s]+)\)/g,
    ))
      if (!/^[a-z]+:/i.test(target!) && !existsSync(join(root, dirname(file), target!)))
        broken.push(`${file} -> ${target}`);
  expect(broken).toEqual([]);
});
