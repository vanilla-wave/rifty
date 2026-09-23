// npm 11 override-value probe (overrides-bare-version-spec). Oracle only:
// npm's own npm-package-arg classification + real `npm install
// --package-lock-only` against registry.npmjs.org with an isolated cache.
// Prints deterministic JSON on stdout.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REGISTRY = 'https://registry.npmjs.org/';
const cache = mkdtempSync(join(tmpdir(), 'npm-override-probe-cache-'));
const root = mkdtempSync(join(tmpdir(), 'npm-override-probe-'));

const run = (cwd, args) =>
  spawnSync('npm', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: cache, npm_config_registry: REGISTRY },
  });

const npmVersion = run(root, ['--version']).stdout.trim();
const npmRoot = join(run(root, ['root', '-g']).stdout.trim(), 'npm');
const requireNpm = createRequire(join(npmRoot, 'package.json'));
const npa = requireNpm('npm-package-arg');
const libVersion = (name) => requireNpm(`${name}/package.json`).version;
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const arboristDir = join(npmRoot, 'node_modules', '@npmcli', 'arborist', 'lib');

// 1. Classification: Arborist applies an override by replacing the edge spec
//    (edge.js `get spec`) and resolving it against the EDGE name
//    (build-ideal-tree.js `npa.resolve(edge.name, edge.spec, …)`).
const classifyValues = [
  '8.0.16',
  ' 8.0.16 ',
  'v8.0.16',
  '=8.0.16',
  '8.0.16-beta.1',
  '^8.0.0',
  '~8.0.16',
  '~>8.0',
  '8.0.x',
  '8.x',
  '8',
  'x',
  '*',
  '>=8.0.0 <8.1.0',
  '8.0.0 - 8.0.16',
  '^7.0.0 || ^8.0.0',
  'latest',
  'beta',
  'bcryptjs',
  'sql.js',
  '7zip-bin',
  '@scope/pkg',
  'npm:vite@8.0.16',
  'npm:bcryptjs@2.4.3',
  'npm:bcryptjs',
  'npm:v8.0.1',
  'npm:8.0.16',
  'npm:2',
  'vite@8.0.16',
  '$vite',
];

const describeSpec = (spec) =>
  spec.type === 'alias'
    ? {
        type: 'alias',
        name: spec.subSpec.name,
        subType: spec.subSpec.type,
        fetchSpec: spec.subSpec.fetchSpec,
      }
    : spec.type === 'directory' || spec.type === 'file'
      ? { type: spec.type, name: spec.name }
      : { type: spec.type, name: spec.name, fetchSpec: spec.fetchSpec };

const classifyValue = (key, value) => {
  try {
    return describeSpec(npa.resolve(key, value, root));
  } catch (error) {
    return { error: error.code };
  }
};
const classify = classifyValues.map((value) => ({ value, npa: classifyValue('vite', value) }));

// 2. Real installs. debug@4.3.4 depends on ms "2.1.2"; ms dist-tags:
//    latest 2.1.3, beta 3.0.0-beta.2. Registry also hosts packages literally
//    named "2" and "beta" (the silent-misparse targets).
const debugTree = (overrides, extra = {}) => ({
  name: 'override-probe',
  version: '1.0.0',
  private: true,
  dependencies: { debug: '4.3.4', ...extra },
  ...(overrides === undefined ? {} : { overrides }),
});

const installCases = [
  ['baseline', debugTree(undefined)],
  ['exact', debugTree({ ms: '2.0.0' })],
  ['v-prefixed', debugTree({ ms: 'v2.0.0' })],
  ['eq-prefixed', debugTree({ ms: '=2.0.0' })],
  ['caret', debugTree({ ms: '^2.0.0' })],
  ['tilde', debugTree({ ms: '~2.0.0' })],
  ['x-range-patch', debugTree({ ms: '2.0.x' })],
  ['partial-major', debugTree({ ms: '2' })],
  ['x-any', debugTree({ ms: 'x' })],
  ['star', debugTree({ ms: '*' })],
  ['empty', debugTree({ ms: '' })],
  ['comparator-set', debugTree({ ms: '>=2.0.0 <2.1.0' })],
  ['hyphen', debugTree({ ms: '2.0.0 - 2.1.1' })],
  ['union', debugTree({ ms: '^0.7.0 || 2.0.0' })],
  ['tag-latest', debugTree({ ms: 'latest' })],
  ['tag-beta', debugTree({ ms: 'beta' })],
  ['bare-word', debugTree({ ms: 'bcryptjs' })],
  ['digit-leading-word', debugTree({ ms: '7zip-bin' })],
  ['alias-name-range', debugTree({ ms: 'npm:bcryptjs@2.4.3' })],
  ['alias-digit-name', debugTree({ ms: 'npm:2' })],
  ['alias-v-name', debugTree({ ms: 'npm:v8' })],
  ['rifty-name-at-range', debugTree({ ms: 'ms@2.0.0' })],
  ['reference', debugTree({ ms: '$ms' }, { ms: '2.0.0' })],
  ['direct-dep-conflict', debugTree({ ms: '2.0.0' }, { ms: '^2.1.0' })],
  ['existing-lock-then-override', debugTree({ ms: '2.0.0' }), debugTree(undefined)],
  [
    'scenario-vitest-vite',
    {
      name: 'override-probe',
      version: '1.0.0',
      private: true,
      devDependencies: { vitest: '4.1.11' },
      overrides: { vite: '8.0.16' },
    },
  ],
];

