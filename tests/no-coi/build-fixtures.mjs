/**
 * esbuild the REAL prod shim sources into `fixtures/dist/` (gitignored) — the
 * substrate never exercises a source copy. Provenance is STRUCTURED, not
 * narrated: the build runs with a metafile and every bundle's `entryPoint`
 * must be exactly its declared prod source (repo-relative) with that source
 * among the bundle's inputs — a byte-identical copy under `tests/` has a
 * different path and fails loud. The metafile is written beside the bundles
 * (`fixtures/dist/metafile.json`) so the lane spec re-asserts the same record
 * (`build-provenance.no-coi.spec.ts`); the evidence driver builds through
 * this module and inherits the loud throw.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const outDir = fileURLToPath(new URL('./fixtures/dist', import.meta.url));

/** out-name → the ONLY admissible entry source, repo-relative. Kernel PUBLIC
 * entry + the retained private constructor module: consumed by the evidence
 * driver's row-12 sweep AND the lane's kernelDriver provenance controls. */
export const FIXTURE_ENTRYPOINTS = {
  'worker-realm-compat.mjs': 'packages/runtime-js/src/ipc/worker-realm-compat.ts',
  'util-types.mjs': 'packages/runtime-js/src/builtins/util-types.ts',
  'kernel-public.mjs': 'packages/kernel/src/index.ts',
  'kernel-stdio-drain.mjs': 'packages/kernel/src/worker-stdio-drain.ts',
};

/** Throws unless the metafile records EVERY declared bundle as built from
 * exactly its declared prod entry source, with that source among the bundle's
 * consumed inputs. Detection pinned in `build-provenance.no-coi.spec.ts`. */
export function assertFixtureProvenance(metafile) {
  const outputs = metafile?.outputs ?? {};
  for (const [out, entry] of Object.entries(FIXTURE_ENTRYPOINTS)) {
    const key = `tests/no-coi/fixtures/dist/${out}`;
    const record = outputs[key];
    if (record === undefined) {
      throw new Error(`fixture provenance: no metafile output for ${key}`);
    }
    if (record.entryPoint !== entry) {
      throw new Error(
        `fixture provenance: ${key} built from ${String(record.entryPoint)}, expected ${entry}`,
      );
    }
    if (record.inputs?.[entry] === undefined) {
      throw new Error(`fixture provenance: ${key} never consumed its entry source ${entry}`);
    }
  }
}

export async function buildNoCoiFixtures() {
  const result = await build({
    entryPoints: Object.entries(FIXTURE_ENTRYPOINTS).map(([out, entry]) => ({
      in: `${repoRoot}${entry}`,
      out: out.replace(/\.mjs$/, ''),
    })),
    bundle: true,
    format: 'esm',
    outdir: outDir,
    outExtension: { '.js': '.mjs' },
    logLevel: 'silent',
    metafile: true,
    absWorkingDir: repoRoot,
  });
  assertFixtureProvenance(result.metafile);
  await writeFile(`${outDir}/metafile.json`, JSON.stringify(result.metafile, null, 2));
  return outDir;
}
