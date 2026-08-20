import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import type { Packument, RegistryRequestOptions, VersionManifest } from '../registry.ts';
import { RegistryClient } from '../registry.ts';
import { type TarballCache, computeIntegrity } from '../tarball-cache.ts';
import { TAR_TRAILER, buildHeader, concat, gzip, padToBlock } from './tar-builder.ts';

export const SASS_TRIGGER = 'sass-embedded';
export const SASS_TRIGGER_VERSION = '1.100.0';
export const SASS_SOURCE = 'sass';
export const SASS_SOURCE_VERSION = '1.100.0';
export const SASS_RECIPE_ID = 'rifty.shadow-substitution.sass-embedded.v2';
export const SASS_SOURCE_URL = 'https://registry.npmjs.org/sass/-/sass-1.100.0.tgz';
export const SASS_SOURCE_INTEGRITY =
  'sha512-B5j0rYMlinhhOo9tjQebMVVn0TfyXAF+wB3b2ggZUuJ/is/Y+7+JGjirAMxHZ9Z3hIP98NPfamlAkBHa1lAaXQ==';

export const SASS_REQUIRED_DEPENDENCIES = Object.freeze({
  chokidar: '^5.0.0',
  immutable: '^5.1.5',
  'source-map-js': '>=0.6.2 <2.0.0',
});
export const SASS_OMITTED_OPTIONAL_DEPENDENCIES = Object.freeze({
  '@parcel/watcher': '^2.4.1',
});

export interface FixtureManifest extends VersionManifest {
  readonly bundleDependencies?: readonly string[];
  readonly bundledDependencies?: readonly string[];
}

export interface RegistryEntry {
  readonly manifest: FixtureManifest;
  readonly tarball: Uint8Array;
}

interface ClosureFixtureEntry {
  readonly name: string;
  readonly range: string;
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly integrity: string;
  readonly tarball: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface ClosureFixture {
  readonly root: string;
  readonly packages: readonly ClosureFixtureEntry[];
  readonly omittedOptionalDependencies: Readonly<Record<string, string>>;
}

interface RegistryFixture {
  readonly name: string;
  readonly version: string;
  readonly dist: Readonly<{ readonly integrity: string }>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly bundleDependencies: readonly string[];
  readonly bin: Readonly<Record<string, string>>;
}

const FIXTURE_ROOT = new URL('../../../../tools/shadow-registry/src/fixtures/', import.meta.url);

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, FIXTURE_ROOT), 'utf8')) as T;
}

/** Official npm artifacts; no generated archive carries Sass or its required closure. */
export async function loadOfficialSassEntries(): Promise<readonly RegistryEntry[]> {
  const [registry, closure, sassTarball] = await Promise.all([
    readJson<RegistryFixture>('sass-1.100.0-registry.json'),
    readJson<ClosureFixture>('sass-1.100.0-closure.json'),
    readFile(new URL('sass-1.100.0.tgz', FIXTURE_ROOT)),
  ]);
  if (
    registry.name !== SASS_SOURCE ||
    registry.version !== SASS_SOURCE_VERSION ||
    registry.dist.integrity !== SASS_SOURCE_INTEGRITY ||
    closure.root !== `${SASS_SOURCE}@${SASS_SOURCE_VERSION}`
  ) {
    throw new Error('official Sass fixture identity drifted');
  }

  const source: RegistryEntry = {
    manifest: {
      name: registry.name,
      version: registry.version,
      dependencies: { ...registry.dependencies },
      optionalDependencies: { ...registry.optionalDependencies },
      peerDependencies: { ...registry.peerDependencies },
      bundleDependencies: [...registry.bundleDependencies],
      bin: { ...registry.bin },
      dist: { tarball: SASS_SOURCE_URL, integrity: registry.dist.integrity },
    },
    tarball: new Uint8Array(sassTarball),
  };
  const required = await Promise.all(
    closure.packages.map(
      async (candidate): Promise<RegistryEntry> => ({
        manifest: {
          name: candidate.name,
          version: candidate.version,
          dependencies: { ...candidate.dependencies },
          dist: { tarball: candidate.tarball, integrity: candidate.integrity },
        },
        tarball: new Uint8Array(
          await readFile(new URL(`${candidate.name}-${candidate.version}.tgz`, FIXTURE_ROOT)),
        ),
      }),
    ),
  );
  return [source, ...required];
}

