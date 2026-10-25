import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const workbench = fileURLToPath(new URL('../../packages/workbench/', import.meta.url));

/** Inert prerequisite carriers `checkSandboxSupport` loads from the host's probeBaseUrl. */
export const supportAssets = [
  'support-worker',
  'support-child',
  'support-module',
  'support-service-worker',
];

/** Separate from the runtime chunk graph: unbundled, one emitted file per entry. */
export async function buildSupportAssets(outdir) {
  await build({
    entryPoints: supportAssets.map((name) => resolve(workbench, `src/support/${name}.ts`)),
    outdir,
    bundle: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
}
