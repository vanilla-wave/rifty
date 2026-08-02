import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';
import type { SassContractTranscript } from '../../tools/shadow-registry/src/test-sass-contract-probe.ts';
import {
  bootOwner,
  closeOwner,
  execLine,
  flushOwnerDurable,
  gotoHarness,
  readOwnerFile,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';

interface HostEsbuild {
  build(options: Readonly<Record<string, unknown>>): Promise<{
    readonly outputFiles?: readonly { readonly text: string }[];
  }>;
}

interface BuildEvidence {
  readonly files: readonly string[];
  readonly normalizedFiles: readonly string[];
  readonly fileEvidence: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
  readonly css: {
    readonly path: string;
    readonly text: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly externalSourceMapPath: string;
    readonly externalSourceMapPresent: boolean;
  };
  readonly jsMap: {
    readonly path: string;
    readonly parsed: {
      readonly version?: unknown;
      readonly file?: unknown;
      readonly names?: readonly unknown[];
      readonly mappings?: unknown;
      readonly sources?: readonly string[];
      readonly sourcesContent?: readonly string[];
    };
  };
}

interface LockfileEvidence {
  readonly lockfileVersion?: unknown;
  readonly packages?: Readonly<Record<string, unknown>>;
  readonly rifty?: {
    readonly shadowSubstitutions?: {
      readonly protocol?: unknown;
      readonly applied?: readonly unknown[];
    };
  };
}

interface SassRegistryOracle {
  readonly name: 'sass';
  readonly version: '1.100.0';
  readonly dist: { readonly integrity: string };
  readonly dependencies: Readonly<Record<string, string>>;
}

interface SassClosureOracle {
  readonly packages: readonly {
    readonly name: string;
    readonly version: string;
    readonly integrity: string;
    readonly tarball: string;
    readonly dependencies: Readonly<Record<string, string>>;
  }[];
}

interface SassViteNodeBuildOracle {
  readonly environment: { readonly vite: string };
  readonly viteVersion: { readonly exit: number };
  readonly build: {
    readonly warningOccurrences: number;
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
    readonly rootDependencies: Readonly<Record<string, string>>;
  };
}

interface PreviewHandle {
  readonly port: number;
  readonly url: string;
}

const expectedContract = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../tools/shadow-registry/src/fixtures/sass-embedded-1.100.0-contract.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as SassContractTranscript;
const sassRegistryOracle = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../tools/shadow-registry/src/fixtures/sass-1.100.0-registry.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as SassRegistryOracle;
const sassClosureOracle = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../tools/shadow-registry/src/fixtures/sass-1.100.0-closure.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as SassClosureOracle;
const sassViteNodeBuildOracle = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../tools/shadow-registry/src/fixtures/sass-vite-7.3.6-node-build.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as SassViteNodeBuildOracle;
const shadowRequire = createRequire(
  new URL('../../tools/shadow-registry/package.json', import.meta.url),
);
const hostEsbuild = shadowRequire('esbuild') as HostEsbuild;

async function bundleContractProbe(): Promise<string> {
  const result = await hostEsbuild.build({
    entryPoints: [
      fileURLToPath(
        new URL('../../tools/shadow-registry/src/test-sass-contract-probe.ts', import.meta.url),
      ),
    ],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'RiftySassContractProbe',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
  });
  const source = result.outputFiles?.[0]?.text;
  if (!source) throw new Error('shared Sass contract probe bundle missing');
  return source;
}

function directCjsContractRunner(probeBundle: string): string {
  return `${probeBundle}
const fs = require('node:fs');
const cjs = require('sass-embedded');

module.exports.__promise = (async () => {
  const outputPath = process.argv[2];
  if (!outputPath) throw new Error('missing Sass CJS contract output path');
  const esm = await import('sass-embedded');
  const transcript = await RiftySassContractProbe.probeSassContract(
    {cjs, esm},
    'sass-embedded@1.100.0',
  );
  fs.writeFileSync(outputPath, JSON.stringify(transcript));
})();
`;
}

function directEsmContractRunner(probeBundle: string): string {
  return `import {createRequire} from 'node:module';
import * as fs from 'node:fs';
import * as esm from 'sass-embedded';
${probeBundle}
const require = createRequire(import.meta.url);
const cjs = require('sass-embedded');
const outputPath = process.argv[2];
if (!outputPath) throw new Error('missing Sass ESM contract output path');
const transcript = await RiftySassContractProbe.probeSassContract(
  {cjs, esm},
  'sass-embedded@1.100.0',
);
fs.writeFileSync(outputPath, JSON.stringify(transcript));
`;
}

const BUILD_INSPECTOR = `const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function walk(root) {
  return fs.readdirSync(root, {withFileTypes: true}).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }).sort();
}

const files = walk('dist');
const cssFiles = files.filter((file) => file.endsWith('.css'));
const jsMaps = files.filter((file) => file.endsWith('.js.map'));
if (cssFiles.length !== 1 || jsMaps.length !== 1) {
  throw new Error(\`Sass build inventory drifted: \${JSON.stringify(files)}\`);
}
const cssPath = cssFiles[0];
const jsMapPath = jsMaps[0];
const css = fs.readFileSync(cssPath);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const normalizedFiles = files
  .map((file) => file.replace(/^(dist\\/assets\\/index-)[^.]+(?=\\.(?:css|js)(?:\\.map)?$)/, '$1<hash>'))
  .sort();
fs.writeFileSync('.sass-build.json', JSON.stringify({
  files,
  normalizedFiles,
  fileEvidence: files.map((file) => {
    const bytes = fs.readFileSync(file);
    return {path: file, bytes: bytes.byteLength, sha256: sha256(bytes)};
  }),
  css: {
    path: cssPath,
    text: css.toString('utf8'),
    bytes: css.byteLength,
    sha256: sha256(css),
    externalSourceMapPath: \`\${cssPath}.map\`,
    externalSourceMapPresent: fs.existsSync(\`\${cssPath}.map\`),
  },
  jsMap: {
    path: jsMapPath,
    parsed: JSON.parse(fs.readFileSync(jsMapPath, 'utf8')),
  },
}));
`;

const VITE_CONFIG = `import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@styles': fileURLToPath(new URL('./src/styles', import.meta.url)),
    },
  },
  css: {
    devSourcemap: true,
    preprocessorOptions: {
      scss: {
        importers: [{
          canonicalize(url) {
            return url === 'virtual:spacing' ? new URL('virtual:spacing') : null;
          },
          load(url) {
            if (url.protocol !== 'virtual:') return null;
            return {contents: '$space: 11px;', syntax: 'scss'};
          },
        }],
      },
    },
  },
  build: {
    sourcemap: true,
  },
});
`;

const STYLE_SCSS = `@use '@styles/palette';
@use './styles/nested';
@use 'virtual:spacing' as spacing;

@warn "rifty-sass-warning";

.card {
  color: palette.$accent;
  padding: spacing.$space;
  @include nested.label;
}
`;

const MAIN_JS =
  "import './style.scss';\ndocument.getElementById('app').innerHTML = '<div class=\"card\"><span class=\"label\">sass-ready</span></div>';\n";
const INITIAL_PALETTE = '$accent: rgb(32, 64, 128);\n';
const BUILT_PALETTE = '$accent: rgb(9, 87, 65);\n';
const OFFLINE_HMR_PALETTE = '$accent: rgb(71, 22, 99);\n';
const NESTED_SCSS = '@mixin label { .label { font-weight: 700; } }\n';

function registryPaths(urls: readonly string[]): string[] {
  return urls.flatMap((value) => {
    const url = new URL(value);
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      path = url.pathname;
    }
    const index = path.toLowerCase().indexOf('/npm-registry');
    return index === -1 ? [] : [path.slice(index)];
  });
}

