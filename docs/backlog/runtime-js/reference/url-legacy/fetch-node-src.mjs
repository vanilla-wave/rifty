// Fetch the pinned Node sources this probe reads (lib + the url tests) into <dir>.
// Usage: node fetch-node-src.mjs <base, e.g. https://raw.githubusercontent.com/nodejs/node/v24.16.0> <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [base, dir] = process.argv.slice(2);
if (!base || !dir) throw new Error('usage: node fetch-node-src.mjs <base> <dir>');
const FILES = [
  'lib/url.js',
  'lib/querystring.js',
  'lib/internal/querystring.js',
  'test/parallel/test-url-parse-format.js',
  'test/parallel/test-url-format.js',
  'test/parallel/test-url-relative.js',
  'test/parallel/test-url-parse-invalid-input.js',
  'test/parallel/test-url-parse-query.js',
];
mkdirSync(dir, { recursive: true });
for (const f of FILES) {
  const res = await fetch(`${base}/${f}`);
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  // lib/querystring.js and lib/internal/querystring.js share a basename.
  writeFileSync(
    join(dir, f === 'lib/querystring.js' ? 'querystring-lib.js' : basename(f)),
    await res.text(),
  );
}
console.log(`${FILES.length} files → ${dir}`);