/** Generated only for neutral topology/injection carriers, never Sass behavior. */
export async function auxiliaryRegistryEntry(
  name: string,
  version: string,
  dependencies: Readonly<Record<string, string>> = {},
  extraManifestFields: Readonly<Partial<FixtureManifest>> = {},
): Promise<RegistryEntry> {
  const manifestFields = {
    name,
    version,
    dependencies: { ...dependencies },
    ...extraManifestFields,
  };
  const packageJson = new TextEncoder().encode(JSON.stringify(manifestFields));
  const tarball = await gzip(
    concat(
      buildHeader('package/package.json', packageJson.length),
      padToBlock(packageJson),
      TAR_TRAILER,
    ),
  );
  return {
    manifest: {
      ...manifestFields,
      dist: {
        tarball: `https://fixture.invalid/${encodeURIComponent(name)}-${version}.tgz`,
        integrity: await computeIntegrity(tarball),
      },
    },
    tarball,
  };
}

export type OneShotTarballFault =
  | Readonly<{ readonly kind: 'corrupt'; readonly packageName: string }>
  | Readonly<{ readonly kind: 'partial'; readonly packageName: string }>
  | Readonly<{
      readonly kind: 'stall';
      readonly packageName: string;
      readonly reached: () => void;
      readonly release: Promise<void>;
    }>
  | Readonly<{ readonly error: Error; readonly kind: 'throw'; readonly packageName: string }>;

function corruptBytes(bytes: Uint8Array): Uint8Array {
  const corrupted = bytes.slice();
  const index = Math.floor(corrupted.length / 2);
  corrupted[index] = (corrupted[index] ?? 0) ^ 0xff;
  return corrupted;
}