function forbiddenNativeRequests(paths: readonly string[]): string[] {
  return paths.filter(
    (path) =>
      path.includes('/sass-embedded') ||
      path.includes('/@parcel/watcher') ||
      path.includes('/@parcel%2Fwatcher'),
  );
}

function occurrenceCount(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}

async function readJson<T>(page: Page, path: string): Promise<T> {
  const file = await readOwnerFile(page, path);
  if (!file.ok) throw new Error(`Cannot read ${path}: ${file.error}`);
  return JSON.parse(file.text) as T;
}

async function readText(page: Page, path: string): Promise<string> {
  const file = await readOwnerFile(page, path);
  if (!file.ok) throw new Error(`Cannot read ${path}: ${file.error}`);
  return file.text;
}

function plainRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function lockRegistryFact(
  value: unknown,
  label: string,
): Readonly<{
  version: unknown;
  resolved: unknown;
  integrity: unknown;
  dependencies: unknown;
}> {
  const entry = plainRecord(value, label);
  return {
    version: entry.version,
    resolved: entry.resolved,
    integrity: entry.integrity,
    dependencies: entry.dependencies,
  };
}

function expectExactSassClosure(packages: Readonly<Record<string, unknown>>): void {
  expect(lockRegistryFact(packages['node_modules/sass'], 'Sass source lock entry')).toEqual({
    version: sassRegistryOracle.version,
    resolved: expect.stringMatching(/\/sass\/-\/sass-1\.100\.0\.tgz$/u),
    integrity: sassRegistryOracle.dist.integrity,
    dependencies: sassRegistryOracle.dependencies,
  });
  for (const fixture of sassClosureOracle.packages) {
    expect(
      lockRegistryFact(
        packages[`node_modules/${fixture.name}`],
        `${fixture.name} closure lock entry`,
      ),
    ).toEqual({
      version: fixture.version,
      resolved: fixture.tarball,
      integrity: fixture.integrity,
      dependencies: fixture.dependencies,
    });
  }
  expect(
    Object.keys(packages)
      .filter(
        (path) =>
          path === 'node_modules/sass' ||
          sassClosureOracle.packages.some(({ name }) => path === `node_modules/${name}`),
      )
      .sort(),
  ).toEqual(
    [
      'node_modules/sass',
      ...sassClosureOracle.packages.map(({ name }) => `node_modules/${name}`),
    ].sort(),
  );
  expect(Object.keys(packages).filter((path) => path.includes('@parcel/watcher'))).toEqual([]);
}

