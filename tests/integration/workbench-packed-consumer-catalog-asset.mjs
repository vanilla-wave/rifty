import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export async function findInstalledPackage(name, startingDirectory) {
  let directory = startingDirectory;
  while (true) {
    const candidate = resolve(directory, 'node_modules', ...name.split('/'));
    try {
      return await realpath(candidate);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Cannot resolve installed package ${name} from ${startingDirectory}`);
    }
    directory = parent;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function resolveDeclaredCatalogAsset(options) {
  const producerManifest = await readJson(resolve(options.producerRoot, 'package.json'));
  const declaredVersion = producerManifest.devDependencies?.[options.name];
  if (declaredVersion !== options.version) {
    throw new Error(
      `${producerManifest.name ?? options.producerRoot} must declare exact ${options.name}@${options.version}; found ${String(declaredVersion)}`,
    );
  }
  if (typeof options.integrity !== 'string' || !options.integrity.startsWith('sha512-')) {
    throw new Error(`Catalog asset ${options.name}@${options.version} lacks sha512 integrity`);
  }

  const dir = await findInstalledPackage(options.name, options.producerRoot);
  const manifest = await readJson(resolve(dir, 'package.json'));
  if (manifest.name !== options.name || manifest.version !== options.version) {
    throw new Error(
      `Installed catalog asset mismatch: expected ${options.name}@${options.version}, got ${String(manifest.name)}@${String(manifest.version)}`,
    );
  }
  return { dir, manifest, expectedIntegrity: options.integrity };
}
