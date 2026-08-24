import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'npm-bin-normalization-probe-'));
const cache = mkdtempSync(join(tmpdir(), 'npm-bin-normalization-cache-'));
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
const legacyNormalizerPath = join(npmRoot, 'node_modules/npm-normalize-package-bin/lib/index.js');
const legacyNormalizerPackagePath = join(
  npmRoot,
  'node_modules/npm-normalize-package-bin/package.json',
);
const packageJsonNormalizePath = join(
  npmRoot,
  'node_modules/@npmcli/package-json/lib/normalize.js',
);
const packageJsonPackagePath = join(npmRoot, 'node_modules/@npmcli/package-json/package.json');
const require = createRequire(import.meta.url);
const legacyNormalize = require(legacyNormalizerPath);
const { normalize: normalizePackageJson } = require(packageJsonNormalizePath);
const legacyNormalizerPackage = JSON.parse(readFileSync(legacyNormalizerPackagePath, 'utf8'));
const packageJsonPackage = JSON.parse(readFileSync(packageJsonPackagePath, 'utf8'));
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const directCases = [
  { id: 'absent', name: 'absent' },
  { id: 'bare-string', name: 'plain-cli', bin: './bin/../plain.js' },
  { id: 'scoped-string', name: '@scope/scoped-cli', bin: '.\\bin\\..\\scoped.js' },
  {
    id: 'array-order-and-collision',
    name: 'array-cli',
    bin: [
      'first/array-z',
      'middle/array-a',
      'a-very-long-intermediate-directory-name/array-z',
      'last/array-z',
    ],
  },
  {
    id: 'object-sanitize-filter-and-collision',
    name: 'object-cli',
    bin: {
      'bad/object-command': './bin/./object.js',
      'bad\\windows-command': 'bin\\windows.js',
      'bad:colon-command': '../colon.js',
      'first/collision': './one.js',
      'second:collision': 'dir/../two.js',
      'bad/canonical-collision': './renamed-first.js',
      'canonical-collision': './canonical-second.js',
      'drive-target': 'C:\\bin\\drive.js',
      '': 'ignored.js',
      'bad/empty-target': '',
      'bad/non-string': 42,
    },
  },
  {
    id: 'target-rooting',
    name: 'target-cli',
    bin: {
      dot: './bin/dot.js',
      traversal: '../../outside.js',
      absolute: '/absolute.js',
      segments: 'bin/../segments.js',
      windows: 'bin\\nested\\..\\windows.js',
    },
  },
  { id: 'empty-array', name: 'empty-array', bin: [] },
  { id: 'empty-object', name: 'empty-object', bin: {} },
  {
    id: 'all-invalid-object',
    name: 'all-invalid-object',
    bin: { '': 'ignored.js', 'bad/empty-target': '', 'bad/non-string': 42 },
  },
  { id: 'empty-string', name: 'empty-string', bin: '' },
  { id: 'null', name: 'null-bin', bin: null },
  { id: 'false', name: 'false-bin', bin: false },
  { id: 'number', name: 'number-bin', bin: 42 },
  { id: 'missing-name-string', bin: './unnamed.js' },
  {
    id: 'non-string-array-entry',
    name: 'invalid-array',
    bin: [
      'valid-0.js',
      'valid-1.js',
      'valid-2.js',
      'valid-3.js',
      'valid-4.js',
      'valid-5.js',
      'valid-6.js',
      'valid-7.js',
      42,
    ],
  },
];

