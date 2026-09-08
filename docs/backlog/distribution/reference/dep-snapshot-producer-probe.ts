import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  type Lockfile,
  RegistryClient,
  install,
} from '../../../../packages/npm-client/src/index.ts';
import { shadowSubstitutionPlanForInstallResult } from '../../../../packages/npm-client/src/internal/index.ts';
import {
  planShadowSubstitutionsFromLockfile,
  registryAcquisitionInstallPath,
  registryShadowEmbeddedSourcesFromLockfile,
} from '../../../../packages/npm-client/src/internal/shadow/planner.ts';
import { createMemoryFs } from '../../../../packages/vfs/src/internal/index.ts';
import { builtinShadowSubstitutionCatalog } from '../../../../tools/shadow-registry/src/internal/index.ts';

async function main() {
  const registryUrl = process.argv[2];
  if (!registryUrl) throw new Error('Pass a registry URL');
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const base = `${root}tests/e2e/fixtures/npm-lock-replay/vite8/`;
  const manifestText = await readFile(`${base}package.json`, 'utf8');
  const lockText = await readFile(`${base}package-lock.json`, 'utf8');
  const lock = JSON.parse(lockText) as Lockfile;
  const pinnedUrls = new Set(
    Object.values(lock.packages).map((entry: unknown) => (entry as { resolved?: string }).resolved),
  );
  const metadata: string[] = [];
  const extraTarballs: string[] = [];
  const warnings: string[] = [];
  const substitutions: string[] = [];
  const originalWarn = console.warn;
  const { vfs } = createMemoryFs();
  await vfs.mkdir('/project', { recursive: true });
  await vfs.writeFile('/project/package.json', manifestText);
  await vfs.writeFile('/project/package-lock.json', lockText);
  console.warn = (...args) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    const result = await install({
      vfs,
      cwd: '/project',
      onSubstitution: (line) => substitutions.push(line),
      registry: new RegistryClient({
        baseUrl: registryUrl,
        maxRetries: 0,
        stallTimeoutMs: 10000,
        fetch: async (url, init) => {
          if (!pinnedUrls.has(url)) (url.endsWith('.tgz') ? extraTarballs : metadata).push(url);
          return fetch(url, init);
        },
      }),
    });
    const parsedPlan = planShadowSubstitutionsFromLockfile(result.lockfile);
    const policyPaths = new Set(
      parsedPlan.substitutions.flatMap((s) => [
        s.materialization.installPath,
        ...(s.acquisition.kind === 'registry' ? [registryAcquisitionInstallPath(s)] : []),
      ]),
    );
    for (const source of registryShadowEmbeddedSourcesFromLockfile(result.lockfile, parsedPlan)) {
      for (const child of source.dependencies) policyPaths.add(child.installPath);
    }
    const gateFailures = Object.entries(result.lockfile.packages).filter(
      ([path, entry]) =>
        path &&
        !policyPaths.has(path) &&
        (!Object.hasOwn(lock.packages, path) ||
          entry.version !== lock.packages[path].version ||
          entry.resolved !== lock.packages[path].resolved ||
          entry.integrity !== lock.packages[path].integrity),
    );
    const evidence = {
      nodeVersion: process.version,
      catalogDigest: builtinShadowSubstitutionCatalog.digest,
      outputPinGate: {
        policyPaths: [...policyPaths],
        failures: gateFailures.map(([path]) => path),
      },
      fixture: 'tests/e2e/fixtures/npm-lock-replay/vite8/',
      resolution: result.provenance.resolution,
      packages: result.packages.length,
      metadata,
      extraTarballs,
      substitutions,
      warnings,
      changed: Object.entries(result.lockfile.packages)
        .filter(
          ([path, entry]) =>
            path &&
            lock.packages[path] &&
            (entry.version !== lock.packages[path]?.version ||
              entry.integrity !== lock.packages[path]?.integrity),
        )
        .map(([path, entry]) => ({ path, before: lock.packages[path], after: entry })),
      missing: Object.entries(lock.packages)
        .filter(([path]) => !Object.hasOwn(result.lockfile.packages, path))
        .map(([path, entry]) => ({ path, entry })),
      added: Object.entries(result.lockfile.packages)
        .filter(([path]) => !Object.hasOwn(lock.packages, path))
        .map(([path, entry]) => ({ path, entry })),
      shadowPlan: shadowSubstitutionPlanForInstallResult(result),
      outputLockfile: result.lockfile,
    };
    await writeFile(
      new URL('./dep-snapshot-producer-probe.json', import.meta.url),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    console.log(
      JSON.stringify({
        nodeVersion: evidence.nodeVersion,
        packages: evidence.packages,
        resolution: evidence.resolution,
        metadata,
        extraTarballs,
        changed: evidence.changed.map((item) => item.path),
        missing: evidence.missing.map((item) => item.path),
        added: evidence.added,
      }),
    );
  } finally {
    console.warn = originalWarn;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