const pick = (entry) =>
  entry === undefined
    ? null
    : { ...(entry.name === undefined ? {} : { name: entry.name }), version: entry.version };

const errorSummary = (stderr) => {
  const lines = stderr.split('\n').filter((line) => line.startsWith('npm error'));
  const code = lines.find((line) => line.startsWith('npm error code '))?.slice(15) ?? null;
  const message =
    lines.find(
      (line) =>
        !line.startsWith('npm error code ') &&
        !line.includes('A complete log') &&
        !line.includes('/'),
    ) ?? null;
  return { code, message };
};

const lockOnly = ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'];
const writeManifest = (dir, manifest) =>
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const installs = installCases.map(([id, manifest, before]) => {
  const dir = join(root, id);
  mkdirSync(dir);
  if (before !== undefined) {
    // Existing user state: a lock written without the override first.
    writeManifest(dir, before);
    if (run(dir, lockOnly).status !== 0) throw new Error(`${id}: seed install failed`);
  }
  writeManifest(dir, manifest);
  const result = run(dir, lockOnly);
  const [key, value] = Object.entries(manifest.overrides ?? {})[0] ?? [];
  const input = {
    id,
    ...(before === undefined ? {} : { before }),
    manifest,
    ...(key === undefined ? {} : { npa: classifyValue(key, value) }),
  };
  if (result.status !== 0) {
    return { ...input, exit: result.status, error: errorSummary(result.stderr) };
  }
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  const watched = id.startsWith('scenario') ? 'vite' : 'ms';
  const entries = Object.fromEntries(
    Object.entries(lock.packages)
      .filter(([path]) => path.endsWith(`node_modules/${watched}`))
      .map(([path, entry]) => [path, pick(entry)]),
  );
  const edges = id.startsWith('scenario')
    ? { 'node_modules/vitest': lock.packages['node_modules/vitest']?.dependencies?.vite ?? null }
    : { 'node_modules/debug': lock.packages['node_modules/debug']?.dependencies?.ms ?? null };
  return { ...input, exit: 0, entries, edges };
});

// 3. Registry facts the rifty contract tests rebuild their network-boundary
//    registry from (never hand-typed). Registry state on the probe date.
const view = (spec, fields) => {
  const result = run(root, ['view', spec, ...fields, '--json']);
  if (result.status !== 0) throw new Error(`npm view ${spec}: ${result.stderr}`);
  return JSON.parse(result.stdout);
};
const msView = view('ms', ['versions', 'dist-tags']);
const decoyNames = ['2', 'x', 'latest', 'beta'];
const registryFacts = {
  ms: { versions: msView.versions, distTags: msView['dist-tags'] },
  'debug@4.3.4': { dependencies: view('debug@4.3.4', ['dependencies']) },
  // Real packages literally named like override values (silent-misparse targets).
  decoys: Object.fromEntries(decoyNames.map((name) => [name, view(name, ['dist-tags.latest'])])),
  'vitest@4.1.11': { vite: view('vitest@4.1.11', ['dependencies.vite']) },
  vite: {
    has8016: view('vite@8.0.16', ['version']) === '8.0.16',
    latest: view('vite', ['dist-tags.latest']),
  },
};

process.stdout.write(
  `${JSON.stringify(
    {
      node: process.version,
      npm: npmVersion,
      registry: REGISTRY,
      libraries: {
        'npm-package-arg': libVersion('npm-package-arg'),
        '@npmcli/arborist': libVersion('@npmcli/arborist'),
        semver: libVersion('semver'),
      },
      sources: {
        'arborist/lib/edge.js': sha256(join(arboristDir, 'edge.js')),
        'arborist/lib/override-set.js': sha256(join(arboristDir, 'override-set.js')),
        'npm-package-arg/lib/npa.js': sha256(
          join(npmRoot, 'node_modules', 'npm-package-arg', 'lib', 'npa.js'),
        ),
      },
      classify,
      installs,
      registryFacts,
    },
    null,
    2,
  )}\n`,
);
