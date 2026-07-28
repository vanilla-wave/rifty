import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cache = mkdtempSync(join(tmpdir(), 'npm-bin-collision-cache-'));
const root = mkdtempSync(join(tmpdir(), 'npm-bin-collision-probe-'));
const tarballs = join(root, 'tarballs');
mkdirSync(tarballs);

const run = (cwd, command, args) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: cache },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
};

const npmRoot = join(run(root, 'npm', ['root', '-g']), 'npm');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const manifest = (name, dependencies, version = '1.0.0') => ({
  name,
  version,
  private: true,
  ...(dependencies ? { dependencies } : {}),
});

const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const packageSpecs = [
  ['a-a-v1', 'a-a', '1.0.0'],
  ['a_a-v1', 'a_a', '1.0.0'],
  ['a-a-v2', 'a-a', '2.0.0'],
  ['a_a-v2', 'a_a', '2.0.0'],
  ['scope-a-a', '@scope/a-a', '1.0.0'],
  ['scope-a_a', '@scope/a_a', '1.0.0'],
  ['zz-provider', '@zz/provider', '1.0.0'],
];
const tarballByIdentity = new Map();

for (const [dirName, name, version] of packageSpecs) {
  const dir = join(root, 'packages', dirName);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'package.json'), {
    ...manifest(name, undefined, version),
    bin: { shared: 'cli.js' },
  });
  writeFileSync(
    join(dir, 'cli.js'),
    `#!/usr/bin/env node\nconsole.log(${JSON.stringify(`${name}@${version}`)})\n`,
  );
  chmodSync(join(dir, 'cli.js'), 0o755);
  const [{ filename }] = JSON.parse(
    run(dir, 'npm', ['pack', '--ignore-scripts', '--pack-destination', tarballs, '--json']),
  );
  tarballByIdentity.set(`${name}@${version}`, `file:${join(tarballs, filename)}`);
}

const spec = (name, version = '1.0.0') => {
  const value = tarballByIdentity.get(`${name}@${version}`);
  if (!value) throw new Error(`missing tarball ${name}@${version}`);
  return value;
};

const bin = (dir) => {
  const path = join(dir, 'node_modules', '.bin', 'shared');
  return existsSync(path) ? readlinkSync(path) : null;
};

const nestedBin = (dir, packageName) => {
  const path = join(dir, 'node_modules', packageName, 'node_modules', '.bin', 'shared');
  return existsSync(path) ? readlinkSync(path) : null;
};

const install = (dir) =>
  run(dir, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);

const makeRoot = (name, dependencies) => {
  const dir = join(root, 'roots', name);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'package.json'), manifest(name, dependencies));
  return dir;
};

const fresh = [];
for (const [name, entries] of [
  [
    'bare-hyphen-first',
    [
      ['a-a', spec('a-a')],
      ['a_a', spec('a_a')],
    ],
  ],
  [
    'bare-underscore-first',
    [
      ['a_a', spec('a_a')],
      ['a-a', spec('a-a')],
    ],
  ],
  [
    'scoped-hyphen-first',
    [
      ['@scope/a-a', spec('@scope/a-a')],
      ['@scope/a_a', spec('@scope/a_a')],
    ],
  ],
  [
    'scoped-underscore-first',
    [
      ['@scope/a_a', spec('@scope/a_a')],
      ['@scope/a-a', spec('@scope/a-a')],
    ],
  ],
  [
    'bare-first',
    [
      ['a-a', spec('a-a')],
      ['@zz/provider', spec('@zz/provider')],
    ],
  ],
  [
    'scope-first',
    [
      ['@zz/provider', spec('@zz/provider')],
      ['a-a', spec('a-a')],
    ],
  ],
]) {
  const dir = makeRoot(name, Object.fromEntries(entries));
  install(dir);
  fresh.push({
    name,
    dependencyOrder: entries.map(([key]) => key).join(' -> '),
    bin: bin(dir),
  });
}