function expectExactNodeBuild(evidence: BuildEvidence): void {
  const oracleFiles = sassViteNodeBuildOracle.build.files;
  const oracleCss = oracleFiles.find(({ path }) => path.endsWith('.css'));
  if (oracleCss === undefined) throw new Error('real Node Sass/Vite oracle lacks CSS evidence');
  expect(evidence.files).toEqual(oracleFiles.map(({ path }) => path));
  expect(evidence.fileEvidence).toEqual(oracleFiles);
  expect(evidence.normalizedFiles).toEqual(
    oracleFiles
      .map(({ path }) =>
        path.replace(/^(dist\/assets\/index-)[^.]+(?=\.(?:css|js)(?:\.map)?$)/u, '$1<hash>'),
      )
      .sort(),
  );
  expect(evidence.css.path).toBe(oracleCss.path);
  expect(evidence.css.text).toBe(sassViteNodeBuildOracle.build.css);
  expect(evidence.css.bytes).toBe(oracleCss.bytes);
  expect(evidence.css.sha256).toBe(oracleCss.sha256);
  expect(evidence.css.externalSourceMapPath).toBe(`${evidence.css.path}.map`);
  expect(evidence.css.externalSourceMapPresent).toBe(
    sassViteNodeBuildOracle.build.externalCssSourceMap,
  );
  expect(evidence.files.some((path) => path.endsWith('.css.map'))).toBe(
    sassViteNodeBuildOracle.build.externalCssSourceMap,
  );
  expect(evidence.jsMap.path).toBe(oracleFiles.find(({ path }) => path.endsWith('.js.map'))?.path);
  expect(evidence.jsMap.parsed.version).toBe(3);
  expect(evidence.jsMap.parsed.file).toBe(
    evidence.jsMap.path.slice(evidence.jsMap.path.lastIndexOf('/') + 1, -'.map'.length),
  );
  expect(evidence.jsMap.parsed.sources).toEqual(['../../src/main.js']);
  expect(evidence.jsMap.parsed.sourcesContent).toEqual([MAIN_JS]);
  expect(evidence.jsMap.parsed.names).toEqual([]);
  expect(evidence.jsMap.parsed.mappings).toEqual(expect.stringMatching(/\S/u));
}

