/**
 * `install()` honours npm's override value spellings (I1, ADR-0451): the same
 * manifests the npm 11.17.0 oracle installed with `--package-lock-only`
 * (`docs/backlog/npm-client/reference/overrides-bare-version-spec-probe-output.json`)
 * run through rifty's real installer, VFS, walk and lock writer. Only the
 * network boundary is replaced: packuments are rebuilt from the probe's
 * recorded registry facts — including the real packages literally named `2`,
 * `x`, `latest`, `beta` that a name misparse silently installs.
 */
import { readFile } from 'node:fs/promises';
import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import { type Packument, RegistryClient, type VersionManifest } from './registry.ts';

type Manifest = Readonly<Record<string, unknown>>;

interface InstallRow {
  readonly id: string;
  readonly before?: Manifest;
  readonly manifest: Manifest & Readonly<{ overrides?: Readonly<Record<string, string>> }>;
  readonly npa?: Readonly<{ type?: string; fetchSpec?: string; error?: string }>;
  readonly exit: number;
  readonly entries?: Readonly<Record<string, Readonly<{ name?: string; version: string }>>>;
}

interface RegistryFacts {
  readonly ms: Readonly<{ versions: readonly string[]; distTags: Record<string, string> }>;
  readonly 'debug@4.3.4': Readonly<{ dependencies: Record<string, string> }>;
  readonly decoys: Readonly<Record<string, string>>;
  readonly 'vitest@4.1.11': Readonly<{ vite: string }>;
  readonly vite: Readonly<{ has8016: boolean; latest: string }>;
}

interface Oracle {
  readonly node: string;
  readonly npm: string;
  readonly installs: readonly InstallRow[];
  readonly registryFacts: RegistryFacts;
}

