/**
 * esbuild the REAL prod shim sources into `fixtures/dist/` (gitignored) — the
 * substrate never exercises a source copy.
 */
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const outDir = fileURLToPath(new URL('./fixtures/dist', import.meta.url));

export async function buildNoCoiFixtures() {
  await build({
    entryPoints: [
      {
        in: `${repoRoot}packages/runtime-js/src/ipc/worker-realm-compat.ts`,
        out: 'worker-realm-compat',
      },
      { in: `${repoRoot}packages/runtime-js/src/builtins/util-types.ts`, out: 'util-types' },
    ],
    bundle: true,
    format: 'esm',
    outdir: outDir,
    outExtension: { '.js': '.mjs' },
    logLevel: 'silent',
  });
  return outDir;
}