const observe = async (input, normalize) => {
  const pkg = structuredClone(input);
  Reflect.deleteProperty(pkg, 'id');
  try {
    await normalize(pkg);
    return { bin: Object.hasOwn(pkg, 'bin') ? pkg.bin : null };
  } catch (error) {
    return {
      error: {
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
};

const direct = await Promise.all(
  directCases.map(async (input) => {
    const fixture = structuredClone(input);
    Reflect.deleteProperty(fixture, 'id');
    return {
      id: input.id,
      input: fixture,
      packageJson: await observe(input, (pkg) =>
        normalizePackageJson(
          { content: pkg },
          { strict: false, steps: ['bin'], changes: [], allowLegacyCase: true },
        ),
      ),
      legacyPackage: await observe(input, legacyNormalize),
    };
  }),
);

const packages = [
  {
    name: 'plain-cli',
    bin: './bin/../plain.js',
    files: { 'plain.js': 'plain-cli' },
  },
  {
    name: '@scope/scoped-cli',
    bin: '.\\bin\\..\\scoped.js',
    files: { 'scoped.js': 'scoped-cli' },
  },
  {
    name: 'array-cli',
    bin: [
      'first/array-z',
      'middle/array-a',
      'a-very-long-intermediate-directory-name/array-z',
      'last/array-z',
    ],
    files: {
      'first/array-z': 'first-array-z',
      'middle/array-a': 'array-a',
      'a-very-long-intermediate-directory-name/array-z': 'intermediate-array-z',
      'last/array-z': 'last-array-z',
    },
  },
  {
    name: 'object-cli',
    bin: {
      'bad/object-command': './bin/./object.js',
      'bad\\windows-command': 'bin\\windows.js',
      'bad:colon-command': '../colon.js',
      'first/collision': './one.js',
      'second:collision': 'dir/../two.js',
      'bad/canonical-collision': './renamed-first.js',
      'canonical-collision': './canonical-second.js',
      'drive-target': 'C:\\bin\\drive.js',
      '': 'ignored.js',
      'bad/empty-target': '',
      'bad/non-string': 42,
    },
    files: {
      'bin/object.js': 'object-command',
      'bin/windows.js': 'windows-command',
      'colon.js': 'colon-command',
      'one.js': 'first-collision',
      'two.js': 'second-collision',
      'renamed-first.js': 'renamed-first',
      'canonical-second.js': 'canonical-second',
      'C/bin/drive.js': 'drive-target',
    },
  },
  { name: 'absent-bin-cli', files: {} },
  { name: 'empty-array-cli', bin: [], files: {} },
  { name: 'empty-object-cli', bin: {}, files: {} },
  {
    name: 'all-invalid-bin-cli',
    bin: { '': 'ignored.js', 'bad/empty-target': '', 'bad/non-string': 42 },
    files: {},
  },
  { name: 'empty-string-cli', bin: '', files: {} },
  { name: 'null-bin-cli', bin: null, files: {} },
  { name: 'false-bin-cli', bin: false, files: {} },
  { name: 'invalid-top-cli', bin: 42, files: { 'ignored.js': 'ignored' } },
];

const specs = {};
for (const fixture of packages) {
  const dir = join(root, 'packages', fixture.name.replaceAll('/', '-').replace('@', 'scope-'));
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'package.json'), {
    name: fixture.name,
    version: '1.0.0',
    bin: fixture.bin,
  });
  for (const [path, content] of Object.entries(fixture.files)) {
    const fullPath = join(dir, path);
    mkdirSync(fullPath.slice(0, fullPath.lastIndexOf('/')), { recursive: true });
    writeFileSync(fullPath, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(content)})\n`);
    chmodSync(fullPath, 0o755);
  }
  const [{ filename }] = JSON.parse(
    run(dir, 'npm', ['pack', '--ignore-scripts', '--pack-destination', tarballs, '--json']),
  );
  specs[fixture.name] = `file:${join(tarballs, filename)}`;
}

const project = join(root, 'project');
mkdirSync(project);
writeJson(join(project, 'package.json'), {
  name: 'bin-normalization-root',
  version: '1.0.0',
  private: true,
  dependencies: specs,
});

const install = (offline = false) =>
  run(project, 'npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    ...(offline ? ['--offline'] : []),
  ]);

const inspect = () => {
  const lockfile = JSON.parse(readFileSync(join(project, 'package-lock.json'), 'utf8'));
  const manifests = {};
  const lockBins = {};
  for (const fixture of packages) {
    const installPath = join(project, 'node_modules', ...fixture.name.split('/'));
    const installed = JSON.parse(readFileSync(join(installPath, 'package.json'), 'utf8'));
    manifests[fixture.name] = Object.hasOwn(installed, 'bin') ? installed.bin : null;
    const lockEntry = lockfile.packages[`node_modules/${fixture.name}`];
    lockBins[fixture.name] = Object.hasOwn(lockEntry, 'bin') ? lockEntry.bin : null;
  }
  const binDir = join(project, 'node_modules', '.bin');
  const commands = [
    'plain-cli',
    'scoped-cli',
    'array-z',
    'array-a',
    'object-command',
    'windows-command',
    'colon-command',
    'collision',
    'canonical-collision',
    'drive-target',
  ];
  const links = Object.fromEntries(
    commands.map((command) => {
      const path = join(binDir, command);
      return [command, existsSync(path) ? readlinkSync(path) : null];
    }),
  );
  return { manifests, lockBins, links };
};

install();
const fresh = inspect();
rmSync(join(project, 'node_modules'), { recursive: true, force: true });
install(true);
const replay = inspect();

console.log(
  JSON.stringify(
    {
      runtime: {
        node: process.version,
        npm: run(root, 'npm', ['--version']),
        npmPackageJson: packageJsonPackage.version,
        legacyNpmNormalizePackageBin: legacyNormalizerPackage.version,
      },
      sourceSha256: {
        packageJsonNormalize: sha256(packageJsonNormalizePath),
        legacyPackageBin: sha256(legacyNormalizerPath),
      },
      direct,
      fixtures: packages.map((fixture) => ({
        name: fixture.name,
        ...(Object.hasOwn(fixture, 'bin') ? { bin: fixture.bin } : {}),
        files: Object.fromEntries(Object.keys(fixture.files).map((path) => [path, true])),
      })),
      install: { fresh, replay },
    },
    null,
    2,
  ),
);
