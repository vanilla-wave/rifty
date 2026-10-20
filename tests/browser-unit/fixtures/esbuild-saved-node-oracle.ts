import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export type SavedEsbuildFault = 'payload' | 'shadow-provenance' | 'missing-lock';
export const SAVED_ESBUILD_PROBE = `const esbuild = require('esbuild');
console.log('esbuild-loaded:' + esbuild.version);
esbuild.transform('let x=1').then(
  result => console.log('esbuild-result:' + JSON.stringify({ code: result.code })),
  error => { console.log('esbuild-result:' + JSON.stringify({ error: error.message })); process.exitCode = 1; }
).finally(() => esbuild.stop());
`;
export function savedEsbuildTranscript(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => /^esbuild-(loaded|result):/.test(line));
}
export function captureSavedEsbuildOracle(fault: SavedEsbuildFault) {
  const root = mkdtempSync(join(tmpdir(), 'esbuild-saved-oracle-'));
  const pkg = join(root, 'node_modules/esbuild');
  try {
    mkdirSync(pkg, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      resolve(
        'tests/integration/fixtures/registry/rollup-companions/packages/esbuild-wasm-0.28.0.tgz',
      ),
      '--strip-components=1',
      '-C',
      pkg,
    ]);
    writeFileSync(join(root, 'probe.cjs'), SAVED_ESBUILD_PROBE);
    if (fault === 'payload') writeFileSync(join(pkg, 'esbuild.wasm'), 'corrupt');
    if (fault === 'shadow-provenance')
      writeFileSync(
        join(root, 'package-lock.json'),
        JSON.stringify({ rifty: { shadowSubstitutions: { protocol: 'invalid-provenance' } } }),
      );
    const result = spawnSync(process.execPath, ['probe.cjs'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (result.error) throw result.error;
    return {
      exit: result.status,
      transcript: savedEsbuildTranscript(result.stdout),
      stderr: result.stderr,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
