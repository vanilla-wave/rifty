import { readFile, readdir, stat } from 'node:fs/promises';

export function compatEvidenceSources(markdown) {
  return [
    ...new Set(
      [
        ...markdown.matchAll(
          /`((?:apps|packages|services|tests|tools)\/[^`]+(?:\.(?:test|spec|case)\.ts|\*\.case\.ts))`/gu,
        ),
      ].map((match) => match[1] ?? ''),
    ),
  ];
}

async function sourceMatches(source, repoRoot) {
  if (source.includes('*')) {
    if (!source.endsWith('*.case.ts')) return [];
    const prefix = source.slice(0, source.lastIndexOf('/') + 1);
    const entries = await readdir(new URL(prefix, repoRoot), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.case.ts'))
      .map((entry) => `${prefix}${entry.name}`);
  }
  return stat(new URL(source, repoRoot)).then(
    (entry) => (entry.isFile() ? [source] : []),
    () => [],
  );
}

/** Finite sweep over every public compat evidence citation, generated or hand-maintained. */
export async function validateCompatEvidenceSources(compatRoot, repoRoot) {
  const files = (await readdir(compatRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
  const matchedSources = new Set();
  const missing = [];
  for (const file of files) {
    const markdown = await readFile(new URL(file, compatRoot), 'utf8');
    for (const source of compatEvidenceSources(markdown)) {
      const matches = await sourceMatches(source, repoRoot);
      if (matches.length === 0) missing.push(`${file}: ${source}`);
      for (const match of matches) matchedSources.add(match);
    }
  }
  if (missing.length > 0) {
    throw new Error(`compat evidence source does not exist:\n${missing.join('\n')}`);
  }
  return matchedSources.size;
}
