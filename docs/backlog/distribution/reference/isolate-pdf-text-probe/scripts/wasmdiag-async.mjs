// node wasmdiag-async.mjs <rifty checkout> <file.wasm> — diag/wasm-async.cjs: node vs sandbox.exec vs runCode.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const [repo, wasm] = process.argv.slice(2);
const { createSandbox, runCode } = await import(
  pathToFileURL(join(repo, 'packages/isolate-host/dist/index.js')).href
);
const diag = readFileSync(join(here, 'diag/wasm-async.cjs'), 'utf8');
const sandbox = await createSandbox({ maxFsBytes: 64 << 20 });
await sandbox.writeFile('wasm.cjs', diag);
await sandbox.writeFile('m.wasm', readFileSync(wasm));
const line = (r) =>
  `exit ${r.exitCode ?? r.status}${r.termination ? ` ${r.termination}` : ''}: ${r.stdout.trim().split('\n').join(' | ')}${r.stderr.trim() ? ` || stderr: ${r.stderr.trim().split('\n')[0].slice(0, 160)}` : ''}`;
const MODES = [
  'compile',
  'compile-await',
  'instantiate-bytes',
  'instantiate-module',
  'streaming',
  'unsubscribed-invalid',
  'unsubscribed-invalid-large',
];
for (const src of ['tiny', 'pdfium']) {
  for (const mode of MODES) {
    // pdfium needs imports: with {} its instantiate rejects after the compile (observable).
    if (src === 'pdfium' ? mode === 'unsubscribed-invalid' : mode === 'unsubscribed-invalid-large')
      continue;
    const arg = src === 'tiny' ? 'tiny' : wasm;
    const n = spawnSync('node', [join(here, 'diag/wasm-async.cjs'), mode, arg], {
      encoding: 'utf8',
    });
    const g = await sandbox.exec('wasm.cjs', {
      args: [mode, src === 'tiny' ? 'tiny' : 'm.wasm'],
      timeoutMs: 60000,
    });
    const pre =
      src === 'tiny'
        ? `globalThis.__mode = ${JSON.stringify(mode)}; globalThis.__src = 'tiny';\n`
        : `globalThis.__mode = ${JSON.stringify(mode)}; globalThis.__src = 'inline'; globalThis.__bytes = Buffer.from(${JSON.stringify(readFileSync(wasm).toString('base64'))}, 'base64');\n`;
    const rc = await runCode(pre + diag, { timeoutMs: 60000 });
    console.log(
      `--- ${src} ${mode}\n  node     ${line(n)}\n  exec     ${line(g)}\n  runCode  ${line(rc)}`,
    );
  }
}
await sandbox.destroy();
