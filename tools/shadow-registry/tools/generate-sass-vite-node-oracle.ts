import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SASS_VITE_BUILD_PALETTE_EDIT,
  SASS_VITE_NODE_ORACLE_ENVIRONMENT,
  SASS_VITE_PROJECT_FILES,
} from '../src/fixtures/sass-vite-7.3.6-project.ts';

interface CommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface PackageLockEntry {
  readonly version?: unknown;
  readonly integrity?: unknown;
  readonly dependencies?: unknown;
}

interface PackageLock {
  readonly lockfileVersion?: unknown;
  readonly packages?: Readonly<Record<string, PackageLockEntry>>;
}

interface RunLayout {
  readonly root: string;
  readonly project: string;
  readonly home: string;
  readonly temporary: string;
  readonly cache: string;
}

interface NormalizedRun {
  readonly viteVersion: {
    readonly exit: number;
    readonly stdout: string;
    readonly stderr: string;
  };
  readonly build: {
    readonly exit: number;
    readonly warningOccurrences: number;
    readonly warningStderr: string;
    readonly files: readonly {
      readonly path: string;
      readonly bytes: number;
      readonly sha256: string;
    }[];
    readonly css: string;
    readonly externalCssSourceMap: boolean;
  };
  readonly lockfile: {
    readonly version: number;
    readonly bytes: number;
    readonly sha256: string;
    readonly rootDependencies: Readonly<Record<string, string>>;
    readonly nonRootIdentities: number;
    readonly installedIdentities: number;
    readonly allIdentityIntegritySha256: string;
    readonly installedIdentityIntegritySha256: string;
  };
}

