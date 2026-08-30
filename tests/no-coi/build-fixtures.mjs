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
      // Kernel PUBLIC entry + the retained private constructor module: consumed
      // by the evidence driver's row-12 sweep AND the lane's kernelDriver
      // provenance controls (`header-provenance.no-coi.spec.ts`).
      { in: `${repoRoot}packages/kernel/src/index.ts`, out: 'kernel-public' },
      { in: `${repoRoot}packages/kernel/src/worker-stdio-drain.ts`, out: 'kernel-stdio-drain' },
    ],
    bundle: true,
    format: 'esm',
    outdir: outDir,
    outExtension: { '.js': '.mjs' },
    logLevel: 'silent',
  });
  return outDir;
}