async function startViteProject(page: Page): Promise<PreviewHandle> {
  return page.evaluate(async (fixtureUrl) => {
    type Exit = { readonly code: number | null; readonly signal: string | null };
    type Run = {
      readonly ready: Promise<{ readonly port: number; readonly url: string }>;
      readonly terminal: {
        attach(listener: (chunk: string, stream: 'stdout' | 'stderr') => void): () => void;
      };
      close(): Promise<Exit>;
    };
    type Project = { run(): Run };
    type RunState = {
      readonly run: Run;
      readonly output: () => string;
      readonly detach: () => void;
    };
    const fixture = (await import(/* @vite-ignore */ fixtureUrl)) as {
      currentProject(): Project;
    };
    const host = globalThis as typeof globalThis & { __riftySassViteRun?: RunState };
    if (host.__riftySassViteRun !== undefined) throw new Error('Sass Vite run already active');
    const run = fixture.currentProject().run();
    let output = '';
    const detach = run.terminal.attach((chunk) => {
      output += chunk;
    });
    host.__riftySassViteRun = { run, output: () => output, detach };
    try {
      return await run.ready;
    } catch (error) {
      detach();
      Reflect.deleteProperty(host, '__riftySassViteRun');
      await run.close().catch(() => {});
      throw error;
    }
  }, sealedWorkbenchFixtureUrl);
}

function viteProjectOutput(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = globalThis as typeof globalThis & {
      __riftySassViteRun?: { readonly output: () => string };
    };
    const state = host.__riftySassViteRun;
    if (state === undefined) throw new Error('Sass Vite run is not active');
    return state.output();
  });
}

async function stopViteProject(page: Page): Promise<void> {
  await page.evaluate(async () => {
    type RunState = {
      readonly run: { close(): Promise<unknown> };
      readonly detach: () => void;
    };
    const host = globalThis as typeof globalThis & { __riftySassViteRun?: RunState };
    const state = host.__riftySassViteRun;
    if (state === undefined) return;
    Reflect.deleteProperty(host, '__riftySassViteRun');
    try {
      await state.run.close();
    } finally {
      state.detach();
    }
  });
}

async function mountPreview(page: Page, url: string): Promise<void> {
  await page.evaluate((previewUrl) => {
    document.querySelector('#sass-vite-preview')?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'sass-vite-preview';
    frame.src = new URL(previewUrl, location.href).href;
    document.body.appendChild(frame);
  }, url);
  await expect(page.frameLocator('#sass-vite-preview').locator('.card')).toContainText(
    'sass-ready',
  );
}

async function previewStyle(page: Page): Promise<{
  readonly color: string;
  readonly padding: string;
  readonly fontWeight: string;
}> {
  return page
    .frameLocator('#sass-vite-preview')
    .locator('.card')
    .evaluate((element) => {
      const style = getComputedStyle(element);
      const label = element.querySelector('.label');
      if (!label) throw new Error('Sass preview lacks nested .label');
      return {
        color: style.color,
        padding: style.padding,
        fontWeight: getComputedStyle(label).fontWeight,
      };
    });
}

