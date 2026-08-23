import { readFile } from 'node:fs/promises';
import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs, type Vfs } from '@riftydev/vfs';
import { expect, it, vi } from 'vitest';
import * as npmClientRoot from './index.ts';
import * as linker from './linker.ts';
const root = 'node_modules';
const nested = `${root}/host/node_modules`;
const ceiling = 'npm-client.bin-collision-reify';
const entrypoints = ['public', 'cancellable', 'prepared'] as const;
const compatUrl = new URL('../../../docs/public/compat/package-tooling.md', import.meta.url);
type Entrypoint = (typeof entrypoints)[number];
type BinSource = linker.PackageBinSource;
type Package = linker.ResolvedPackage;
// biome-ignore format: the exact five-argument seam is clearest on one line.
type PreparedLink = (vfs: Vfs, root: string, packages: readonly linker.PreparedInstallPackage[], checkpoint: () => void, prior?: readonly BinSource[]) => Promise<void>;
// biome-ignore format: equality is one atomic type witness.
type Same<L, R> = (<T>() => T extends L ? 1 : 2) extends <T>() => T extends R ? 1 : 2 ? true : false;
const preparedLink = linker.linkPreparedInstallTree as PreparedLink;

// biome-ignore format: the five type witnesses stay readable as one contract signature.
function provePreparedType(vfs: Vfs, prepared: linker.PreparedInstallPackage, narrow: BinSource, raw: Package, claim: linker.PackageBinClaim): void {
  const exact: Same<typeof linker.linkPreparedInstallTree, PreparedLink> = true;
  void linker.linkPreparedInstallTree(vfs, '/project', [prepared], () => {}, [narrow]);
  // @ts-expect-error Contract: raw packages are not authoritative-prior sources.
  linker.linkPreparedInstallTree(vfs, '/project', [prepared], () => {}, [narrow, raw]);
  // @ts-expect-error Contract: shaped claims are not authoritative-prior sources.
  linker.linkPreparedInstallTree(vfs, '/project', [prepared], () => {}, [narrow, claim]);
  void exact;
}
void provePreparedType;

function pkg(name: string, scope: string, target: string, fileTarget = target): Package {
  // biome-ignore format: fixture fields are one value, not separate behavior.
  return { name, version: '1.0.0', installPath: `${scope}/${name}`, dependencies: {}, bin: { shared: target }, files: { [fileTarget]: new Uint8Array() } };
}

function prior(name: string, scope: string): BinSource {
  return { package: { name, bin: { shared: `bin/${name}.js` } }, nodeModulesDir: scope };
}

// biome-ignore format: compact table builders keep the scenario matrix vertical.
const packages = (scope: string, ...owners: string[]): Package[] => owners.map((owner) => pkg(owner, scope, `bin/${owner}.js`));
// biome-ignore format: compact table builders keep the scenario matrix vertical.
const priors = (scope: string, ...owners: string[]): BinSource[] => owners.map((owner) => prior(owner, scope));

async function project() {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  const mutations = [
    vi.spyOn(vfs, 'writeFile'),
    vi.spyOn(vfs, 'mkdir'),
    vi.spyOn(vfs, 'rm'),
    vi.spyOn(vfs, 'utimes'),
  ];
  return { vfs, mutations };
}

async function linkThrough(
  entrypoint: Entrypoint,
  vfs: Vfs,
  packages: readonly Package[],
  previous: readonly BinSource[] = [],
): Promise<void> {
  if (entrypoint === 'public') return npmClientRoot.link(vfs, '/project', packages);
  if (entrypoint === 'cancellable') {
    return linker.linkInstallTree(vfs, '/project', packages, () => {});
  }
  const prepared = linker.preflightPackageInstallPaths(packages);
  return preparedLink(vfs, '/project', prepared, () => {}, previous);
}

// biome-ignore format: tuple columns mirror the rows below.
type RejectCase = readonly [string, readonly Entrypoint[], readonly Package[], string, readonly BinSource[]];
// biome-ignore format: one compact row per contract scenario.
const rejectedCases: readonly RejectCase[] = [
  ['root forward', entrypoints, packages(root, 'a-cli', 'z-cli'), ceiling, []],
  ['root reverse', entrypoints, packages(root, 'z-cli', 'a-cli'), ceiling, []],
  ['nested forward', entrypoints, packages(nested, 'a-cli', 'z-cli'), ceiling, []],
  ['nested reverse', entrypoints, packages(nested, 'z-cli', 'a-cli'), ceiling, []],
  ['prior collision', ['prepared'], packages(root, 'stable'), ceiling, priors(root, 'stable', 'other')],
  ['prior transition', ['prepared'], packages(root, 'current'), ceiling, priors(root, 'prior')],
  ['prior removal', ['prepared'], [], ceiling, priors(root, 'removed')],
];

