// Dump exceljs 4.4.0's installed closure (package-closure.ts closureFiles) as JSON {path: base64}.
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [repo, out] = process.argv.slice(2);
const { closureFiles } = await import(
  pathToFileURL(join(repo, 'packages/isolate-host/tests/package-closure.ts')).href
);
const files: Map<string, Uint8Array> = closureFiles(
  'exceljs',
  realpathSync(join(repo, 'packages/isolate-host/node_modules/exceljs')),
);
const obj: Record<string, string> = {};
let bytes = 0;
for (const [p, d] of files) {
  obj[p] = Buffer.from(d).toString('base64');
  bytes += d.length;
}
writeFileSync(out, JSON.stringify(obj));
console.log('files', files.size, 'bytes', bytes);
