import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import {
  expectViteDevServerReady,
  openShellTerminal,
  pickStarter,
  readActiveProjectText,
} from '../../tests/e2e/helpers/playground.ts';

/**
 * Readiness evidence, not acceptance coverage.
 *
 * Replays the exact pre-policy Vite 8 definition/snapshot inputs from Git, then
 * restarts the current build on the same origin and Chromium profile. The probe
 * deliberately asserts today's half-switched mismatch RED and exits zero while
 * that observation remains true. Retire or rewrite it with the implementation.
 */

const REPO = realpathSync(process.cwd());
const APP = join(REPO, 'apps/playground');
const OLD_COMMIT = '7177b9da13732ba512ccd319d462682443c53f54';
const SNAPSHOT_PATH = 'apps/playground/public/snapshots/vite8-node-modules.json.gz';
const DEFINITION_PATH = 'packages/workbench/src/workbench/project-definition.ts';
const IDENTITIES_PATH = 'apps/playground/src/generated/baked-snapshot-identities.json';
const CURRENT_SNAPSHOT_ID =
  'sha256:5630dc5182746653c6aaf4d67156fec81e45706806d056e1256077ce6d61c0da';
const OLD_SNAPSHOT_ID = 'sha256:2b1af80918c6485aa910abac93d8db80b173b93ad5eff3c295829cbdb218c582';
const INSTALL_ARTIFACT_ID =
  'sha256:de9e5426b878f6dda62f03b119e74a7b90dc71e29a859cc5625e196cf88c282d';
const OLD_LOCKFILE_SHA256 = 'b3a9d99a1e207ca4e15976050f45460e40505077c8709cafc6ff301131958031';
const CURRENT_LOCKFILE_SHA256 = '64aceec273c90e7ae52264bbb604a5d95bf79884860ad6f25145bf828667089f';
const EXPECTED_CHANGED_FILES = [
  'postcss/lib/processor.js',
  'postcss/lib/stringifier.js',
  'postcss/package.json',
] as const;

interface SnapshotFile {
  readonly path: string;
  readonly encoding: string;
  readonly content: string;
}

interface Snapshot {
  readonly version: number;
  readonly templateId: string;
  readonly deps: Readonly<Record<string, string>>;
  readonly packages: number;
  packageJsonText: string;
  readonly installArtifactIdentity: string;
  lockfile: string;
  readonly nodeModules: {
    readonly version: number;
    readonly root: string;
    files: SnapshotFile[];
  };
}

interface InstallStamp {
  readonly version: number;
  readonly root: string;
  readonly slug: string;
  readonly packageJsonText: string;
  readonly installArtifactIdentity: string;
  readonly lockfileSha256?: string;
  readonly deps: Readonly<Record<string, string>>;
  readonly packages: number;
  readonly durability?: string;
  readonly epoch?: string;
}

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly overrides?: Readonly<Record<string, string>>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function git(args: readonly string[], maxBuffer = 8 * 1024 * 1024): Buffer {
  return execFileSync('git', [...args], { cwd: REPO, maxBuffer });
}

function gitShow(path: string): Buffer {
  return git(['show', `${OLD_COMMIT}:${path}`], 128 * 1024 * 1024);
}

function readPackageVersion(path: string): string {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { readonly version?: unknown };
  assert(typeof parsed.version === 'string', `${path} has no string version`);
  return parsed.version;
}

function parseSnapshot(bytes: Buffer): Snapshot {
  return JSON.parse(gunzipSync(bytes).toString('utf8')) as Snapshot;
}

function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify({
    version: snapshot.version,
    templateId: snapshot.templateId,
    deps: snapshot.deps,
    packages: snapshot.packages,
    packageJsonText: snapshot.packageJsonText,
    installArtifactIdentity: snapshot.installArtifactIdentity,
    lockfile: snapshot.lockfile,
    nodeModules: snapshot.nodeModules,
  });
}

