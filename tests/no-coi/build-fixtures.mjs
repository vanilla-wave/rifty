/**
 * Build the REAL shim artifacts the no-COI substrate exercises — esbuild of the
 * actual prod sources (never a source copy):
 *   - `packages/runtime-js/src/ipc/worker-realm-compat.ts` → fixtures/dist/worker-realm-compat.mjs
 *   - `packages/runtime-js/src/builtins/util-types.ts`     → fixtures/dist/util-types.mjs
 *
 * Called by the lane's globalSetup and by `tools/probes/no-coi-realm-probe.mjs`.
 * Output dir is gitignored (`dist/`).
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
