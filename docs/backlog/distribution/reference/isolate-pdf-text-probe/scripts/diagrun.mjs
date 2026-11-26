// node diagrun.mjs <rifty checkout> <script.cjs> — prints guest lines that differ from node's.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [repo, script] = process.argv.slice(2);
const { createSandbox } = await import(
  pathToFileURL(join(repo, 'packages/isolate-host/dist/index.js')).href
);
const sandbox = await createSandbox();
await sandbox.writeFile(`diag/${basename(script)}`, readFileSync(script));
await sandbox.writeFile('gen/_out.cjs', 'exports.emit = 1;');
const guest = await sandbox.exec(`diag/${basename(script)}`, { timeoutMs: 60000 });
const node = spawnSync('node', [script], { encoding: 'utf8' });
const n = node.stdout.trim().split('\n');
const g = guest.stdout.trim().split('\n');
console.log(
  `node exit ${node.status}, guest exit ${guest.exitCode}; ${n.length} node lines, ${g.length} guest lines`,
);
const nm = new Map(n.map((l) => [l.split(': ')[0], l]));
for (const l of g)
  if (nm.get(l.split(': ')[0]) !== l)
    console.log(`  GUEST ${l}\n   NODE ${nm.get(l.split(': ')[0])}`);
if (guest.stderr) console.log('guest stderr:', guest.stderr.slice(0, 1500));
await sandbox.destroy();
