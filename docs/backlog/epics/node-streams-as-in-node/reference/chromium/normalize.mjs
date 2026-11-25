// Host raw JSON -> {chromium, riftyNode, results: {name: {stdout, stderr, status}}}, paths masked.
// usage: node normalize.mjs workbench|sdk IN OUT
import { readFileSync, writeFileSync } from 'node:fs';

const [kind, input, output] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(input, 'utf8'));
const root = kind === 'workbench' ? '/home/project/nsg' : '/nsg';
const mask = (s, name) => s.split(`${root}/${name}`).join('<dir>').split(root).join('<root>');
const results = {};
for (const [name, r] of Object.entries(raw.results)) {
  if (kind === 'workbench') {
    results[name] = {
      stdout: mask(r.stdout.ok ? r.stdout.text : '', name),
      stderr: mask(r.out.replaceAll('\r', ''), name),
      status: r.timeout ? 'timeout (180 s)' : (r.exit.code ?? `signal ${r.exit.signal}`),
    };
  } else {
    results[name] = {
      stdout: mask(r.stdout, name),
      stderr: mask(r.stderr, name),
      status: r.timeout ? 'timeout (180 s)' : r.exitCode,
    };
  }
}
writeFileSync(
  output,
  JSON.stringify({ chromium: raw.chromium, riftyNode: raw.riftyNode, results }, null, 1),
);
