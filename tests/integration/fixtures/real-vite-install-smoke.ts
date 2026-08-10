/**
 * Standalone live-registry Vite install smoke, driven by
 * `vite-live-install.opt-in.test.ts`.
 *
 * It intentionally stops at the Node-hostable seam: real registry acquisition,
 * lockfile attestation, and materialised shadow files. Runtime Vite/Rolldown proof
 * belongs to the COI browser-unit lane.
 */
import '../../../packages/net/src/register-builtins.ts';
import { RegistryClient, install } from '../../../packages/npm-client/src/index.ts';
import { createMemoryFs } from '../../../packages/vfs/src/internal/index.ts';

const realExit = process.exit.bind(process);
const realEnv = { ...process.env };
const ROOT = '/workspace';
const VITE_VERSION = '8.0.16';
const LIGHTNING_RECIPE = 'rifty.shadow-substitution.lightningcss.v2';
const decoder = new TextDecoder();

function log(message: string): void {
  process.stdout.write(`[vite-install-smoke] ${message}\n`);
}

setTimeout(() => {
  log('TIMEOUT (240s) — forcing exit');
  realExit(2);
}, 240_000).unref?.();

function readText(fsSync: ReturnType<typeof createMemoryFs>['fsSync'], path: string): string {
  return decoder.decode(fsSync.readFileBytesSync(path));
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

async function main(): Promise<void> {
  const registryUrl = realEnv.RIFTY_LIVE_REGISTRY;
  if (!registryUrl) {
    log('RIFTY_LIVE_REGISTRY not set — skipping');
    process.exitCode = 0;
    return;
  }

  const { vfs, fsSync } = createMemoryFs();
  await vfs.mkdir(ROOT, { recursive: true });
  const substitutions: string[] = [];
  const registry = new RegistryClient({ baseUrl: registryUrl, fetch: globalThis.fetch });

  log(`installing vite@${VITE_VERSION} ...`);
  const result = await install(
    'app',
    '0.0.0',
    { vite: VITE_VERSION },
    {
      vfs,
      cwd: ROOT,
      registry,
      onSubstitution(line) {
        substitutions.push(line);
        log(line);
      },
    },
  );

  assertEqual(
    result.packages.find(({ name }) => name === 'vite')?.version,
    VITE_VERSION,
    'installed Vite version',
  );
  assertEqual(
    result.lockfile.packages['node_modules/lightningcss']?.riftyShadowRecipe,
    LIGHTNING_RECIPE,
    'lightningcss lock recipe',
  );
  assertEqual(
    result.lockfile.packages['node_modules/lightningcss-wasm']?.version,
    '1.32.0',
    'lightningcss acquisition version',
  );
  if (
    !result.lockfile.rifty?.shadowSubstitutions.applied.some(
      ({ substitutionId }) => substitutionId === LIGHTNING_RECIPE,
    )
  ) {
    throw new Error(`lockfile does not attest ${LIGHTNING_RECIPE}`);
  }
  if (
    !substitutions.some((line) =>
      line.includes(`materialized from shadow registry (${LIGHTNING_RECIPE})`),
    )
  ) {
    throw new Error(`install emitted no materialisation provenance for ${LIGHTNING_RECIPE}`);
  }
  if (
    !readText(fsSync, `${ROOT}/node_modules/lightningcss/index.mjs`).includes(
      "from 'lightningcss-wasm'",
    )
  ) {
    throw new Error('lightningcss ESM alias was not materialised');
  }
  if (
    !readText(fsSync, `${ROOT}/node_modules/lightningcss/index.cjs`).includes(
      "require('lightningcss-wasm')",
    )
  ) {
    throw new Error('lightningcss CJS alias was not materialised');
  }

  log(`RIFTY_VITE_INSTALL_OK — ${result.packages.length} packages, ${LIGHTNING_RECIPE}`);
  process.exitCode = 0;
}

main().catch((error) => {
  log(`UNCAUGHT: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 3;
});
