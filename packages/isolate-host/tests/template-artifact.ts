/**
 * A real `produceDependencySnapshot` artifact of the four document libraries (template goal,
 * carrier): the libraries' installed closure npm-packed and served by a loopback registry (the
 * packed-consumer gate's helpers — no network), a lock from `npm install --package-lock-only`
 * against it, then workbench's producer, as a service's CI runs it.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { produceDependencySnapshot } from '@riftydev/workbench';
import {
  findInstalledPackage,
  installedClosure,
  packInstalledPackages,
  registryEntries,
  startInstalledRegistry,
} from '../../../tests/integration/installed-registry.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');

/** The four libraries at the library probe's lock versions. */
export const LIBRARIES = {
  docx: '9.15.3',
  exceljs: '4.4.0',
  'pdf-lib': '1.17.1',
  pptxgenjs: '4.0.1',
} as const;

export const TEMPLATE_ID = 'four-document-libraries';

export interface Artifact {
  readonly archive: Uint8Array;
  readonly encoding: 'gzip' | 'br';
  readonly snapshotId: string;
}

interface Registry {
  readonly origin: string;
  close(): Promise<void>;
}

let registry: Promise<Registry> | undefined;

async function startRegistry(): Promise<Registry> {
  const seeds = await Promise.all(
    Object.keys(LIBRARIES).map((name) => findInstalledPackage(name, packageRoot)),
  );
  const closure = await installedClosure(seeds);
  // Packing ~200 packages takes a while: kept per closure, under node_modules/.cache.
  const key = createHash('sha256')
    .update([...closure.keys()].sort().join('\n'))
    .digest('hex')
    .slice(0, 16);
  const cache = join(packageRoot, 'node_modules/.cache/template-artifact', key);
  if (!existsSync(join(cache, 'done'))) {
    const staging = mkdtempSync(join(tmpdir(), 'template-artifact-pack-'));
    const tarballs = join(staging, 'tarballs');
    mkdirSync(tarballs);
    const packed = await packInstalledPackages(
      closure,
      tarballs,
      join(staging, 'npm-cache'),
      (command, args, options) =>
        run(command, args, {
          cwd: options.cwd,
          timeout: options.timeoutMs,
          env: { ...process.env, ...options.env },
        }),
    );
    const names: Record<string, string> = {};
    for (const [identity, file] of packed) names[identity] = file.slice(tarballs.length + 1);
    writeFileSync(join(tarballs, 'index.json'), JSON.stringify(names));
    writeFileSync(join(tarballs, 'done'), '');
    mkdirSync(dirname(cache), { recursive: true });
    renameSync(tarballs, cache);
  }
  const index = JSON.parse(readFileSync(join(cache, 'index.json'), 'utf8')) as Record<
    string,
    string
  >;
  const tarballs = new Map(Object.entries(index).map(([id, file]) => [id, join(cache, file)]));
  const served = await startInstalledRegistry(await registryEntries(closure, tarballs));
  return { origin: served.origin, close: () => served.close() };
}

/** `package.json` + the lock npm writes for `dependencies` against the loopback registry. */
async function project(
  origin: string,
  dependencies: Readonly<Record<string, string>>,
): Promise<{ packageJsonText: string; packageLockText: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'template-artifact-project-'));
  const packageJsonText = `${JSON.stringify(
    { name: 'document-service', private: true, version: '1.0.0', dependencies },
    null,
    2,
  )}\n`;
  writeFileSync(join(dir, 'package.json'), packageJsonText);
  await run(
    'npm',
    [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      `--registry=${origin}`,
    ],
    {
      cwd: dir,
      timeout: 120_000,
      env: { ...process.env, npm_config_cache: join(dir, '.npm-cache') },
    },
  );
  return { packageJsonText, packageLockText: readFileSync(join(dir, 'package-lock.json'), 'utf8') };
}

const artifacts = new Map<string, Promise<Artifact>>();

/**
 * The artifact of `libraries` for `encoding` × `profile`, produced once per test process. The
 * producer's br (quality 11) over the four libraries takes ~90 s: the br case uses one library.
 */
export function libraryArtifact(
  encoding: 'gzip' | 'br' = 'gzip',
  profile: 'replay' | 'frozen' = 'frozen',
  libraries: Readonly<Record<string, string>> = LIBRARIES,
): Promise<Artifact> {
  const key = `${encoding}/${profile}/${Object.keys(libraries).join(',')}`;
  let artifact = artifacts.get(key);
  if (artifact === undefined) {
    registry ??= startRegistry();
    artifact = registry.then(async (r) => {
      const produced = await produceDependencySnapshot({
        templateId: TEMPLATE_ID,
        ...(await project(r.origin, libraries)),
        registryUrl: r.origin,
        profile,
        encoding,
      });
      return {
        archive: produced.archive,
        encoding: produced.contentEncoding,
        snapshotId: produced.snapshotId,
      };
    });
    artifacts.set(key, artifact);
  }
  return artifact;
}

/** The loopback registry stops (an `afterAll`). */
export async function closeRegistry(): Promise<void> {
  const r = registry;
  registry = undefined;
  if (r !== undefined) await (await r).close();
}
