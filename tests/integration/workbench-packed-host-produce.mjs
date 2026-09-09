import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function publishedExportTarget(value) {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return null;
  return value.import ?? value.default ?? null;
}

/** Import `produceDepSnapshot` through the installed package `./dep-snapshot` export. */
export async function importProduceDepSnapshot(installedWorkbenchRoot) {
  const manifest = JSON.parse(
    await readFile(resolve(installedWorkbenchRoot, 'package.json'), 'utf8'),
  );
  const target = publishedExportTarget(manifest.exports?.['./dep-snapshot']);
  if (typeof target !== 'string') {
    throw new Error('installed @riftydev/workbench is missing the ./dep-snapshot export');
  }
  const entry = resolve(installedWorkbenchRoot, target);
  const source = await readFile(entry, 'utf8');
  if (/from\s+['"]file:/u.test(source)) {
    throw new Error('packed ./dep-snapshot re-exports a file URL instead of shipping produce');
  }
  const api = await import(pathToFileURL(entry).href);
  if (typeof api.produceDepSnapshot !== 'function') {
    throw new Error(`packed ./dep-snapshot does not export produceDepSnapshot (${target})`);
  }
  return api;
}
