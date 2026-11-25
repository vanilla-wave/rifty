// out-c raw.json -> compare.mjs host format; masks /tmp/nsg-<name> -> <dir>, /tmp -> <tmp>.
import { readFileSync, writeFileSync } from 'node:fs';
const [input, output] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(input, 'utf8'));
const results = {};
for (const [name, r] of Object.entries(raw.results)) {
  const mask = (s) => s.split(`/tmp/nsg-${name}`).join('<dir>');
  results[name] = {
    stdout: mask(r.stdout),
    stderr: mask(r.stderr),
    status: r.timeout ? 'timeout (900 s)' : r.exitCode,
  };
}
writeFileSync(
  output,
  JSON.stringify({ chromium: raw.chromium, riftyNode: raw.riftyNode, results }, null, 1),
);
