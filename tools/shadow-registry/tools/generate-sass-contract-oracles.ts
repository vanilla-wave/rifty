import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type SassContractApi,
  type SassContractModules,
  type SassContractTranscript,
  probeSassContract,
} from '../src/test-sass-contract-probe.ts';

interface PackageManifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly exports?: unknown;
}

interface PackageLockEntry {
  readonly version?: unknown;
  readonly integrity?: unknown;
}

interface PackageLock {
  readonly packages?: Readonly<Record<string, PackageLockEntry>>;
}

const fixtureRoot = new URL('../src/fixtures/', import.meta.url);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileIdentity(root: string, path: string) {
  const bytes = await readFile(path);
  return {
    path: relative(root, path),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} is not a string`);
  return value;
}

function esmEntry(root: string, name: 'sass' | 'sass-embedded', manifest: PackageManifest): string {
  const exports = manifest.exports;
  if (exports === null || typeof exports !== 'object' || Array.isArray(exports)) {
    throw new TypeError(`${name} exports is not an object`);
  }
  const record = exports as Readonly<Record<string, unknown>>;
  if (name === 'sass') {
    const node = record.node;
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      throw new TypeError('sass node exports is not an object');
    }
    return join(root, stringField((node as Readonly<Record<string, unknown>>).default, 'sass ESM'));
  }
  const imported = record.import;
  if (imported === null || typeof imported !== 'object' || Array.isArray(imported)) {
    throw new TypeError('sass-embedded import exports is not an object');
  }
  return join(
    root,
    stringField((imported as Readonly<Record<string, unknown>>).default, 'sass-embedded ESM'),
  );
}

async function packageModules(
  projectRoot: string,
  name: 'sass' | 'sass-embedded',
): Promise<{
  readonly modules: SassContractModules;
  readonly identity: Readonly<Record<string, unknown>>;
}> {
  const packageRoot = join(projectRoot, 'node_modules', name);
  const packageJsonPath = join(packageRoot, 'package.json');
  const packageJsonBytes = await readFile(packageJsonPath);
  const manifest = JSON.parse(packageJsonBytes.toString('utf8')) as PackageManifest;
  if (manifest.name !== name || manifest.version !== '1.100.0') {
    throw new Error(`${name} must resolve to exact 1.100.0`);
  }

  const projectRequire = createRequire(join(projectRoot, 'package.json'));
  const cjsEntry = projectRequire.resolve(name);
  const esmPath = esmEntry(packageRoot, name, manifest);
  const cjs = projectRequire(name) as SassContractApi & Readonly<Record<string, unknown>>;
  const esm = (await import(`${pathToFileURL(esmPath).href}?sass-contract-oracle`)) as Readonly<
    Record<string, unknown>
  >;
  const lock = JSON.parse(
    await readFile(join(projectRoot, 'package-lock.json'), 'utf8'),
  ) as PackageLock;
  const lockEntry = lock.packages?.[`node_modules/${name}`];
  if (lockEntry?.version !== '1.100.0' || typeof lockEntry.integrity !== 'string') {
    throw new Error(`${name} lock identity is missing`);
  }

  return {
    modules: { cjs, esm },
    identity: {
      name,
      version: manifest.version,
      integrity: lockEntry.integrity,
      packageJson: {
        path: relative(projectRoot, packageJsonPath),
        bytes: packageJsonBytes.byteLength,
        sha256: sha256(packageJsonBytes),
      },
      cjsEntry: await fileIdentity(projectRoot, cjsEntry),
      esmEntry: await fileIdentity(projectRoot, esmPath),
    },
  };
}

async function platformPackageIdentity(
  projectRoot: string,
): Promise<Readonly<Record<string, unknown>>> {
  const nodeModules = join(projectRoot, 'node_modules');
  const candidates = (await readdir(nodeModules)).filter(
    (name) => name.startsWith('sass-embedded-') && name !== 'sass-embedded',
  );
  if (candidates.length !== 1) {
    throw new Error(
      `expected one installed sass-embedded platform package, got ${candidates.length}`,
    );
  }
  const name = candidates[0]!;
  const packageJsonPath = join(nodeModules, name, 'package.json');
  const bytes = await readFile(packageJsonPath);
  const manifest = JSON.parse(bytes.toString('utf8')) as PackageManifest;
  const lock = JSON.parse(
    await readFile(join(projectRoot, 'package-lock.json'), 'utf8'),
  ) as PackageLock;
  const lockEntry = lock.packages?.[`node_modules/${name}`];
  if (
    manifest.name !== name ||
    manifest.version !== '1.100.0' ||
    typeof lockEntry?.integrity !== 'string'
  ) {
    throw new Error(`${name} exact lock identity is missing`);
  }
  return {
    name,
    version: manifest.version,
    integrity: lockEntry.integrity,
    packageJson: {
      path: relative(projectRoot, packageJsonPath),
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    },
  };
}

async function expectedArtifacts(projectRoot: string) {
  if (process.version !== 'v24.16.0') {
    throw new Error(`Sass oracle requires Node v24.16.0, got ${process.version}`);
  }
  const sass = await packageModules(projectRoot, 'sass');
  const embedded = await packageModules(projectRoot, 'sass-embedded');
  const compilerRoot = await mkdtemp(join(tmpdir(), '.rifty-sass-contract-compiler-'));
  try {
    const compilerPath = join(compilerRoot, 'compiler.scss');
    await writeFile(compilerPath, '$contract: true;\n');
    const compilerUrl = pathToFileURL(compilerPath).href;
    const options = {
      compilerPath,
      normalizeCompilerUrl(url: URL): string {
        const value = String(url);
        return value === compilerUrl ? 'file:///contract/compiler.scss' : value;
      },
    };
    const transcripts: Readonly<Record<string, SassContractTranscript>> = {
      'sass-1.100.0-contract.json': await probeSassContract(sass.modules, 'sass@1.100.0', options),
      'sass-embedded-1.100.0-contract.json': await probeSassContract(
        embedded.modules,
        'sass-embedded@1.100.0',
        options,
      ),
    };
    return {
      ...transcripts,
      'sass-1.100.0-node-oracle-environment.json': {
        schema: 1,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        packages: [sass.identity, embedded.identity],
        platformPackage: await platformPackageIdentity(projectRoot),
      },
    };
  } finally {
    await rm(compilerRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const requestedRoot = process.argv[3] ? resolve(process.argv[3]) : undefined;
  if ((mode !== '--write' && mode !== '--check') || requestedRoot === undefined) {
    throw new Error('usage: generate-sass-contract-oracles.ts --write|--check <oracle-project>');
  }
  const projectRoot = await realpath(requestedRoot);
  const artifacts = await expectedArtifacts(projectRoot);
  for (const [name, value] of Object.entries(artifacts)) {
    const expected = `${JSON.stringify(value, null, 2)}\n`;
    const output = new URL(name, fixtureRoot);
    if (mode === '--write') {
      await writeFile(output, expected);
    } else if ((await readFile(output, 'utf8')) !== expected) {
      throw new Error(`${name} drifted; run the Sass oracle generator`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