it.each(rejectedCases)(
  '[fault: frozen-assumption][fault: observable-order][fault: corrupt-input] rejects %s before mutation',
  async (label, ingresses, packages, message, previous) => {
    for (const ingress of ingresses) {
      const observed = await project();
      const error: unknown = await linkThrough(ingress, observed.vfs, packages, previous).catch(
        (caught: unknown) => caught,
      );
      if (message === ceiling) {
        expect.soft(error, label).toBeInstanceOf(NotImplementedError);
        expect.soft(error, label).toMatchObject({ feature: ceiling });
      } else expect.soft(error, label).toMatchObject({ message });
      expect
        .soft(
          observed.mutations.map((spy) => spy.mock.calls.length),
          label,
        )
        .toEqual([0, 0, 0, 0]);
    }
  },
);

it('[fault: sibling-drift] links stable prior and independent scopes', async () => {
  const independent = [...packages(root, 'root-cli'), ...packages(nested, 'nested-cli')];
  const rootedTargets = [
    pkg('rooted-root', root, '../rooted.js', 'rooted.js'),
    pkg('rooted-nested', nested, '/absolute.js', 'absolute.js'),
  ];
  // biome-ignore format: one compact row per green ingress case.
  const cases = [
    ['prepared', [pkg('stable', root, 'bin/current.js')], priors(root, 'stable'), [['/project/node_modules/.bin/shared', '../stable/bin/current.js']]],
    ['public', independent, [], [['/project/node_modules/.bin/shared', '../root-cli/bin/root-cli.js'], ['/project/node_modules/host/node_modules/.bin/shared', '../nested-cli/bin/nested-cli.js']]],
    ['cancellable', independent, [], [['/project/node_modules/.bin/shared', '../root-cli/bin/root-cli.js'], ['/project/node_modules/host/node_modules/.bin/shared', '../nested-cli/bin/nested-cli.js']]],
    ['prepared', independent, [], [['/project/node_modules/.bin/shared', '../root-cli/bin/root-cli.js'], ['/project/node_modules/host/node_modules/.bin/shared', '../nested-cli/bin/nested-cli.js']]],
    ['public', rootedTargets, [], [['/project/node_modules/.bin/shared', '../rooted-root/rooted.js'], ['/project/node_modules/host/node_modules/.bin/shared', '../rooted-nested/absolute.js']]],
    ['cancellable', rootedTargets, [], [['/project/node_modules/.bin/shared', '../rooted-root/rooted.js'], ['/project/node_modules/host/node_modules/.bin/shared', '../rooted-nested/absolute.js']]],
    ['prepared', rootedTargets, [], [['/project/node_modules/.bin/shared', '../rooted-root/rooted.js'], ['/project/node_modules/host/node_modules/.bin/shared', '../rooted-nested/absolute.js']]],
  ] as const;
  for (const [entrypoint, packages, previous, launchers] of cases) {
    const observed = await project();
    await linkThrough(entrypoint, observed.vfs, packages, previous);
    for (const [path, target] of launchers) {
      expect(await observed.vfs.readFileText(path)).toBe(
        `#!/usr/bin/env node\nimport('${target}');\n`,
      );
    }
  }
});

it('[fault: provenance-lie] keeps one exact present-tense compat ceiling', async () => {
  const note =
    "Collision-free scopes link; ambiguous current claims or a supplied authoritative-prior collision, owner transition, or removal throw `NotImplementedError('npm-client.bin-collision-reify')` before project-tree mutation; npm's operation-sensitive ADD/CHANGE/no-op/remove/rebuild ownership lifecycle remains unsupported";
  const rows = (await readFile(compatUrl, 'utf8'))
    .split('\n')
    .filter((line) => line.startsWith('| Same-command package-bin settlement |'));
  expect(rows).toEqual([`| Same-command package-bin settlement | ❌ | ${note} |`]);
});