function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertExactStrings(actual: readonly string[], expected: readonly string[], label: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`,
  );
}

const workspacePackage = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
  readonly name?: unknown;
};
assert(
  workspacePackage.name === 'rifty-workspace',
  `run from the Rifty repository root; observed package name ${String(workspacePackage.name)}`,
);
git(['cat-file', '-e', `${OLD_COMMIT}^{commit}`]);

const repoStateBefore = git(['status', '--porcelain=v1', '--untracked-files=all']).toString('utf8');
const currentCompressed = readFileSync(join(REPO, SNAPSHOT_PATH));
const oldCompressed = gitShow(SNAPSHOT_PATH);
const currentSnapshot = parseSnapshot(currentCompressed);
const oldSnapshot = parseSnapshot(oldCompressed);
const currentSerialized = serializeSnapshot(currentSnapshot);
const oldSerialized = serializeSnapshot(oldSnapshot);
assert(
  sha256(currentSerialized) === CURRENT_SNAPSHOT_ID,
  `current snapshot anchor drifted: ${sha256(currentSerialized)}`,
);
assert(
  sha256(oldSerialized) === OLD_SNAPSHOT_ID,
  `old snapshot anchor drifted: ${sha256(oldSerialized)}`,
);

const invariantSnapshotFields = (snapshot: Snapshot) => ({
  version: snapshot.version,
  templateId: snapshot.templateId,
  deps: snapshot.deps,
  packages: snapshot.packages,
  installArtifactIdentity: snapshot.installArtifactIdentity,
  nodeModulesVersion: snapshot.nodeModules.version,
  nodeModulesRoot: snapshot.nodeModules.root,
});
assert(
  JSON.stringify(invariantSnapshotFields(oldSnapshot)) ===
    JSON.stringify(invariantSnapshotFields(currentSnapshot)),
  'snapshot changed outside packageJsonText, lockfile, or node_modules file content',
);

const currentFiles = new Map(currentSnapshot.nodeModules.files.map((file) => [file.path, file]));
const oldFiles = new Map(oldSnapshot.nodeModules.files.map((file) => [file.path, file]));
assertExactStrings(
  sorted([...oldFiles.keys()].filter((path) => !currentFiles.has(path))),
  [],
  'old-only snapshot paths',
);
assertExactStrings(
  sorted([...currentFiles.keys()].filter((path) => !oldFiles.has(path))),
  [],
  'current-only snapshot paths',
);
const changedFiles = [...oldFiles.values()].filter((oldFile) => {
  const currentFile = currentFiles.get(oldFile.path);
  return currentFile === undefined || JSON.stringify(currentFile) !== JSON.stringify(oldFile);
});
assertExactStrings(
  sorted(changedFiles.map((file) => file.path)),
  sorted(EXPECTED_CHANGED_FILES),
  'changed snapshot files',
);

const reconstructed: Snapshot = structuredClone(currentSnapshot);
reconstructed.packageJsonText = oldSnapshot.packageJsonText;
reconstructed.lockfile = oldSnapshot.lockfile;
const oldChanges = new Map(changedFiles.map((file) => [file.path, file]));
reconstructed.nodeModules.files = reconstructed.nodeModules.files.map(
  (file) => oldChanges.get(file.path) ?? file,
);
const reconstructedSerialized = serializeSnapshot(reconstructed);
assert(
  reconstructedSerialized === oldSerialized,
  'current snapshot plus historical delta is not the byte-exact old serialization',
);
assert(
  sha256(reconstructedSerialized) === OLD_SNAPSHOT_ID,
  `reconstructed snapshot hash drifted: ${sha256(reconstructedSerialized)}`,
);

const historicalDelta = JSON.stringify({
  snapshotId: OLD_SNAPSHOT_ID,
  packageJsonText: oldSnapshot.packageJsonText,
  lockfile: oldSnapshot.lockfile,
  nodeModuleFiles: changedFiles,
});
assert(
  Buffer.byteLength(historicalDelta) === 33_093,
  `historical delta size drifted: ${String(Buffer.byteLength(historicalDelta))}`,
);

const oldDefinitionSource = gitShow(DEFINITION_PATH).toString('utf8');
const oldIdentitiesSource = gitShow(IDENTITIES_PATH).toString('utf8');
const currentDefinitionPath = resolve(REPO, DEFINITION_PATH);
const currentIdentitiesPath = resolve(REPO, IDENTITIES_PATH);
const viteModuleUrl = pathToFileURL(join(APP, 'node_modules/vite/dist/node/index.js')).href;
const playwrightModuleUrl = pathToFileURL(
  join(REPO, 'node_modules/@playwright/test/index.mjs'),
).href;
type ViteRuntime = typeof import('../../apps/playground/node_modules/vite/dist/node/index.js');
const { createServer, loadConfigFromFile } = (await import(viteModuleUrl)) as ViteRuntime;
const { chromium } = (await import(playwrightModuleUrl)) as typeof import('@playwright/test');

console.log(
  JSON.stringify({
    proof: 'environment',
    node: process.version,
    pnpm: execFileSync('pnpm', ['--version'], { cwd: REPO, encoding: 'utf8' }).trim(),
    tsx: readPackageVersion(join(REPO, 'node_modules/tsx/package.json')),
    vite: readPackageVersion(join(APP, 'node_modules/vite/package.json')),
    playwright: readPackageVersion(join(REPO, 'node_modules/@playwright/test/package.json')),
    platform: `${process.platform}-${process.arch}`,
    gitHead: git(['rev-parse', 'HEAD']).toString('utf8').trim(),
    oldCommit: OLD_COMMIT,
  }),
);
console.log(
  JSON.stringify({
    proof: 'historical-delta',
    currentSnapshotId: CURRENT_SNAPSHOT_ID,
    oldSnapshotId: OLD_SNAPSHOT_ID,
    currentCompressedBytes: currentCompressed.byteLength,
    oldCompressedBytes: oldCompressed.byteLength,
    packageJsonBytes: Buffer.byteLength(oldSnapshot.packageJsonText),
    lockfileBytes: Buffer.byteLength(oldSnapshot.lockfile),
    changedFiles: changedFiles.map((file) => ({
      path: file.path,
      encodedBytes: Buffer.byteLength(file.content),
    })),
    deltaJsonBytes: Buffer.byteLength(historicalDelta),
    byteExactReconstruction: true,
  }),
);

function historicalPlugin() {
  return {
    name: 'probe:vite8-pre-policy-build-inputs',
    enforce: 'pre' as const,
    load(id: string) {
      const clean = id.split('?', 1)[0];
      if (clean === currentDefinitionPath) return oldDefinitionSource;
      if (clean === currentIdentitiesPath) return oldIdentitiesSource;
      return null;
    },
    configureServer(server: {
      middlewares: {
        use(
          handler: (
            request: { readonly url?: string },
            response: {
              statusCode: number;
              setHeader(name: string, value: string): void;
              end(body: string): void;
            },
            next: () => void,
          ) => void,
        ): void;
      };
    }) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?', 1)[0];
        if (path !== '/snapshots/vite8-node-modules.json.gz') {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Length', String(Buffer.byteLength(reconstructedSerialized)));
        response.end(reconstructedSerialized);
      });
    },
  };
}

type ViteServer = Awaited<ReturnType<typeof createServer>>;

async function startServer(
  phase: 'old' | 'current',
  requestedPort: number,
  scratch: string,
): Promise<{ readonly server: ViteServer; readonly port: number; readonly url: string }> {
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    join(APP, 'vite.config.ts'),
  );
  assert(loaded !== null, 'could not load playground Vite config');
  const configuredPlugins = loaded.config.plugins ?? [];
  const swBundlePlugins = configuredPlugins.filter(
    (plugin) =>
      plugin !== false &&
      plugin !== null &&
      plugin !== undefined &&
      !Array.isArray(plugin) &&
      (plugin as { readonly name?: unknown }).name === 'rifty:sw-bundle',
  );
  assert(
    swBundlePlugins.length === 1,
    `expected one rifty:sw-bundle plugin, observed ${String(swBundlePlugins.length)}`,
  );
  const filteredPlugins = configuredPlugins.filter((plugin) => {
    if (plugin === false || plugin === null || plugin === undefined || Array.isArray(plugin)) {
      return true;
    }
    return (plugin as { readonly name?: unknown }).name !== 'rifty:sw-bundle';
  });
  const server = await createServer({
    ...loaded.config,
    configFile: false,
    root: APP,
    cacheDir: join(scratch, `vite-cache-${phase}`),
    clearScreen: false,
    plugins: [...filteredPlugins, ...(phase === 'old' ? [historicalPlugin()] : [])],
    server: {
      ...loaded.config.server,
      host: '127.0.0.1',
      port: requestedPort,
      strictPort: requestedPort !== 0,
      hmr: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  assert(
    address !== null && address !== undefined && typeof address !== 'string',
    'Vite did not expose a TCP address',
  );
  return {
    server,
    port: address.port,
    url: `http://127.0.0.1:${String(address.port)}`,
  };
}

