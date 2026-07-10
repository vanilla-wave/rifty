import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_ROUTE = '/*\n';
const PREVIEW_HEADER = '  X-Robots-Tag: noindex, nofollow\n';

export function withPreviewNoindex(source: string): string {
  if (!source.startsWith(ROOT_ROUTE)) {
    throw new Error(`landing headers must start with ${JSON.stringify(ROOT_ROUTE)}`);
  }
  if (source.startsWith(ROOT_ROUTE + PREVIEW_HEADER)) return source;
  return source.replace(ROOT_ROUTE, ROOT_ROUTE + PREVIEW_HEADER);
}

async function main(path: string | undefined): Promise<void> {
  if (!path) throw new Error('usage: preview-noindex.ts <built _headers path>');
  const source = await readFile(path, 'utf8');
  await writeFile(path, withPreviewNoindex(source));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main(process.argv[2]);
}