const outputUrl = new URL('../src/fixtures/sass-vite-7.3.6-node-build.json', import.meta.url);
const lockFixtureUrl = new URL(
  '../src/fixtures/sass-vite-7.3.6-package-lock.fixture',
  import.meta.url,
);
const lockFixturePath = 'tools/shadow-registry/src/fixtures/sass-vite-7.3.6-package-lock.fixture';
const warningMarker = 'rifty-sass-warning';

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} is not a string`);
  return value;
}

function numberField(value: unknown, label: string): number {
  if (typeof value !== 'number') throw new TypeError(`${label} is not a number`);
  return value;
}

function stringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  const entries = Object.entries(value);
  for (const [key, entry] of entries) stringField(entry, `${label}.${key}`);
  return Object.fromEntries(entries) as Readonly<Record<string, string>>;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalValue(record[key])]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function command(
  executable: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): CommandResult {
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status === null || result.status !== 0) {
    throw new Error(
      `${[executable, ...args].join(' ')} failed (${String(result.status)}, ${String(result.signal)}):\n${result.stdout}${result.stderr}`,
    );
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function controlledEnvironment(layout: RunLayout, cache = layout.cache): NodeJS.ProcessEnv {
  return {
    PATH: [
      join(layout.project, 'node_modules', '.bin'),
      dirname(process.execPath),
      '/usr/bin',
      '/bin',
    ].join(delimiter),
    HOME: layout.home,
    TMPDIR: layout.temporary,
    CI: '1',
    NO_COLOR: '1',
    TZ: 'UTC',
    LANG: 'C',
    LC_ALL: 'C',
    npm_config_cache: cache,
    npm_config_update_notifier: 'false',
    npm_config_userconfig: join(layout.home, '.npmrc'),
  };
}

async function createLayout(root: string, name: string): Promise<RunLayout> {
  const runRoot = join(root, name);
  const layout = {
    root: runRoot,
    project: join(runRoot, 'project'),
    home: join(runRoot, 'home'),
    temporary: join(runRoot, 'tmp'),
    cache: join(runRoot, 'cache'),
  };
  await Promise.all([
    mkdir(layout.project, { recursive: true }),
    mkdir(layout.home, { recursive: true }),
    mkdir(layout.temporary, { recursive: true }),
    mkdir(layout.cache, { recursive: true }),
  ]);
  return layout;
}

async function writeProjectFixture(project: string, lockBytes?: Uint8Array): Promise<void> {
  for (const [path, content] of canonicalProjectEntries()) {
    const target = join(project, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  if (lockBytes !== undefined) await writeFile(join(project, 'package-lock.json'), lockBytes);
}

function canonicalProjectEntries(): readonly (readonly [string, string])[] {
  return Object.entries(SASS_VITE_PROJECT_FILES)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([path, content]) => {
      const segments = path.split('/');
      if (
        path.startsWith('/') ||
        path.includes('\\') ||
        segments.some((segment) => segment === '' || segment === '.' || segment === '..')
      ) {
        throw new Error(`non-canonical Sass/Vite fixture path ${JSON.stringify(path)}`);
      }
      return [path, content] as const;
    });
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = join(directory, entry.name);
      return entry.isDirectory() ? await filesBelow(target) : [target];
    }),
  );
  return files.flat().sort();
}

function occurrenceCount(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}

function assertPaletteEditSource(): void {
  if (
    SASS_VITE_PROJECT_FILES[SASS_VITE_BUILD_PALETTE_EDIT.path] !== SASS_VITE_BUILD_PALETTE_EDIT.from
  ) {
    throw new Error('Sass/Vite palette edit source drifted from the exact project tree');
  }
}

async function collectRun(layout: RunLayout, env: NodeJS.ProcessEnv): Promise<NormalizedRun> {
  const viteVersion = command('vite', ['--version'], layout.project, env);
  const build = command('vite', ['build'], layout.project, env);
  const distRoot = join(layout.project, 'dist');
  const distFiles = (await filesBelow(distRoot)).map((path) => relative(layout.project, path));
  const fileEvidence = await Promise.all(
    distFiles.map(async (path) => {
      const bytes = await readFile(join(layout.project, path));
      return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
    }),
  );
  const cssFiles = distFiles.filter((path) => path.endsWith('.css') && !path.endsWith('.css.map'));
  if (cssFiles.length !== 1) {
    throw new Error(`expected one CSS output, got ${JSON.stringify(cssFiles)}`);
  }
  const cssPath = cssFiles[0]!;
  const css = await readFile(join(layout.project, cssPath), 'utf8');

  const lockBytes = await readFile(join(layout.project, 'package-lock.json'));
  const lock = JSON.parse(lockBytes.toString('utf8')) as PackageLock;
  const packages = lock.packages;
  if (packages === undefined) throw new Error('package-lock.json packages are missing');
  const entries = Object.entries(packages)
    .filter(([path]) => path !== '')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const identities = entries.map(([path, entry]) => ({
    path,
    name: path.slice('node_modules/'.length),
    version: stringField(entry.version, `${path}.version`),
    integrity: stringField(entry.integrity, `${path}.integrity`),
  }));
  const installed = [];
  for (let index = 0; index < identities.length; index += 1) {
    const identity = identities[index]!;
    try {
      await stat(join(layout.project, identity.path, 'package.json'));
      installed.push(identity);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
  }
  const allIdentityJson = canonicalJson(identities);
  const installedIdentityJson = canonicalJson(installed);
  const root = packages[''];
  if (root === undefined) throw new Error('package-lock.json root package is missing');

  return {
    viteVersion: {
      exit: viteVersion.status,
      stdout: viteVersion.stdout,
      stderr: viteVersion.stderr,
    },
    build: {
      exit: build.status,
      warningOccurrences: occurrenceCount(`${build.stdout}${build.stderr}`, warningMarker),
      warningStderr: build.stderr,
      files: fileEvidence,
      css,
      externalCssSourceMap: distFiles.includes(`${cssPath}.map`),
    },
    lockfile: {
      version: numberField(lock.lockfileVersion, 'package-lock.json lockfileVersion'),
      bytes: lockBytes.byteLength,
      sha256: sha256(lockBytes),
      rootDependencies: stringRecord(root.dependencies, 'package-lock.json root dependencies'),
      nonRootIdentities: identities.length,
      installedIdentities: installed.length,
      allIdentityIntegritySha256: sha256(allIdentityJson),
      installedIdentityIntegritySha256: sha256(installedIdentityJson),
    },
  };
}

async function buildRun(layout: RunLayout, env: NodeJS.ProcessEnv): Promise<NormalizedRun> {
  assertPaletteEditSource();
  await writeFile(
    join(layout.project, SASS_VITE_BUILD_PALETTE_EDIT.path),
    SASS_VITE_BUILD_PALETTE_EDIT.to,
  );
  return await collectRun(layout, env);
}

async function refreshRun(layout: RunLayout): Promise<NormalizedRun> {
  await writeProjectFixture(layout.project);
  const env = controlledEnvironment(layout);
  command(
    'npm',
    ['install', '--ignore-scripts', '--audit=false', '--fund=false', '--loglevel=error'],
    layout.project,
    env,
  );
  return await buildRun(layout, env);
}

async function ciRun(
  layout: RunLayout,
  lockBytes: Uint8Array,
  options: { readonly offline: boolean; readonly cache?: string },
): Promise<NormalizedRun> {
  await writeProjectFixture(layout.project, lockBytes);
  const env = controlledEnvironment(layout, options.cache);
  command(
    'npm',
    [
      'ci',
      '--ignore-scripts',
      ...(options.offline ? ['--offline'] : []),
      '--audit=false',
      '--fund=false',
      '--loglevel=error',
    ],
    layout.project,
    env,
  );
  return await buildRun(layout, env);
}

function assertSameRun(left: NormalizedRun, right: NormalizedRun, label: string): void {
  if (canonicalJson(left) !== canonicalJson(right)) {
    throw new Error(`${label} did not reproduce the normalized Sass/Vite oracle`);
  }
}

function fixtureIdentity() {
  assertPaletteEditSource();
  const inputSha256ByPath = Object.fromEntries(
    canonicalProjectEntries().map(([path, content]) => [path, sha256(content)]),
  );
  return {
    inputSha256ByPath,
    edit: {
      path: SASS_VITE_BUILD_PALETTE_EDIT.path,
      from: SASS_VITE_BUILD_PALETTE_EDIT.from,
      fromSha256: sha256(SASS_VITE_BUILD_PALETTE_EDIT.from),
      to: SASS_VITE_BUILD_PALETTE_EDIT.to,
      toSha256: sha256(SASS_VITE_BUILD_PALETTE_EDIT.to),
    },
  };
}

function artifact(npmVersion: string, run: NormalizedRun) {
  return {
    schema: 2,
    oracle: 'real-node-vite-sass-build',
    recorded: '2026-08-02',
    reproductions: 2,
    environment: {
      node: process.version,
      npm: npmVersion,
      platform: process.platform,
      architecture: process.arch,
      vite: SASS_VITE_NODE_ORACLE_ENVIRONMENT.vite,
      sassEmbedded: SASS_VITE_NODE_ORACLE_ENVIRONMENT.sassEmbedded,
    },
    fixture: fixtureIdentity(),
    lockFixture: {
      path: lockFixturePath,
      bytes: run.lockfile.bytes,
      sha256: run.lockfile.sha256,
    },
    viteVersion: {
      exit: run.viteVersion.exit,
      stdout: run.viteVersion.stdout,
      stdoutSha256: sha256(run.viteVersion.stdout),
      stderr: run.viteVersion.stderr,
    },
    build: {
      exit: run.build.exit,
      warningOccurrences: run.build.warningOccurrences,
      warningStderr: run.build.warningStderr,
      warningStderrSha256: sha256(run.build.warningStderr),
      files: run.build.files,
      css: run.build.css,
      externalCssSourceMap: run.build.externalCssSourceMap,
    },
    lockfile: run.lockfile,
    offlineReplay: {
      command: 'npm ci --ignore-scripts --offline',
      exit: 0,
      buildMatchesFresh: true,
    },
  };
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== '--write' && mode !== '--check') {
    throw new Error('usage: generate-sass-vite-node-oracle.ts --write|--check');
  }
  if (process.version !== SASS_VITE_NODE_ORACLE_ENVIRONMENT.node) {
    throw new Error(
      `Sass/Vite oracle requires ${SASS_VITE_NODE_ORACLE_ENVIRONMENT.node}, got ${process.version}`,
    );
  }
  if (
    process.platform !== SASS_VITE_NODE_ORACLE_ENVIRONMENT.platform ||
    process.arch !== SASS_VITE_NODE_ORACLE_ENVIRONMENT.architecture
  ) {
    throw new Error(
      `Sass/Vite oracle requires ${SASS_VITE_NODE_ORACLE_ENVIRONMENT.platform}-${SASS_VITE_NODE_ORACLE_ENVIRONMENT.architecture}, got ${process.platform}-${process.arch}`,
    );
  }
  const versionResult = command('npm', ['--version'], process.cwd(), {
    PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter),
    HOME: resolve(tmpdir()),
    NO_COLOR: '1',
  });
  const npmVersion = versionResult.stdout.trim();
  if (npmVersion !== SASS_VITE_NODE_ORACLE_ENVIRONMENT.npm) {
    throw new Error(
      `Sass/Vite oracle requires npm ${SASS_VITE_NODE_ORACLE_ENVIRONMENT.npm}, got ${npmVersion}`,
    );
  }

  const workspace = await mkdtemp(join(tmpdir(), 'rifty-sass-vite-node-oracle-'));
  try {
    if (mode === '--write') {
      const first = await createLayout(workspace, 'refresh-install-a');
      const second = await createLayout(workspace, 'refresh-install-b');
      const replay = await createLayout(workspace, 'refresh-offline-replay');
      const firstResult = await refreshRun(first);
      const secondResult = await refreshRun(second);
      assertSameRun(firstResult, secondResult, 'two isolated refresh installs');
      const lockBytes = await readFile(join(first.project, 'package-lock.json'));
      const replayResult = await ciRun(replay, lockBytes, {
        offline: true,
        cache: first.cache,
      });
      assertSameRun(firstResult, replayResult, 'refresh offline npm ci replay');
      const expected = `${JSON.stringify(artifact(npmVersion, firstResult), null, 2)}\n`;
      await Promise.all([writeFile(lockFixtureUrl, lockBytes), writeFile(outputUrl, expected)]);
      return;
    }

    const lockBytes = await readFile(lockFixtureUrl);
    const first = await createLayout(workspace, 'check-online-ci-a');
    const second = await createLayout(workspace, 'check-online-ci-b');
    const replay = await createLayout(workspace, 'check-offline-ci');
    const firstResult = await ciRun(first, lockBytes, { offline: false });
    const secondResult = await ciRun(second, lockBytes, { offline: false });
    assertSameRun(firstResult, secondResult, 'two isolated online npm ci checks');
    const replayResult = await ciRun(replay, lockBytes, {
      offline: true,
      cache: first.cache,
    });
    assertSameRun(firstResult, replayResult, 'committed-lock offline npm ci replay');
    const expected = `${JSON.stringify(artifact(npmVersion, firstResult), null, 2)}\n`;
    if ((await readFile(outputUrl, 'utf8')) !== expected) {
      throw new Error('Sass/Vite Node oracle drifted; run the generator with --write');
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