async function definitionIdentityProof(
  page: Page,
  projectId: string,
): Promise<{
  readonly definitionIdentitySha256: string;
  readonly catalogMatchesDefinition: boolean;
  readonly expectedBuildIdentityMatches: boolean;
}> {
  const observed = await page.evaluate(
    async ({ id, repo }) => {
      let metadataDirectory = await navigator.storage.getDirectory();
      for (const segment of ['.rifty', 'workbench', 'v1', 'projects', id]) {
        metadataDirectory = await metadataDirectory.getDirectoryHandle(segment);
      }
      const metadataFile = await metadataDirectory.getFileHandle('definition.json');
      const metadata = JSON.parse(await (await metadataFile.getFile()).text()) as {
        readonly definitionIdentity: string;
      };

      let catalogDirectory = await navigator.storage.getDirectory();
      for (const segment of ['.rifty', 'workbench', 'playground']) {
        catalogDirectory = await catalogDirectory.getDirectoryHandle(segment);
      }
      const catalogFile = await catalogDirectory.getFileHandle('catalog.json');
      const catalog = JSON.parse(await (await catalogFile.getFile()).text()) as {
        readonly projects: readonly {
          readonly id: string;
          readonly adoption: { readonly definitionIdentity?: string };
        }[];
      };
      const entry = catalog.projects.find((candidate) => candidate.id === id);
      if (entry === undefined) throw new Error(`OPFS catalog has no project ${id}`);

      const planModulePath = '/src/adapters/playground-project-plan.ts';
      const planModule = (await import(planModulePath)) as {
        toPlaygroundProjectPlan(input: {
          readonly projectId: string;
          readonly starter: object;
          readonly setup: 'instant';
        }): object;
      };
      const starterModulePath = '/src/glue/starter.ts';
      const starterModule = (await import(starterModulePath)) as {
        starterById(id: string): object;
      };
      const definitionModulePath = `/@fs${repo}/packages/workbench/src/workbench/internal/playground-project-definition.ts`;
      const definitionModule = (await import(/* @vite-ignore */ definitionModulePath)) as {
        definePlaygroundProject(plan: object, scope: object): object;
        inspectPlaygroundProjectDefinition(
          definition: object,
          scope: object,
        ): { readonly identity: string };
      };
      const plan = planModule.toPlaygroundProjectPlan({
        projectId: id,
        starter: starterModule.starterById('vite8'),
        setup: 'instant',
      });
      const scope = Object.freeze({
        apiBaseUrl: new URL('/', location.href).href,
        clientUrl: location.href,
      });
      const definition = definitionModule.definePlaygroundProject(plan, scope);
      const expected = definitionModule.inspectPlaygroundProjectDefinition(
        definition,
        scope,
      ).identity;
      return {
        definitionIdentity: metadata.definitionIdentity,
        catalogDefinitionIdentity: entry.adoption.definitionIdentity,
        expected,
      };
    },
    { id: projectId, repo: REPO },
  );
  return {
    definitionIdentitySha256: sha256(observed.definitionIdentity),
    catalogMatchesDefinition: observed.catalogDefinitionIdentity === observed.definitionIdentity,
    expectedBuildIdentityMatches: observed.expected === observed.definitionIdentity,
  };
}

