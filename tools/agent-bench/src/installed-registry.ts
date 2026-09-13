import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type InstalledManifest,
  findInstalledPackage,
  installedClosure,
  packInstalledPackages,
  readJson,
  registryEntries,
  startInstalledRegistry,
} from '../../../tests/integration/installed-registry.mjs';
import { runOrThrow } from './proc.ts';

/** Real installed dependency tarballs, served as the packed-consumer gate serves them. */
export async function installedRegistry(owners: Iterable<string>, root: string) {
  const seeds: string[] = [];
  for (const dir of owners) {
    const manifest = (await readJson(join(dir, 'package.json'))) as InstalledManifest;
    for (const [name, version] of Object.entries(manifest.dependencies ?? {}))
      if (!version.startsWith('workspace:')) seeds.push(await findInstalledPackage(name, dir));
  }
  const closure = await installedClosure(seeds);
  console.log(`PACK ${closure.size} real installed dependency versions`);
  const tarballs = join(root, 'external-tarballs');
  await mkdir(tarballs);
  const packed = await packInstalledPackages(
    closure,
    tarballs,
    join(root, 'pack-cache'),
    (command, args, options) =>
      runOrThrow(command, args, { ...options, env: { ...process.env, ...options.env } }),
  );
  const entries = await registryEntries(closure, packed);
  const registry = await startInstalledRegistry(entries);
  return { origin: registry.origin, entries: [...entries.values()], close: registry.close };
}
