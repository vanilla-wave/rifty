import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalShadowJson } from '../src/internal/canonical.ts';
import { builtinShadowCatalogSource } from '../src/internal/catalog-source.ts';

const output = new URL('../generated/shadow-substitution-catalog.json', import.meta.url);
const digest = (value: unknown) =>
  createHash('sha256').update(canonicalShadowJson(value)).digest('hex');

const recipes = builtinShadowCatalogSource.recipes.map((recipe) => ({
  ...recipe,
  digest: digest(recipe),
}));
const payload = { ...builtinShadowCatalogSource, recipes };
const expected = `${JSON.stringify({ ...payload, digest: digest(payload) }, null, 2)}\n`;

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === '--write') {
    await writeFile(output, expected);
    return;
  }
  if (mode !== '--check')
    throw new Error('usage: generate-shadow-substitution-catalog.ts --write|--check');
  if ((await readFile(output, 'utf8')) !== expected)
    throw new Error('shadow substitution catalog drifted; run generator --write');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

export const shadowSubstitutionCatalogPath = fileURLToPath(output);