async function saveScratchAs(page: Page, name: string): Promise<string> {
  await page.click('[data-action="open-launcher"]');
  await page.getByRole('button', { name: /^Projects/ }).click();
  await page.locator('[data-action="save-scratch"]').click();
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  await dialog.locator('input.rf-dialog__input').fill(name);
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await dialog.waitFor({ state: 'detached', timeout: 120_000 });
  const card = page.locator('.rf-pcard[data-project]', { hasText: name }).first();
  const id = await card.getAttribute('data-project');
  assert(id !== null && id.length > 0, `saved card ${name} has no project id`);
  await page.locator('.rf-launcher__close').click();
  return id;
}

function parseManifest(text: string): PackageManifest {
  return JSON.parse(text) as PackageManifest;
}

function parseStamp(text: string): InstallStamp {
  return JSON.parse(text) as InstallStamp;
}

function stampProof(
  stamp: InstallStamp,
  expected: {
    readonly root: string;
    readonly slug: string;
    readonly packageJsonText: string;
    readonly lockfileSha256: string;
  },
) {
  assert(stamp.version === 4, `stamp version drifted: ${String(stamp.version)}`);
  assert(stamp.root === expected.root, `stamp root ${stamp.root} != ${expected.root}`);
  assert(stamp.slug === expected.slug, `stamp slug ${stamp.slug} != ${expected.slug}`);
  assert(stamp.packageJsonText === expected.packageJsonText, 'stamp request bytes drifted');
  assert(
    stamp.installArtifactIdentity === INSTALL_ARTIFACT_ID,
    `install artifact identity drifted: ${stamp.installArtifactIdentity}`,
  );
  assert(
    stamp.lockfileSha256 === expected.lockfileSha256,
    `lockfile identity drifted: ${String(stamp.lockfileSha256)}`,
  );
  assert(
    JSON.stringify(stamp.deps) === JSON.stringify({ vite: '8.0.16' }),
    `stamp deps drifted: ${JSON.stringify(stamp.deps)}`,
  );
  assert(stamp.packages === 20, `stamp package count drifted: ${String(stamp.packages)}`);
  assert(stamp.durability === undefined, 'trusted stamp is still pending');
  assert(stamp.epoch === undefined, 'trusted stamp retained an epoch');
  return {
    root: stamp.root,
    slug: stamp.slug,
    requestBytesMatch: true,
    installArtifactIdentity: stamp.installArtifactIdentity,
    lockfileSha256: stamp.lockfileSha256,
    packages: stamp.packages,
    trusted: true,
  };
}

