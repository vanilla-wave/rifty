import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../reports/summaries/', import.meta.url));
const files = (await readdir(root, { recursive: true })).sort();

it('commits summary machine artifacts gzip-compressed only', async () => {
  expect(files.filter((file) => file.endsWith('.json'))).toEqual([]);
  const runs = (await readdir(root, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory(),
  );
  expect(runs.length).toBeGreaterThan(0);
  for (const run of runs) expect(files).toContain(join(run.name, 'report.json.gz'));
});

it('commits summary gzip with the Unix OS header byte and valid JSON', async () => {
  // RFC 1952 byte 9 = host OS; pinned 0x03 so regeneration is byte-identical across platforms.
  const gz = files.filter((file) => file.endsWith('.json.gz'));
  expect(gz.length).toBeGreaterThan(0);
  const bad: string[] = [];
  for (const file of gz) {
    const bytes = await readFile(join(root, file));
    if (bytes[9] !== 0x03) bad.push(`${file}: OS byte 0x${bytes[9]!.toString(16)}`);
    try {
      JSON.parse(gunzipSync(bytes).toString('utf8'));
    } catch (error) {
      bad.push(`${file}: ${(error as Error).message}`);
    }
  }
  expect(bad).toEqual([]);
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
