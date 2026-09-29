/**
 * An npm version/range override IS the overridden edge's spec (npm 11.17.0
 * Arborist `edge.js` `get spec`, probe evidence in
 * `docs/backlog/npm-client/reference/overrides-bare-version-spec-evidence.md`),
 * not a substitution (ADR-0451): `install()` with `overrides: {N: V}` must end
 * exactly as the install where the dependent itself declares `N@V` — rifty's
 * per-package policies (ADR-0051 native gate on live resolve and lock replay,
 * baked redirects, builtin shadow recipes) apply unchanged. Rifty-dialect
 * targets keep ADR-0051's override exemption (the documented self-map escape
 * hatch). Only the network boundary is in-memory.
 */
import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import { type Packument, RegistryClient, type VersionManifest } from './registry.ts';

type Edges = Readonly<Record<string, string>>;
type Kind = 'dependencies' | 'optionalDependencies';

interface Release {
  readonly name: string;
  readonly version: string;
  readonly fields?: Partial<VersionManifest>;
}

const NATIVE = { cpu: ['x64'], os: ['linux'] };

/** Real-shaped packuments: a cpu-pinned native, a builtin recipe trigger and
 * its registry acquisition, a baked-redirect pair. */
const RELEASES: readonly Release[] = [
  { name: 'native-bin', version: '1.0.0', fields: NATIVE },
  { name: 'native-bin', version: '1.1.0', fields: NATIVE },
  { name: 'esbuild', version: '0.25.0' },
  { name: 'esbuild', version: '0.27.0' },
  { name: 'esbuild', version: '0.28.0' },
  { name: 'esbuild-wasm', version: '0.28.0' },
  { name: 'bcrypt', version: '5.1.1' },
  { name: 'bcryptjs', version: '2.4.3' },
];

class PolicyRegistry extends RegistryClient {
  private readonly packuments = new Map<string, Packument>();

  constructor(hosts: readonly Readonly<{ version: string; kind: Kind; edges: Edges }>[]) {
    super({ baseUrl: '/policy', fetch: async () => new Response('', { status: 599 }) });
    const releases: Release[] = [
      ...RELEASES,
      ...hosts.map(({ version, kind, edges }) => ({
        name: 'host',
        version,
        fields: { [kind]: edges },
      })),
    ];
    for (const { name, version, fields } of releases) {
      const packument = this.packuments.get(name) ?? { name, 'dist-tags': {}, versions: {} };
      packument.versions[version] = {
        name,
        version,
        dependencies: {},
        ...fields,
        dist: { tarball: `policy://${name}/${version}` },
      };
      packument['dist-tags'] = { latest: version };
      this.packuments.set(name, packument);
    }
  }

  override async getPackument(name: string): Promise<Packument> {
    const found = this.packuments.get(name);
    if (!found) throw new Error(`Failed to fetch packument ${name}: 404`);
    return found;
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    const match = /^policy:\/\/([^/]+)\/(.+)$/.exec(url);
    if (!match?.[1] || !match[2]) throw new Error(`bad tarball url ${url}`);
    return makePackageTarball(match[1], match[2]);
  }
}

interface Step {
  readonly host: string;
  readonly overrides?: Edges;
}

/** Everything but the dependent: installed entries or the failure's identity. */
async function outcome(
  hosts: readonly Readonly<{ version: string; kind: Kind; edges: Edges }>[],
  steps: readonly Step[],
): Promise<unknown> {
  const registry = new PolicyRegistry(hosts);
  const vfs = new MemoryVfs();
  await vfs.mkdir('/proj', { recursive: true });
  let last: unknown;
  for (const { host, overrides } of steps) {
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { host }, overrides }),
    );
    last = await install({ vfs, cwd: '/proj', registry }).then(
      (result) =>
        Object.fromEntries(
          Object.entries(result.lockfile.packages)
            .filter(([path]) => path !== '' && path !== 'node_modules/host')
            .map(([path, entry]) => [
              path,
              { version: entry.version, recipe: entry.riftyShadowRecipe },
            ]),
        ),
      (error: unknown) =>
        error instanceof NotImplementedError
          ? { notImplemented: error.feature }
          : {
              code: (error as { code?: unknown }).code ?? null,
              packageName: (error as { packageName?: unknown }).packageName ?? null,
              message: (error as { code?: unknown }).code ? null : String(error),
            },
    );
  }
  return last;
}

interface PolicyCase {
  readonly id: string;
  readonly name: string;
  readonly declared: string;
  readonly value: string;
  readonly kind: Kind;
  /** Lock written first with the rifty self-map (exempt), then re-installed. */
  readonly replay?: boolean;
}

const CASES: readonly PolicyCase[] = [
  {
    id: 'native required',
    name: 'native-bin',
    declared: '^1.0.0',
    value: '1.0.0',
    kind: 'dependencies',
  },
  {
    id: 'native required range',
    name: 'native-bin',
    declared: '1.0.0',
    value: '^1.0.0',
    kind: 'dependencies',
  },
  {
    id: 'native optional',
    name: 'native-bin',
    declared: '^1.0.0',
    value: '1.0.0',
    kind: 'optionalDependencies',
  },
  {
    id: 'native lock replay',
    name: 'native-bin',
    declared: '^1.0.0',
    value: '1.0.0',
    kind: 'dependencies',
    replay: true,
  },
  {
    id: 'recipe admitted',
    name: 'esbuild',
    declared: '^0.27.0',
    value: '0.28.0',
    kind: 'dependencies',
  },
  {
    id: 'recipe not admitted',
    name: 'esbuild',
    declared: '^0.28.0',
    value: '^0.25.0',
    kind: 'dependencies',
  },
  {
    id: 'baked redirect',
    name: 'bcrypt',
    declared: '^5.0.0',
    value: '2.4.3',
    kind: 'dependencies',
  },
];

describe('install() — an npm version/range override is the edge spec, not a substitution (ADR-0451)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it.each(CASES)(
    '$id: overrides {$name: "$value"} ≡ the dependent declaring $name@$value → ADR-0451, ADR-0051',
    async ({ name, declared, value, kind, replay }) => {
      const hosts = [
        { version: '1.0.0', kind, edges: { [name]: declared } },
        { version: '2.0.0', kind, edges: { [name]: value } },
      ];
      const selfMap = { [name]: `${name}@${value}` };
      const overridden = await outcome(hosts, [
        ...(replay ? [{ host: '1.0.0', overrides: selfMap }] : []),
        { host: '1.0.0', overrides: { [name]: value } },
      ]);
      const declaredEdge = await outcome(hosts, [
        ...(replay ? [{ host: '2.0.0', overrides: selfMap }] : []),
        { host: '2.0.0' },
      ]);
      expect(overridden).toEqual(declaredEdge);
    },
  );

  it.each([
    ['self-map', 'native-bin'],
    ['name@range', 'native-bin@1.0.0'],
  ])(
    'the rifty %s escape hatch stays exempt from the native gate → ADR-0051, ADR-0451',
    async (_spelling, target) => {
      const hosts = [
        { version: '1.0.0', kind: 'dependencies' as const, edges: { 'native-bin': '^1.0.0' } },
      ];
      expect(
        await outcome(hosts, [{ host: '1.0.0', overrides: { 'native-bin': target } }]),
      ).toEqual({
        'node_modules/native-bin': {
          version: target === 'native-bin' ? '1.1.0' : '1.0.0',
          recipe: undefined,
        },
      });
    },
  );
});