async function runBrowserProof(): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'rifty-vite8-crossbuild-'));
  let oldServer: Awaited<ReturnType<typeof startServer>> | null = null;
  let currentServer: Awaited<ReturnType<typeof startServer>> | null = null;
  const browser = await chromium.launch({ headless: true });
  const startedAt = Date.now();
  try {
    console.log(JSON.stringify({ proof: 'browser', chromium: browser.version() }));
    oldServer = await startServer('old', 0, scratch);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const acquisitionRequests: string[] = [];
      context.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith('/snapshots/') || path.startsWith('/npm-registry')) {
          acquisitionRequests.push(path);
        }
      });

      await page.goto(oldServer.url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await pickStarter(page, 'vite8');
      const storage = await page.locator('.rf-statusbar').getAttribute('data-storage-mode');
      assert(storage === 'opfs', `expected OPFS, observed ${String(storage)}`);
      await expectViteDevServerReady(page, 5174, 180_000);
      await openShellTerminal(page);
      const oldManifestFile = await readActiveProjectText(page, 'package.json', 60_000);
      const oldRuntimeFile = await readActiveProjectText(
        page,
        'node_modules/@napi-rs/wasm-runtime/package.json',
        60_000,
      );
      const oldStampFile = await readActiveProjectText(
        page,
        'node_modules/.rifty-install-stamp.json',
        60_000,
      );
      assert(oldManifestFile.exists, 'old Vite 8 project has no package.json');
      assert(oldRuntimeFile.exists, 'old Vite 8 project has no WASI runtime package');
      assert(oldStampFile.exists, 'old Vite 8 project has no trusted stamp');
      const oldManifest = parseManifest(oldManifestFile.text);
      assert(oldManifest.overrides === undefined, 'historical manifest unexpectedly has overrides');
      assert(
        oldManifest.dependencies?.vite === '8.0.16',
        `historical Vite request drifted: ${String(oldManifest.dependencies?.vite)}`,
      );
      const oldRuntimeVersion = (JSON.parse(oldRuntimeFile.text) as { readonly version?: unknown })
        .version;
      assert(oldRuntimeVersion === '1.1.6', `old runtime drifted: ${String(oldRuntimeVersion)}`);
      const scratchStamp = stampProof(parseStamp(oldStampFile.text), {
        root: '/.rifty/workbench/v1/projects/scratch/tree',
        slug: 'scratch',
        packageJsonText: oldSnapshot.packageJsonText,
        lockfileSha256: OLD_LOCKFILE_SHA256,
      });

      const tag = String(Date.now());
      const projectA = `Old-Vite8-A-${tag}`;
      const projectB = `Stable-Vite7-B-${tag}`;
      const projectAId = await saveScratchAs(page, projectA);
      await expectViteDevServerReady(page, 5174, 180_000);
      await openShellTerminal(page);
      const savedOldStampFile = await readActiveProjectText(
        page,
        'node_modules/.rifty-install-stamp.json',
        60_000,
      );
      assert(savedOldStampFile.exists, 'saved old Vite 8 project lost its trusted stamp');
      const savedOldStamp = stampProof(parseStamp(savedOldStampFile.text), {
        root: `/.rifty/workbench/v1/projects/${projectAId}/tree`,
        slug: projectAId,
        packageJsonText: oldSnapshot.packageJsonText,
        lockfileSha256: OLD_LOCKFILE_SHA256,
      });
      const oldDefinition = await definitionIdentityProof(page, projectAId);
      assert(
        /^sha256:[0-9a-f]{64}$/.test(oldDefinition.definitionIdentitySha256),
        `old definition digest malformed: ${oldDefinition.definitionIdentitySha256}`,
      );
      assert(oldDefinition.catalogMatchesDefinition, 'old catalog adoption differs from metadata');
      assert(oldDefinition.expectedBuildIdentityMatches, 'old build does not reproduce metadata');

      await pickStarter(page, 'project-files');
      await expectViteDevServerReady(page, 5174, 180_000);
      const projectBId = await saveScratchAs(page, projectB);
      await expectViteDevServerReady(page, 5174, 180_000);
      assert(
        acquisitionRequests.includes('/snapshots/vite8-node-modules.json.gz'),
        'old setup did not fetch the historical Vite 8 snapshot',
      );
      console.log(
        JSON.stringify({
          proof: 'old-save',
          origin: oldServer.url,
          storage,
          projectA,
          projectAId,
          projectB,
          projectBId,
          manifest: oldManifest,
          runtimeVersion: oldRuntimeVersion,
          scratchStamp,
          savedStamp: savedOldStamp,
          definition: oldDefinition,
          acquisitionRequests,
        }),
      );

      const stablePort = oldServer.port;
      await page.goto('about:blank');
      await oldServer.server.close();
      oldServer = null;
      currentServer = await startServer('current', stablePort, scratch);
      acquisitionRequests.length = 0;
      await page.goto(currentServer.url, {
        waitUntil: 'domcontentloaded',
        timeout: 120_000,
      });
      await page.locator('.rf-statusbar[data-storage-mode="opfs"]').waitFor({
        state: 'visible',
        timeout: 90_000,
      });
      await page.locator('[data-action="open-launcher"] .rf-chip__name').waitFor({
        state: 'visible',
        timeout: 120_000,
      });
      await expectViteDevServerReady(page, 5174, 180_000);
      const reopenedName = await page
        .locator('[data-action="open-launcher"] .rf-chip__name')
        .textContent();
      assert(reopenedName === projectB, `current build reopened ${String(reopenedName)}`);
      const liveBefore = await page.locator('.rf-livepill[data-state="running"]').count();
      assert(liveBefore === 1, `stable B was not live before stale click: ${String(liveBefore)}`);

      acquisitionRequests.length = 0;
      await page.click('[data-action="open-launcher"]');
      await page.getByRole('button', { name: /^Projects/ }).click();
      const staleCard = page.locator('.rf-pcard[data-project]', { hasText: projectA }).first();
      await staleCard.click();
      const errorToast = page.locator('.rf-toast[data-tone="error"]');
      await errorToast.waitFor({ state: 'visible', timeout: 120_000 });
      const errorText = (await errorToast.textContent()) ?? '';
      assert(
        errorText.includes('ProjectDefinitionMismatchError') &&
          errorText.includes('has a different definition'),
        `unexpected mismatch error: ${errorText}`,
      );
      assertExactStrings(
        acquisitionRequests,
        [],
        'acquisition requests before stale-definition rejection',
      );
      const chipAfter = await page
        .locator('[data-action="open-launcher"] .rf-chip__name')
        .textContent();
      const liveAfter = await page.locator('.rf-livepill[data-state="running"]').count();
      const projectAActive = await staleCard.getAttribute('data-active');
      const projectBActive = await page
        .locator(`.rf-pcard[data-project="${projectBId}"]`)
        .getAttribute('data-active');
      assert(chipAfter === 'Choose project', `half-switch chip changed: ${String(chipAfter)}`);
      assert(liveAfter === 0, `half-switch retained ${String(liveAfter)} live runtime(s)`);
      assert(projectAActive === 'true', `stale A active marker is ${String(projectAActive)}`);
      assert(projectBActive === 'false', `prior B active marker is ${String(projectBActive)}`);
      console.log(
        JSON.stringify({
          proof: 'current-mismatch',
          origin: currentServer.url,
          reopenedName,
          liveBefore,
          staleProject: projectA,
          errorText,
          acquisitionRequests,
          currentHalfSwitchRed: {
            chip: chipAfter,
            live: liveAfter,
            projectAActive,
            projectBActive,
          },
        }),
      );

      acquisitionRequests.length = 0;
      await staleCard.locator('.rf-pcard__menu').click();
      await staleCard
        .locator('.rf-rowmenu')
        .getByRole('button', { name: /Reset to starter/ })
        .click();
      const resetDialog = page.locator('.rf-dialog[role="dialog"]');
      await resetDialog.waitFor({ state: 'visible', timeout: 10_000 });
      await resetDialog.getByRole('button', { name: 'Reset files' }).click();
      await resetDialog.waitFor({ state: 'detached', timeout: 120_000 });
      const launcher = page.locator('[data-testid="launcher"]');
      if (await launcher.isVisible()) await page.locator('.rf-launcher__close').click();
      await expectViteDevServerReady(page, 5174, 180_000);
      await openShellTerminal(page);
      const currentManifestFile = await readActiveProjectText(page, 'package.json', 60_000);
      const currentRuntimeFile = await readActiveProjectText(
        page,
        'node_modules/@napi-rs/wasm-runtime/package.json',
        60_000,
      );
      const currentStampFile = await readActiveProjectText(
        page,
        'node_modules/.rifty-install-stamp.json',
        60_000,
      );
      assert(currentManifestFile.exists, 'reset current Vite 8 project has no package.json');
      assert(currentRuntimeFile.exists, 'reset current Vite 8 project has no WASI runtime package');
      assert(currentStampFile.exists, 'reset current Vite 8 project has no trusted stamp');
      const currentManifest = parseManifest(currentManifestFile.text);
      assert(
        currentManifest.overrides?.['@napi-rs/wasm-runtime'] === 'npm:@napi-rs/wasm-runtime@1.1.6',
        `current override drifted: ${String(currentManifest.overrides?.['@napi-rs/wasm-runtime'])}`,
      );
      const currentRuntimeVersion = (
        JSON.parse(currentRuntimeFile.text) as { readonly version?: unknown }
      ).version;
      assert(
        currentRuntimeVersion === '1.1.6',
        `current runtime drifted: ${String(currentRuntimeVersion)}`,
      );
      const currentStamp = stampProof(parseStamp(currentStampFile.text), {
        root: `/.rifty/workbench/v1/projects/${projectAId}/tree`,
        slug: projectAId,
        packageJsonText: currentSnapshot.packageJsonText,
        lockfileSha256: CURRENT_LOCKFILE_SHA256,
      });
      const currentDefinition = await definitionIdentityProof(page, projectAId);
      assert(
        /^sha256:[0-9a-f]{64}$/.test(currentDefinition.definitionIdentitySha256),
        `current definition digest malformed: ${currentDefinition.definitionIdentitySha256}`,
      );
      assert(
        currentDefinition.catalogMatchesDefinition,
        'current catalog adoption differs from metadata',
      );
      assert(
        currentDefinition.expectedBuildIdentityMatches,
        'current build does not reproduce metadata',
      );
      assert(
        currentDefinition.definitionIdentitySha256 !== oldDefinition.definitionIdentitySha256,
        'Reset did not replace the historical definition identity',
      );
      assertExactStrings(
        acquisitionRequests,
        ['/snapshots/vite8-node-modules.json.gz'],
        'Reset acquisition requests',
      );
      console.log(
        JSON.stringify({
          proof: 'current-reset',
          manifest: currentManifest,
          runtimeVersion: currentRuntimeVersion,
          stamp: currentStamp,
          definition: currentDefinition,
          definitionChanged: true,
          acquisitionRequests,
        }),
      );

      await page.click('[data-action="open-launcher"]');
      await page.getByRole('button', { name: /^Projects/ }).click();
      await page.locator(`.rf-pcard[data-project="${projectBId}"]`).click();
      await launcher.waitFor({ state: 'detached', timeout: 120_000 });
      await expectViteDevServerReady(page, 5174, 180_000);
      const switchedToB = await page
        .locator('[data-action="open-launcher"] .rf-chip__name')
        .textContent();
      assert(switchedToB === projectB, `offline setup did not switch to B: ${String(switchedToB)}`);

      acquisitionRequests.length = 0;
      await context.route('**/*', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.startsWith('/snapshots/') || path.startsWith('/npm-registry')) {
          await route.abort();
          return;
        }
        await route.continue();
      });
      await page.click('[data-action="open-launcher"]');
      await page.getByRole('button', { name: /^Projects/ }).click();
      await page.locator(`.rf-pcard[data-project="${projectAId}"]`).click();
      await launcher.waitFor({ state: 'detached', timeout: 120_000 });
      await expectViteDevServerReady(page, 5174, 180_000);
      await openShellTerminal(page);
      const offlineRuntimeFile = await readActiveProjectText(
        page,
        'node_modules/@napi-rs/wasm-runtime/package.json',
        60_000,
      );
      assert(offlineRuntimeFile.exists, 'offline current A lost its runtime tree');
      const offlineRuntimeVersion = (
        JSON.parse(offlineRuntimeFile.text) as { readonly version?: unknown }
      ).version;
      const activeName = await page
        .locator('[data-action="open-launcher"] .rf-chip__name')
        .textContent();
      assert(activeName === projectA, `offline reopen activated ${String(activeName)}`);
      assert(
        offlineRuntimeVersion === '1.1.6',
        `offline runtime drifted: ${String(offlineRuntimeVersion)}`,
      );
      assertExactStrings(acquisitionRequests, [], 'offline B-to-A acquisition requests');
      console.log(
        JSON.stringify({
          proof: 'offline-reopen',
          switchedFrom: projectB,
          activeName,
          runtimeVersion: offlineRuntimeVersion,
          acquisitionRequests,
          elapsedMs: Date.now() - startedAt,
        }),
      );
    } finally {
      await context.close();
    }
  } finally {
    await oldServer?.server.close().catch(() => undefined);
    await currentServer?.server.close().catch(() => undefined);
    await browser.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

let proofFailure: unknown;
try {
  await runBrowserProof();
} catch (error) {
  proofFailure = error;
}
const repoStateAfter = git(['status', '--porcelain=v1', '--untracked-files=all']).toString('utf8');
assert(
  repoStateAfter === repoStateBefore,
  `probe mutated repository state\nbefore:\n${repoStateBefore}\nafter:\n${repoStateAfter}`,
);
if (proofFailure !== undefined) throw proofFailure;
console.log(JSON.stringify({ proof: 'repository-state', unchanged: true }));
