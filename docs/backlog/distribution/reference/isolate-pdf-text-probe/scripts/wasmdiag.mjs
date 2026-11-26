// node wasmdiag.mjs <rifty checkout> <file.wasm> — the four modes of diag/wasm.cjs in a sandbox and under node.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const [repo, wasm] = process.argv.slice(2);
const { createSandbox } = await import(
  pathToFileURL(join(repo, 'packages/isolate-host/dist/index.js')).href
);
const sandbox = await createSandbox({ maxFsBytes: 64 << 20 });
await sandbox.writeFile('wasm.cjs', readFileSync(join(here, 'diag/wasm.cjs')));
await sandbox.writeFile('m.wasm', readFileSync(wasm));
for (const mode of ['sync', 'compile', 'compile-keepalive', 'compile-await-timer']) {
  const g = await sandbox.exec('wasm.cjs', { args: [mode, 'm.wasm'], timeoutMs: 60000 });
  const n = spawnSync('node', [join(here, 'diag/wasm.cjs'), mode, wasm], { encoding: 'utf8' });
  console.log(
    `--- ${mode}\n  node  exit ${n.status}: ${n.stdout.trim().split('\n').join(' | ')}\n  guest exit ${g.exitCode}${g.termination ? ` ${g.termination}` : ''}: ${g.stdout.trim().split('\n').join(' | ')}${g.stderr ? `\n  guest stderr: ${g.stderr.slice(0, 400)}` : ''}`,
  );
}
await sandbox.destroy();
