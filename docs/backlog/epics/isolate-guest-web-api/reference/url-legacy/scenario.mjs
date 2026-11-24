// The unit's user scenario: scenario.cjs as /workspace/main.js with parseurl in node_modules,
// isolate-host sandbox vs `node main.js` over the same files.
// Usage (repo root, isolate-host built): node <this> <dir holding node_modules/parseurl (1.3.3)>
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(process.argv[2], 'node_modules/parseurl');
const { createSandbox } = await import(
  pathToFileURL(join(here, '../../../../../../packages/isolate-host/dist/index.js')).href
);
const sb = await createSandbox();
await sb.writeFile('main.js', readFileSync(join(here, 'scenario.cjs')));
for (const f of ['index.js', 'package.json'])
  await sb.writeFile(`node_modules/parseurl/${f}`, readFileSync(join(pkg, f)));
const guest = await sb.exec('main.js');
await sb.destroy();
const dir = mkdtempSync(join(tmpdir(), 'url-scenario-'));
cpSync(join(here, 'scenario.cjs'), join(dir, 'main.js'));
cpSync(pkg, join(dir, 'node_modules/parseurl'), { recursive: true });
const r = spawnSync(process.execPath, ['main.js'], { cwd: dir, encoding: 'utf8' });
const node = {
  stdout: r.stdout,
  stderr: r.stderr.replace(/\(node:\d+\)/g, '(node:<pid>)'),
  exitCode: r.status,
};
console.log(JSON.stringify({ guest, node: { ...node, version: process.version } }, null, 1));