test('sass-embedded exact facade matches Node and powers Vite 7.3.6 SCSS dev/HMR/build offline', async ({
  context,
  page,
}) => {
  test.setTimeout(300_000);
  const requests: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  const probeBundle = await bundleContractProbe();
  const bootOptions = {
    workspaceId: 'bu-sass-vite-contract',
    persistence: 'preferred' as const,
    plan: {
      kind: 'vite' as const,
      id: 'scratch',
      starterId: 'sass-vite-contract',
      templateId: 'browser-unit:sass-vite-contract-v2',
      files: {
        '/package.json': '{"name":"sass-vite-contract","private":true,"type":"module"}\n',
        '/index.html': '<div id="app"></div><script type="module" src="/src/main.js"></script>\n',
        '/src/main.js': MAIN_JS,
        '/src/style.scss': STYLE_SCSS,
        '/src/styles/_palette.scss': INITIAL_PALETTE,
        '/src/styles/_nested.scss': NESTED_SCSS,
        '/vite.config.js': VITE_CONFIG,
        '/.sass-contract.cjs': directCjsContractRunner(probeBundle),
        '/.sass-contract.mjs': directEsmContractRunner(probeBundle),
        '/.inspect-sass-build.cjs': BUILD_INSPECTOR,
      },
      dependencies: {
        vite: '7.3.6',
        'sass-embedded': '1.100.0',
      },
      firstMaterialization: { kind: 'install' as const },
      port: 5175,
    },
  };

  await gotoHarness(page);
  let ownerOpen = false;
  let viteRunOpen = false;
  await bootOwner(page, bootOptions);
  ownerOpen = true;

  try {
    const install = await execLine(page, 'npm install');
    expect(
      forbiddenNativeRequests(registryPaths(requests)),
      'exact Sass recipe must replace the native carrier before registry resolution',
    ).toEqual([]);
    expect(install.exit, install.out).toBe(0);

    const viteVersion = await execLine(page, 'vite --version');
    expect(viteVersion.exit, viteVersion.out).toBe(sassViteNodeBuildOracle.viteVersion.exit);
    expect(viteVersion.out).toMatch(
      new RegExp(`^vite/${sassViteNodeBuildOracle.environment.vite}(?:\\s|$)`, 'mu'),
    );

    const directCjs = await execLine(page, 'node .sass-contract.cjs .sass-contract-cjs.json');
    expect(directCjs.exit, directCjs.out).toBe(0);
    expect(
      await readJson<SassContractTranscript>(page, '/scratch/.sass-contract-cjs.json'),
    ).toEqual(expectedContract);

    const directEsm = await execLine(page, 'node .sass-contract.mjs .sass-contract-esm.json');
    expect(directEsm.exit, directEsm.out).toBe(0);
    expect(
      await readJson<SassContractTranscript>(page, '/scratch/.sass-contract-esm.json'),
    ).toEqual(expectedContract);

    const cli = await execLine(page, 'sass --version');
    expect(cli.exit, cli.out).toBe(1);
    expect(cli.out).toContain('sass-embedded.cli');

    const preview = await startViteProject(page);
    viteRunOpen = true;
    expect(preview.port).toBe(5175);
    await mountPreview(page, preview.url);
    expect(await previewStyle(page)).toEqual({
      color: 'rgb(32, 64, 128)',
      padding: '11px',
      fontWeight: '700',
    });
    await expect.poll(() => viteProjectOutput(page)).toContain('rifty-sass-warning');

    await page
      .frameLocator('#sass-vite-preview')
      .locator('.card')
      .evaluate(() => {
        (
          globalThis as typeof globalThis & {
            __riftySassHmrSentinel?: string;
          }
        ).__riftySassHmrSentinel = 'same-document';
      });
    await writeOwnerFile(page, '/scratch/src/styles/_palette.scss', BUILT_PALETTE);
    await expect.poll(async () => (await previewStyle(page)).color).toBe('rgb(9, 87, 65)');
    expect(
      await page
        .frameLocator('#sass-vite-preview')
        .locator('.card')
        .evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __riftySassHmrSentinel?: string;
              }
            ).__riftySassHmrSentinel,
        ),
      'SCSS edit must HMR in the existing document rather than pass via reload',
    ).toBe('same-document');
    await stopViteProject(page);
    viteRunOpen = false;
    await page.evaluate(() => document.querySelector('#sass-vite-preview')?.remove());

    const build = await execLine(page, 'vite build');
    expect(build.exit, build.out).toBe(0);
    expect(occurrenceCount(build.out, 'rifty-sass-warning')).toBe(
      sassViteNodeBuildOracle.build.warningOccurrences,
    );
    const inspect = await execLine(page, 'node .inspect-sass-build.cjs');
    expect(inspect.exit, inspect.out).toBe(0);
    const built = await readJson<BuildEvidence>(page, '/scratch/.sass-build.json');
    expectExactNodeBuild(built);

    const freshLockText = await readText(page, '/scratch/package-lock.json');
    const lockfile = JSON.parse(freshLockText) as LockfileEvidence;
    expect(lockfile.lockfileVersion).toBe(sassViteNodeBuildOracle.lockfile.version);
    const packages = lockfile.packages ?? {};
    expect(plainRecord(packages[''], 'project root lock entry').dependencies).toEqual(
      sassViteNodeBuildOracle.lockfile.rootDependencies,
    );
    expectExactSassClosure(packages);
    const acquired = plainRecord(packages['node_modules/sass'], 'acquired Sass lock entry');
    expect(acquired.bin).toBeUndefined();
    expect(acquired.optionalDependencies).toBeUndefined();
    expect(packages['node_modules/sass-embedded']).toEqual({
      version: '1.100.0',
      bin: { sass: 'dist/bin/sass.js' },
      riftyShadowRecipe: 'rifty.shadow-substitution.sass-embedded.v2',
    });
    expect(plainRecord(packages['node_modules/vite'], 'Vite lock entry').version).toBe(
      sassViteNodeBuildOracle.environment.vite,
    );
    const freshShadowProvenance = lockfile.rifty?.shadowSubstitutions;
    expect(freshShadowProvenance?.protocol).toBe('rifty.shadow-substitutions/v2');
    expect(freshShadowProvenance?.applied).toHaveLength(1);
    const applied = plainRecord(freshShadowProvenance?.applied?.[0], 'Sass substitution trace');
    expect(Object.keys(applied).sort()).toEqual([
      'acquisition',
      'catalog',
      'materialization',
      'recipeDigest',
      'substitutionId',
      'trigger',
    ]);
    expect(applied.catalog).toEqual({
      id: 'rifty.shadow-substitutions.builtin.v2',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(applied.substitutionId).toBe('rifty.shadow-substitution.sass-embedded.v2');
    expect(applied.recipeDigest).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/u));
    expect(applied.trigger).toEqual({
      name: 'sass-embedded',
      requestedRange: '1.100.0',
      version: '1.100.0',
    });
    expect(applied.acquisition).toEqual({
      kind: 'registry',
      name: 'sass',
      version: '1.100.0',
      resolved: acquired.resolved,
      integrity: sassRegistryOracle.dist.integrity,
      dependencies: sassRegistryOracle.dependencies,
      optionalDependencies: {},
      peerDependencies: {},
      bundleDependencies: [],
      bundled: [],
    });
    const materialization = plainRecord(applied.materialization, 'Sass materialization trace');
    expect(materialization.installPath).toBe('node_modules/sass-embedded');
    expect(materialization.name).toBe('sass-embedded');
    expect(materialization.version).toBe('1.100.0');
    expect(materialization.bin).toEqual({ sass: 'dist/bin/sass.js' });
    const materializedFiles = materialization.files;
    if (!Array.isArray(materializedFiles)) {
      throw new TypeError('Sass materialization files must be an array');
    }
    const materializedFileFacts = materializedFiles.map((value, index) =>
      plainRecord(value, `Sass materialization file ${String(index)}`),
    );
    expect(materializedFileFacts.map(({ path }) => path).sort()).toEqual(
      ['dist/bin/sass.js', 'dist/lib/index.js', 'dist/lib/index.mjs', 'package.json'].sort(),
    );
    for (const file of materializedFileFacts) {
      expect(Object.keys(file).sort()).toEqual(['bytes', 'path', 'sha256']);
      expect(file.bytes).toEqual(expect.any(Number));
      expect(file.bytes).toBeGreaterThan(0);
      expect(file.sha256).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/u));
    }

    const freshRegistryPaths = registryPaths(requests);
    expect(freshRegistryPaths.some((path) => path.includes('/sass/-/sass-1.100.0.tgz'))).toBe(true);
    for (const dependency of ['/chokidar', '/readdirp', '/immutable', '/source-map-js']) {
      expect(freshRegistryPaths.some((path) => path.includes(dependency))).toBe(true);
    }
    expect(
      forbiddenNativeRequests(freshRegistryPaths),
      'exact Sass shadow must not read native carrier/platform/watcher registry entries',
    ).toEqual([]);

    await flushOwnerDurable(page);
    await closeOwner(page);
    ownerOpen = false;
    const blockedRegistryRequests: string[] = [];
    await context.route(/\/npm-registry(?:\/|$)/u, async (route) => {
      blockedRegistryRequests.push(route.request().url());
      await route.abort();
    });
    await bootOwner(page, bootOptions);
    ownerOpen = true;

    const replay = await execLine(page, 'npm install');
    expect(replay.exit, replay.out).toBe(0);
    const replayLockText = await readText(page, '/scratch/package-lock.json');
    expect(replayLockText).toBe(freshLockText);
    const replayLockfile = JSON.parse(replayLockText) as LockfileEvidence;
    expect(replayLockfile.lockfileVersion).toBe(sassViteNodeBuildOracle.lockfile.version);
    expect(replayLockfile.rifty?.shadowSubstitutions).toEqual(freshShadowProvenance);

    const offlineViteVersion = await execLine(page, 'vite --version');
    expect(offlineViteVersion.exit, offlineViteVersion.out).toBe(
      sassViteNodeBuildOracle.viteVersion.exit,
    );
    expect(offlineViteVersion.out).toMatch(
      new RegExp(`^vite/${sassViteNodeBuildOracle.environment.vite}(?:\\s|$)`, 'mu'),
    );
    const offlineCjs = await execLine(
      page,
      'node .sass-contract.cjs .sass-contract-offline-cjs.json',
    );
    expect(offlineCjs.exit, offlineCjs.out).toBe(0);
    expect(
      await readJson<SassContractTranscript>(page, '/scratch/.sass-contract-offline-cjs.json'),
    ).toEqual(expectedContract);
    const offlineEsm = await execLine(
      page,
      'node .sass-contract.mjs .sass-contract-offline-esm.json',
    );
    expect(offlineEsm.exit, offlineEsm.out).toBe(0);
    expect(
      await readJson<SassContractTranscript>(page, '/scratch/.sass-contract-offline-esm.json'),
    ).toEqual(expectedContract);

    const offlinePreview = await startViteProject(page);
    viteRunOpen = true;
    expect(offlinePreview.port).toBe(5175);
    await mountPreview(page, offlinePreview.url);
    expect(await previewStyle(page)).toEqual({
      color: 'rgb(9, 87, 65)',
      padding: '11px',
      fontWeight: '700',
    });
    await expect.poll(() => viteProjectOutput(page)).toContain('rifty-sass-warning');
    await page
      .frameLocator('#sass-vite-preview')
      .locator('.card')
      .evaluate(() => {
        (
          globalThis as typeof globalThis & {
            __riftySassOfflineHmrSentinel?: string;
          }
        ).__riftySassOfflineHmrSentinel = 'offline-same-document';
      });
    await writeOwnerFile(page, '/scratch/src/styles/_palette.scss', OFFLINE_HMR_PALETTE);
    await expect.poll(async () => (await previewStyle(page)).color).toBe('rgb(71, 22, 99)');
    expect(
      await page
        .frameLocator('#sass-vite-preview')
        .locator('.card')
        .evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __riftySassOfflineHmrSentinel?: string;
              }
            ).__riftySassOfflineHmrSentinel,
        ),
      'offline SCSS edit must HMR in the existing document',
    ).toBe('offline-same-document');
    await writeOwnerFile(page, '/scratch/src/styles/_palette.scss', BUILT_PALETTE);
    await expect.poll(async () => (await previewStyle(page)).color).toBe('rgb(9, 87, 65)');
    expect(
      await page
        .frameLocator('#sass-vite-preview')
        .locator('.card')
        .evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __riftySassOfflineHmrSentinel?: string;
              }
            ).__riftySassOfflineHmrSentinel,
        ),
      'restoring the build palette must preserve the offline HMR document',
    ).toBe('offline-same-document');
    await stopViteProject(page);
    viteRunOpen = false;
    await page.evaluate(() => document.querySelector('#sass-vite-preview')?.remove());

    const offlineBuild = await execLine(page, 'vite build');
    expect(offlineBuild.exit, offlineBuild.out).toBe(0);
    expect(occurrenceCount(offlineBuild.out, 'rifty-sass-warning')).toBe(
      sassViteNodeBuildOracle.build.warningOccurrences,
    );
    const offlineInspect = await execLine(page, 'node .inspect-sass-build.cjs');
    expect(offlineInspect.exit, offlineInspect.out).toBe(0);
    const offlineBuilt = await readJson<BuildEvidence>(page, '/scratch/.sass-build.json');
    expectExactNodeBuild(offlineBuilt);
    expect(offlineBuilt).toEqual(built);
    expect(await readText(page, '/scratch/package-lock.json')).toBe(freshLockText);
    expect(
      blockedRegistryRequests,
      'verified Sass acquisition, facade, and Vite tree must replay offline',
    ).toEqual([]);
  } finally {
    if (viteRunOpen) await stopViteProject(page).catch(() => {});
    if (ownerOpen) await closeOwner(page);
  }
});