function waitForRelease(release: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) return release;
  if (signal.aborted) {
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    release.then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export class SassFixtureRegistry extends RegistryClient {
  readonly packumentReads: string[] = [];
  readonly tarballReads: string[] = [];
  readonly #byName: ReadonlyMap<string, ReadonlyMap<string, RegistryEntry>>;
  readonly #byUrl: ReadonlyMap<string, RegistryEntry>;
  #fault: OneShotTarballFault | undefined;

  constructor(entries: readonly RegistryEntry[], fault?: OneShotTarballFault) {
    super({
      baseUrl: '/sass-contract-registry',
      fetch: async () => new Response('', { status: 599 }),
    });
    const grouped = new Map<string, Map<string, RegistryEntry>>();
    for (const entry of entries) {
      const versions = grouped.get(entry.manifest.name) ?? new Map<string, RegistryEntry>();
      versions.set(entry.manifest.version, entry);
      grouped.set(entry.manifest.name, versions);
    }
    this.#byName = grouped;
    this.#byUrl = new Map(entries.map((entry) => [entry.manifest.dist.tarball, entry]));
    this.#fault = fault;
  }

  override async getPackument(name: string): Promise<Packument> {
    this.packumentReads.push(name);
    const versions = this.#byName.get(name);
    if (!versions) {
      throw new Error(`Sass contract forbids registry packument ${name}`);
    }
    const latest = [...versions.keys()].sort().at(-1);
    if (!latest) throw new Error(`Sass contract fixture has no version of ${name}`);
    return {
      name,
      'dist-tags': { latest },
      versions: Object.fromEntries(
        [...versions].map(([version, entry]) => [version, entry.manifest]),
      ),
    };
  }

  override async getTarball(
    url: string,
    options: RegistryRequestOptions = {},
  ): Promise<Uint8Array> {
    const entry = this.#byUrl.get(url);
    if (!entry) throw new Error(`Sass contract forbids registry tarball ${url}`);
    this.tarballReads.push(url);
    const fault = this.#fault;
    if (fault?.packageName === entry.manifest.name) {
      this.#fault = undefined;
      if (fault.kind === 'throw') throw fault.error;
      if (fault.kind === 'stall') {
        fault.reached();
        await waitForRelease(fault.release, options.signal);
        return entry.tarball.slice();
      }
      if (fault.kind === 'partial') {
        return entry.tarball.slice(0, Math.max(1, Math.floor(entry.tarball.length / 2)));
      }
      return corruptBytes(entry.tarball);
    }
    return entry.tarball.slice();
  }
}

function tarText(bytes: Uint8Array, start: number, length: number): string {
  const field = bytes.subarray(start, start + length);
  const nul = field.indexOf(0);
  return new TextDecoder().decode(nul === -1 ? field : field.subarray(0, nul));
}

function tarSize(bytes: Uint8Array, offset: number): number {
  const value = tarText(bytes, offset + 124, 12).trim();
  if (!/^[0-7]+$/.test(value)) throw new Error(`official fixture has invalid tar size ${value}`);
  return Number.parseInt(value, 8);
}

function paxPath(bytes: Uint8Array): string | undefined {
  const text = new TextDecoder().decode(bytes);
  for (const line of text.split('\n')) {
    const record = /^\d+ path=(.*)$/.exec(line);
    if (record?.[1]) return record[1];
  }
  return undefined;
}

/** Test-only tar reader, independent of npm-client's production archive extractor. */
export function officialArchiveFiles(entry: RegistryEntry): Readonly<Record<string, Uint8Array>> {
  const archive = new Uint8Array(gunzipSync(entry.tarball));
  const files: Record<string, Uint8Array> = {};
  let offset = 0;
  let pendingPath: string | undefined;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = tarSize(archive, offset);
    const type = String.fromCharCode(header[156] ?? 0);
    const bodyStart = offset + 512;
    const body = archive.subarray(bodyStart, bodyStart + size);
    const name = tarText(archive, offset, 100);
    const prefix = tarText(archive, offset + 345, 155);
    const headerPath = prefix ? `${prefix}/${name}` : name;
    if (type === 'L') {
      pendingPath = new TextDecoder().decode(body).replace(/\0+$/, '');
    } else if (type === 'x') {
      pendingPath = paxPath(body) ?? pendingPath;
    } else if (type === '0' || type === '\0') {
      const archivePath = pendingPath ?? headerPath;
      pendingPath = undefined;
      if (archivePath.startsWith('package/')) {
        files[archivePath.slice('package/'.length)] = body.slice();
      }
    } else if (type !== '5') {
      pendingPath = undefined;
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

export class DenyAllRegistry extends RegistryClient {
  readonly reads: string[] = [];

  constructor() {
    super({ baseUrl: '/deny-all-registry', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    this.reads.push(`packument:${name}`);
    throw new Error(`offline Sass replay attempted packument ${name}`);
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    this.reads.push(`tarball:${url}`);
    throw new Error(`offline Sass replay attempted tarball ${url}`);
  }
}

function cacheKey(name: string, version: string, integrity: string): string {
  return `${name}\0${version}\0${integrity}`;
}

function entryCacheKey(entry: RegistryEntry): string {
  const integrity = entry.manifest.dist.integrity;
  if (!integrity) throw new Error(`${entry.manifest.name} fixture has no integrity`);
  return cacheKey(entry.manifest.name, entry.manifest.version, integrity);
}

export class LedgerTarballCache implements TarballCache {
  readonly gets: string[] = [];
  readonly puts: string[] = [];
  readonly #entries: Map<string, Uint8Array>;

  constructor(entries: ReadonlyMap<string, Uint8Array> = new Map()) {
    this.#entries = new Map([...entries].map(([key, bytes]) => [key, bytes.slice()] as const));
  }

  async get(name: string, version: string, integrity: string): Promise<Uint8Array | null> {
    this.gets.push(`${name}@${version} ${integrity}`);
    return this.#entries.get(cacheKey(name, version, integrity))?.slice() ?? null;
  }

  async put(name: string, version: string, integrity: string, bytes: Uint8Array): Promise<string> {
    this.puts.push(`${name}@${version} ${integrity}`);
    this.#entries.set(cacheKey(name, version, integrity), bytes.slice());
    return `memory:${name}@${version}`;
  }

  seed(entry: RegistryEntry, bytes: Uint8Array = entry.tarball): void {
    this.#entries.set(entryCacheKey(entry), bytes.slice());
  }

  delete(entry: RegistryEntry): void {
    this.#entries.delete(entryCacheKey(entry));
  }

  corrupt(entry: RegistryEntry): void {
    this.seed(entry, corruptBytes(entry.tarball));
  }

  clone(): LedgerTarballCache {
    return new LedgerTarballCache(this.#entries);
  }

  clearLedger(): void {
    this.gets.length = 0;
    this.puts.length = 0;
  }
}