const incremental = [];
for (const [name, first, added] of [
  ['hyphen-then-underscore', 'a-a', 'a_a'],
  ['underscore-then-hyphen', 'a_a', 'a-a'],
]) {
  const dependencies = { [first]: spec(first) };
  const dir = makeRoot(name, dependencies);
  install(dir);
  const initial = bin(dir);
  dependencies[added] = spec(added);
  writeJson(join(dir, 'package.json'), manifest(name, dependencies));
  install(dir);
  const afterAdd = bin(dir);
  install(dir);
  const afterNoop = bin(dir);
  run(dir, 'npm', ['rebuild', '--ignore-scripts', '--no-audit', '--no-fund']);
  const afterRebuild = bin(dir);
  incremental.push({ name, initial, afterAdd, afterNoop, afterRebuild });
}

const links = [];
{
  const dir = makeRoot('link-underscore-then-hyphen', {
    a_a: `file:${join(root, 'packages', 'a_a-v1')}`,
  });
  install(dir);
  const initial = bin(dir);
  writeJson(
    join(dir, 'package.json'),
    manifest('link-underscore-then-hyphen', {
      a_a: `file:${join(root, 'packages', 'a_a-v1')}`,
      'a-a': `file:${join(root, 'packages', 'a-a-v1')}`,
    }),
  );
  install(dir);
  links.push({
    name: 'directory-link-underscore-then-hyphen',
    initial,
    afterAdd: bin(dir),
  });
}

const removal = [];
for (const [name, removed] of [
  ['remove-winner', 'a_a'],
  ['remove-loser', 'a-a'],
]) {
  const dependencies = { 'a-a': spec('a-a'), a_a: spec('a_a') };
  const dir = makeRoot(name, dependencies);
  install(dir);
  const initial = bin(dir);
  delete dependencies[removed];
  writeJson(join(dir, 'package.json'), manifest(name, dependencies));
  install(dir);
  const afterRemove = bin(dir);
  install(dir);
  const afterNoop = bin(dir);
  run(dir, 'npm', ['rebuild', '--ignore-scripts', '--no-audit', '--no-fund']);
  removal.push({
    name,
    removed,
    initial,
    afterRemove,
    afterNoop,
    afterRebuild: bin(dir),
  });
}

const nestedConsumerDir = join(root, 'packages', 'nested-consumer');
mkdirSync(nestedConsumerDir, { recursive: true });
writeJson(
  join(nestedConsumerDir, 'package.json'),
  manifest('nested-consumer', {
    'a-a': spec('a-a', '2.0.0'),
    a_a: spec('a_a', '2.0.0'),
  }),
);
const [{ filename: nestedConsumerFilename }] = JSON.parse(
  run(nestedConsumerDir, 'npm', [
    'pack',
    '--ignore-scripts',
    '--pack-destination',
    tarballs,
    '--json',
  ]),
);
const nestedDir = makeRoot('nested-scope-isolation', {
  'a-a': spec('a-a'),
  a_a: spec('a_a'),
  'nested-consumer': `file:${join(tarballs, nestedConsumerFilename)}`,
});
install(nestedDir);
const nestedScopeIsolation = {
  root: bin(nestedDir),
  nestedConsumer: nestedBin(nestedDir, 'nested-consumer'),
};

const packageVersion = (path) => JSON.parse(readFileSync(path, 'utf8')).version;
const sourceFiles = {
  rebuild: join(npmRoot, 'node_modules/@npmcli/arborist/lib/arborist/rebuild.js'),
  reify: join(npmRoot, 'node_modules/@npmcli/arborist/lib/arborist/reify.js'),
  linkGently: join(npmRoot, 'node_modules/bin-links/lib/link-gently.js'),
  localeCompare: join(npmRoot, 'node_modules/@isaacs/string-locale-compare/index.js'),
};

console.log(
  JSON.stringify(
    {
      runtime: {
        node: process.version,
        npm: run(root, 'npm', ['--version']),
        arborist: packageVersion(join(npmRoot, 'node_modules/@npmcli/arborist/package.json')),
        binLinks: packageVersion(join(npmRoot, 'node_modules/bin-links/package.json')),
        stringLocaleCompare: packageVersion(
          join(npmRoot, 'node_modules/@isaacs/string-locale-compare/package.json'),
        ),
      },
      sourceSha256: Object.fromEntries(
        Object.entries(sourceFiles).map(([name, path]) => [name, sha256(path)]),
      ),
      fresh,
      incremental,
      links,
      removal,
      nestedScopeIsolation,
    },
    null,
    2,
  ),
);
