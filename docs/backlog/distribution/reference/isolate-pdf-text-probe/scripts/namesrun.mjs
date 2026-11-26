// node namesrun.mjs <rifty checkout> — diag/streaming-names.cjs under node, sandbox.exec and runCode.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const [repo] = process.argv.slice(2);
const { createSandbox, runCode } = await import(
  pathToFileURL(join(repo, 'packages/isolate-host/dist/index.js')).href
);
const file = join(here, 'diag/streaming-names.cjs');
const code = readFileSync(file, 'utf8');
const line = (r) =>
  `exit ${r.exitCode ?? r.status}: ${r.stdout.trim().split('\n').join(' | ')}${r.stderr.trim() ? ` || stderr: ${r.stderr.trim().split('\n')[0]}` : ''}`;
const sandbox = await createSandbox();
await sandbox.writeFile('names.cjs', code);
console.log(`node     ${line(spawnSync('node', [file], { encoding: 'utf8' }))}`);
console.log(`exec     ${line(await sandbox.exec('names.cjs'))}`);
console.log(`runCode  ${line(await runCode(code))}`);
await sandbox.destroy();