const oracle = JSON.parse(
  await readFile(
    new URL(
      '../../../docs/backlog/npm-client/reference/overrides-bare-version-spec-probe-output.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Oracle;

function packument(
  name: string,
  versions: Readonly<Record<string, Record<string, string>>>,
  distTags: Record<string, string>,
): Packument {
  const out: Record<string, VersionManifest> = {};
  for (const [version, dependencies] of Object.entries(versions)) {
    out[version] = {
      name,
      version,
      dependencies,
      dist: { tarball: `oracle://${encodeURIComponent(name)}/${version}` },
    };
  }
  return { name, 'dist-tags': distTags, versions: out };
}

/** Real registry state from the probe; only the transport is in-memory. */
class OracleRegistry extends RegistryClient {
  readonly requested: string[] = [];
  private readonly packuments = new Map<string, Packument>();

  constructor(facts: RegistryFacts) {
    super({ baseUrl: '/oracle', fetch: async () => new Response('', { status: 599 }) });
    const ms = Object.fromEntries(facts.ms.versions.map((version) => [version, {}]));
    this.packuments.set('ms', packument('ms', ms, facts.ms.distTags));
    this.packuments.set(
      'debug',
      packument('debug', { '4.3.4': facts['debug@4.3.4'].dependencies }, { latest: '4.3.4' }),
    );
    for (const [name, latest] of Object.entries(facts.decoys)) {
      this.packuments.set(name, packument(name, { [latest]: {} }, { latest }));
    }
    this.packuments.set(
      'vitest',
      packument(
        'vitest',
        { '4.1.11': { vite: facts['vitest@4.1.11'].vite } },
        { latest: '4.1.11' },
      ),
    );
    if (!facts.vite.has8016) throw new Error('oracle registry lost vite 8.0.16');
    this.packuments.set(
      'vite',
      packument('vite', { '8.0.16': {}, [facts.vite.latest]: {} }, { latest: facts.vite.latest }),
    );
  }

  override async getPackument(name: string): Promise<Packument> {
    this.requested.push(name);
    const found = this.packuments.get(name);
    if (!found) throw new Error(`Failed to fetch packument ${name}: 404`);
    return found;
  }

  override async getTarball(tarballUrl: string): Promise<Uint8Array> {
    const match = /^oracle:\/\/([^/]+)\/(.+)$/.exec(tarballUrl);
    if (!match?.[1] || !match[2]) throw new Error(`bad oracle tarball url ${tarballUrl}`);
    return makePackageTarball(decodeURIComponent(match[1]), match[2]);
  }
}

async function riftyInstall(row: InstallRow, manifest: Manifest = row.manifest) {
  const registry = new OracleRegistry(oracle.registryFacts);
  const vfs = new MemoryVfs();
  await vfs.mkdir('/proj', { recursive: true });
  if (row.before !== undefined) {
    await vfs.writeFile('/proj/package.json', JSON.stringify(row.before));
    await install({ vfs, cwd: '/proj', registry });
  }
  await vfs.writeFile('/proj/package.json', JSON.stringify(manifest));
  registry.requested.length = 0;
  const result = await install({ vfs, cwd: '/proj', registry });
  return { result, registry, vfs };
}

const scenario = (id: string) => id.startsWith('scenario');
const watchedName = (row: InstallRow) => (scenario(row.id) ? 'vite' : 'ms');
const dependentPath = (row: InstallRow) =>
  scenario(row.id) ? 'node_modules/vitest' : 'node_modules/debug';

/** Node resolution from the dependent: nearest `node_modules/<watched>` walking up. */
function versionSeenByDependent(
  packages: Readonly<Record<string, Readonly<{ version?: string }>>>,
  row: InstallRow,
): string | undefined {
  const name = watchedName(row);
  return (
    packages[`${dependentPath(row)}/node_modules/${name}`]?.version ??
    packages[`node_modules/${name}`]?.version
  );
}

function row(id: string): InstallRow {
  const found = oracle.installs.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`oracle row ${id} missing`);
  return found;
}

/**
 * Claimed: npm version/range readings, the `latest` dist-tag, and the no-op
 * values. Out: hyphen ranges (rifty's semver matcher lacks them for every
 * spec), other dist-tags, alias placement, `$ref` (loud below) — ADR-0451.
 */
const claimed = oracle.installs.filter(
  (candidate) =>
    candidate.exit === 0 &&
    candidate.id !== 'hyphen' &&
    (candidate.npa === undefined ||
      candidate.npa.type === 'version' ||
      candidate.npa.type === 'range' ||
      (candidate.npa.type === 'tag' && candidate.npa.fetchSpec === 'latest')),
);

describe('install() — npm override value spellings (npm 11.17.0 lock oracle)', () => {
  it('oracle identity and selection', () => {
    expect([oracle.node, oracle.npm]).toEqual(['v24.16.0', '11.17.0']);
    expect(claimed.length).toBeGreaterThan(10);
  });

  it.each(claimed)(
    '$id: the dependent resolves the version npm locks, no misparsed package → I1, ADR-0451',
    async (oracleRow) => {
      const { result, registry } = await riftyInstall(oracleRow);
      const packages = result.lockfile.packages;
      const name = watchedName(oracleRow);
      const npmEntries = oracleRow.entries ?? {};
      const npmSeen = versionSeenByDependent(npmEntries, oracleRow);
      expect(npmSeen).toBeDefined();
      expect(versionSeenByDependent(packages, oracleRow)).toBe(npmSeen);
      const installed = Object.keys(packages).filter((path) => path !== '');
      expect(installed.filter((path) => path.endsWith(`node_modules/${name}`))).toHaveLength(1);
      expect(
        installed.filter(
          (path) => path !== dependentPath(oracleRow) && !path.endsWith(`node_modules/${name}`),
        ),
      ).toEqual([]);
      const known = [dependentPath(oracleRow).slice('node_modules/'.length), name];
      expect(registry.requested.filter((requested) => !known.includes(requested))).toEqual([]);
      // Fresh installs also match npm's placement (one hoisted copy).
      if (oracleRow.before === undefined) {
        for (const [path, entry] of Object.entries(npmEntries)) {
          expect(packages[path]?.version, path).toBe(entry.version);
        }
      }
    },
  );

  it('the rifty `name@range` spelling installs the tree npm installs for the bare version → I1', async () => {
    for (const [extension, bare] of [
      ['rifty-name-at-range', 'exact'],
      ['scenario-vitest-vite', 'scenario-vitest-vite'],
    ] as const) {
      const bareRow = row(bare);
      const key = scenario(bare) ? 'vite' : 'ms';
      const manifest = {
        ...row(extension).manifest,
        overrides: { [key]: `${key}@${bareRow.npa?.fetchSpec}` },
      };
      const { result } = await riftyInstall(row(extension), manifest);
      expect(versionSeenByDependent(result.lockfile.packages, bareRow), extension).toBe(
        versionSeenByDependent(bareRow.entries ?? {}, bareRow),
      );
    }
  });

  it('`$ref` overrides (npm resolves them) are a named loud gap before any registry read → ADR-0451', async () => {
    const reference = row('reference');
    expect(reference.exit).toBe(0);
    const registry = new OracleRegistry(oracle.registryFacts);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile('/proj/package.json', JSON.stringify(reference.manifest));
    const error = await install({ vfs, cwd: '/proj', registry }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(NotImplementedError);
    expect((error as NotImplementedError).feature).toBe(
      'npm-client.dependency-spec.override-reference',
    );
    expect(registry.requested).toEqual([]);
  });
});
