import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  applyViteCliActionPatch,
  applyViteRootWatchPatch,
  viteRootWatchPatchPolicy,
} from '../../../packages/workbench/src/workers/vite-cli-install-policy.ts';

const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'));
const APP = join(REPO, 'apps/playground');
const FIXTURES = join(REPO, 'tests/e2e/fixtures/vite8-pre-policy');
const SNAPSHOT_PATH = join(APP, 'public/snapshots/vite8-node-modules.json.gz');
const DEFINITION_PATH = join(REPO, 'packages/workbench/src/workbench/project-definition.ts');
const IDENTITIES_PATH = join(APP, 'src/generated/baked-snapshot-identities.json');
const HISTORICAL_COMMIT = '7177b9da13732ba512ccd319d462682443c53f54';
const HISTORICAL_DEFINITION_PATH = 'packages/workbench/src/workbench/project-definition.ts';
const HISTORICAL_DEFINITION_BYTES = 22_265;
const HISTORICAL_DEFINITION_SHA256 =
  'b4b18f806e2532e37a0d0cfed83eb82f53c1fd3ee00984b0ffaa3534c289df19';
const CURRENT_SNAPSHOT_ID =
  'sha256:5630dc5182746653c6aaf4d67156fec81e45706806d056e1256077ce6d61c0da';
const HISTORICAL_SNAPSHOT_ID =
  'sha256:2b1af80918c6485aa910abac93d8db80b173b93ad5eff3c295829cbdb218c582';
const HISTORICAL_DELTA_BYTES = 33_006;
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
  readonly packageJsonText: string;
  readonly installArtifactIdentity: string;
  readonly lockfile: string;
  readonly nodeModules: {
    readonly version: number;
    readonly root: string;
    readonly files: readonly SnapshotFile[];
  };
}

interface DefinitionSourceFixture {
  readonly version: number;
  readonly sourceCommit: string;
  readonly sourcePath: string;
  readonly encoding: string;
  readonly sourceBytes: number;
  readonly sourceSha256: string;
  readonly payload: string;
}

interface SnapshotDeltaFixture {
  readonly version: number;
  readonly encoding: string;
  readonly baseSnapshotId: string;
  readonly historicalSnapshotId: string;
  readonly uncompressedBytes: number;
  readonly payload: string;
}

interface SnapshotDelta {
  readonly packageJsonText: string;
  readonly lockfile: string;
  readonly nodeModuleFiles: readonly SnapshotFile[];
}

interface BakedSnapshotIdentities {
  readonly version: number;
  readonly snapshots: Readonly<Record<'typescript' | 'vite' | 'vite8', string>>;
}

interface FrozenBuildInputs {
  readonly evidence: Vite8CrossBuildEvidence;
  readonly snapshots: Vite8CrossBuildSnapshotProofs;
  readonly historicalDefinitionSource: string;
  readonly historicalIdentitiesSource: string;
  readonly historicalSnapshotSource: string;
}

type ViteRuntime = typeof import('../../../apps/playground/node_modules/vite/dist/node/index.js');
type ViteServer = Awaited<ReturnType<ViteRuntime['createServer']>>;

interface ActiveServer extends Vite8CrossBuildApp {
  readonly server: ViteServer;
}

export interface Vite8CrossBuildEvidence {
  readonly historicalCommit: string;
  readonly historicalDefinitionSha256: string;
  readonly currentSnapshotId: string;
  readonly historicalSnapshotId: string;
}

export interface Vite8CrossBuildSnapshotProof {
  readonly snapshotId: string;
  readonly packageJsonSha256: string;
  readonly lockfileSha256: string;
  readonly nodeModules: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
}

export interface Vite8CrossBuildSnapshotProofs {
  readonly historical: Vite8CrossBuildSnapshotProof;
  readonly current: Vite8CrossBuildSnapshotProof;
}

export interface Vite8CrossBuildApp {
  readonly phase: 'historical' | 'current';
  readonly port: number;
  readonly url: string;
}

export interface Vite8CrossBuildHarness {
  readonly evidence: Vite8CrossBuildEvidence;
  readonly snapshots: Vite8CrossBuildSnapshotProofs;
  startHistorical(): Promise<Vite8CrossBuildApp>;
  startCurrent(): Promise<Vite8CrossBuildApp>;
  close(): Promise<void>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function parseJson<T>(text: Buffer | string, label: string): T {
  try {
    return JSON.parse(typeof text === 'string' ? text : text.toString('utf8')) as T;
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function identity(serialized: string): string {
  return `sha256:${sha256(serialized)}`;
}

function decodeFixture(payload: string, label: string): Buffer {
  assert(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload),
    `${label} payload is not canonical base64`,
  );
  const compressed = Buffer.from(payload, 'base64');
  assert(compressed.toString('base64') === payload, `${label} payload base64 round-trip drifted`);
  try {
    return gunzipSync(compressed);
  } catch (error) {
    throw new Error(`${label} payload is not valid gzip`, { cause: error });
  }
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

function loadDefinitionSource(): {
  readonly fixture: DefinitionSourceFixture;
  readonly source: string;
} {
  const fixture = readJson<DefinitionSourceFixture>(
    join(FIXTURES, 'project-definition-source.json'),
  );
  assert(fixture.version === 1, 'historical definition fixture version drifted');
  assert(fixture.encoding === 'gzip-base64', 'historical definition encoding drifted');
  assert(
    fixture.sourceCommit === HISTORICAL_COMMIT,
    `historical definition commit drifted: ${fixture.sourceCommit}`,
  );
  assert(
    fixture.sourcePath === HISTORICAL_DEFINITION_PATH,
    `historical definition path drifted: ${fixture.sourcePath}`,
  );
  assert(
    fixture.sourceBytes === HISTORICAL_DEFINITION_BYTES,
    `historical definition byte anchor drifted: ${String(fixture.sourceBytes)}`,
  );
  assert(
    fixture.sourceSha256 === HISTORICAL_DEFINITION_SHA256,
    `historical definition SHA anchor drifted: ${fixture.sourceSha256}`,
  );
  const bytes = decodeFixture(fixture.payload, 'historical definition');
  assert(
    bytes.byteLength === fixture.sourceBytes,
    `historical definition decoded bytes drifted: ${String(bytes.byteLength)}`,
  );
  assert(
    sha256(bytes) === fixture.sourceSha256,
    `historical definition decoded SHA drifted: ${sha256(bytes)}`,
  );
  return Object.freeze({
    fixture,
    source: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  });
}

function loadSnapshotDelta(): {
  readonly fixture: SnapshotDeltaFixture;
  readonly delta: SnapshotDelta;
} {
  const fixture = readJson<SnapshotDeltaFixture>(join(FIXTURES, 'snapshot-delta.json'));
  assert(fixture.version === 1, 'historical snapshot delta fixture version drifted');
  assert(fixture.encoding === 'gzip-base64', 'historical snapshot delta encoding drifted');
  assert(
    fixture.baseSnapshotId === CURRENT_SNAPSHOT_ID,
    `historical snapshot base anchor drifted: ${fixture.baseSnapshotId}`,
  );
  assert(
    fixture.historicalSnapshotId === HISTORICAL_SNAPSHOT_ID,
    `historical snapshot identity anchor drifted: ${fixture.historicalSnapshotId}`,
  );
  assert(
    fixture.uncompressedBytes === HISTORICAL_DELTA_BYTES,
    `historical snapshot delta byte anchor drifted: ${String(fixture.uncompressedBytes)}`,
  );
  const bytes = decodeFixture(fixture.payload, 'historical snapshot delta');
  assert(
    bytes.byteLength === fixture.uncompressedBytes,
    `historical snapshot delta decoded bytes drifted: ${String(bytes.byteLength)}`,
  );
  const delta = parseJson<SnapshotDelta>(bytes, 'historical snapshot delta');
  const paths = delta.nodeModuleFiles.map((file) => file.path).sort();
  assert(
    new Set(paths).size === paths.length &&
      JSON.stringify(paths) === JSON.stringify([...EXPECTED_CHANGED_FILES].sort()),
    `historical snapshot delta paths drifted: ${JSON.stringify(paths)}`,
  );
  return Object.freeze({ fixture, delta });
}

function reconstructHistoricalSnapshot(
  fixture: SnapshotDeltaFixture,
  delta: SnapshotDelta,
): string {
  const currentSource = gunzipSync(readFileSync(SNAPSHOT_PATH)).toString('utf8');
  assert(
    identity(currentSource) === fixture.baseSnapshotId,
    `current snapshot base drifted: ${identity(currentSource)}`,
  );
  const current = parseJson<Snapshot>(currentSource, 'current Vite 8 snapshot');
  assert(
    serializeSnapshot(current) === currentSource,
    'current Vite 8 snapshot serialization is not canonical',
  );
  const replacements = new Map(delta.nodeModuleFiles.map((file) => [file.path, file] as const));
  const currentPaths = new Set(current.nodeModules.files.map((file) => file.path));
  for (const path of replacements.keys()) {
    assert(
      currentPaths.has(path),
      `historical delta path is absent from current snapshot: ${path}`,
    );
  }
  const reconstructed = serializeSnapshot({
    ...current,
    packageJsonText: delta.packageJsonText,
    lockfile: delta.lockfile,
    nodeModules: {
      ...current.nodeModules,
      files: current.nodeModules.files.map((file) => replacements.get(file.path) ?? file),
    },
  });
  assert(
    identity(reconstructed) === fixture.historicalSnapshotId,
    `historical snapshot reconstruction drifted: ${identity(reconstructed)}`,
  );
  return reconstructed;
}

function snapshotProof(serialized: string, snapshotId: string): Vite8CrossBuildSnapshotProof {
  const snapshot = parseJson<Snapshot>(serialized, `${snapshotId} Vite 8 snapshot proof`);
  const rootWatchPaths = snapshot.nodeModules.files.filter((file) => {
    if (!file.path.startsWith('vite/dist/node/chunks/') || !file.path.endsWith('.js')) {
      return false;
    }
    const source = Buffer.from(
      file.content,
      file.encoding === 'base64' ? 'base64' : 'utf8',
    ).toString('utf8');
    return (
      source.includes(viteRootWatchPatchPolicy.needle) ||
      source.includes(viteRootWatchPatchPolicy.replacement)
    );
  });
  assert(
    rootWatchPaths.length === 1,
    `${snapshotId} snapshot has ${String(rootWatchPaths.length)} Vite root watcher patch sites`,
  );
  const rootWatchPath = rootWatchPaths[0]?.path;
  const nodeModules = snapshot.nodeModules.files
    .map((file) => {
      assert(
        file.encoding === 'base64' || file.encoding === 'utf8',
        `unsupported snapshot file encoding ${JSON.stringify(file.encoding)} at ${file.path}`,
      );
      let bytes =
        file.encoding === 'base64'
          ? Buffer.from(file.content, 'base64')
          : Buffer.from(file.content, 'utf8');
      if (file.path === 'vite/dist/node/cli.js') {
        bytes = Buffer.from(applyViteCliActionPatch(bytes.toString('utf8')), 'utf8');
      } else if (file.path === rootWatchPath) {
        bytes = Buffer.from(applyViteRootWatchPatch(bytes.toString('utf8')), 'utf8');
      }
      return Object.freeze({
        path: file.path,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      });
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  assert(
    new Set(nodeModules.map((file) => file.path)).size === nodeModules.length,
    `${snapshotId} snapshot has duplicate node_modules paths`,
  );
  return Object.freeze({
    snapshotId,
    packageJsonSha256: sha256(snapshot.packageJsonText),
    lockfileSha256: sha256(snapshot.lockfile),
    nodeModules: Object.freeze(nodeModules),
  });
}

function loadFrozenBuildInputs(): FrozenBuildInputs {
  const workspace = readJson<{ readonly name?: string }>(join(REPO, 'package.json'));
  assert(
    workspace.name === 'rifty-workspace',
    `expected rifty-workspace root: ${String(workspace.name)}`,
  );
  const definition = loadDefinitionSource();
  const snapshotDelta = loadSnapshotDelta();
  const historicalIdentitiesPath = join(FIXTURES, 'baked-snapshot-identities.json');
  const historicalIdentitiesSource = readFileSync(historicalIdentitiesPath, 'utf8');
  const historicalIdentities = parseJson<BakedSnapshotIdentities>(
    historicalIdentitiesSource,
    'historical baked identities',
  );
  const currentIdentities = readJson<BakedSnapshotIdentities>(IDENTITIES_PATH);
  assert(
    historicalIdentities.version === 1 && currentIdentities.version === 1,
    'baked identities version drifted',
  );
  assert(
    historicalIdentities.snapshots.vite8 === snapshotDelta.fixture.historicalSnapshotId,
    `historical baked Vite 8 identity drifted: ${historicalIdentities.snapshots.vite8}`,
  );
  assert(
    currentIdentities.snapshots.vite8 === snapshotDelta.fixture.baseSnapshotId,
    `current baked Vite 8 identity drifted: ${currentIdentities.snapshots.vite8}`,
  );
  for (const id of ['typescript', 'vite'] as const) {
    assert(
      historicalIdentities.snapshots[id] === currentIdentities.snapshots[id],
      `historical baked ${id} identity drifted from current`,
    );
  }
  const currentSnapshotSource = gunzipSync(readFileSync(SNAPSHOT_PATH)).toString('utf8');
  const historicalSnapshotSource = reconstructHistoricalSnapshot(
    snapshotDelta.fixture,
    snapshotDelta.delta,
  );
  return Object.freeze({
    evidence: Object.freeze({
      historicalCommit: definition.fixture.sourceCommit,
      historicalDefinitionSha256: definition.fixture.sourceSha256,
      currentSnapshotId: snapshotDelta.fixture.baseSnapshotId,
      historicalSnapshotId: snapshotDelta.fixture.historicalSnapshotId,
    }),
    snapshots: Object.freeze({
      historical: snapshotProof(
        historicalSnapshotSource,
        snapshotDelta.fixture.historicalSnapshotId,
      ),
      current: snapshotProof(currentSnapshotSource, snapshotDelta.fixture.baseSnapshotId),
    }),
    historicalDefinitionSource: definition.source,
    historicalIdentitiesSource,
    historicalSnapshotSource,
  });
}

function historicalPlugin(inputs: FrozenBuildInputs) {
  return {
    name: 'e2e:vite8-pre-policy-build-inputs',
    enforce: 'pre' as const,
    load(id: string) {
      const clean = id.split('?', 1)[0];
      if (clean === DEFINITION_PATH) return inputs.historicalDefinitionSource;
      if (clean === IDENTITIES_PATH) return inputs.historicalIdentitiesSource;
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
        if (request.url?.split('?', 1)[0] !== '/snapshots/vite8-node-modules.json.gz') {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader(
          'Content-Length',
          String(Buffer.byteLength(inputs.historicalSnapshotSource)),
        );
        response.end(inputs.historicalSnapshotSource);
      });
    },
  };
}

async function startViteServer(
  phase: 'historical' | 'current',
  requestedPort: number,
  cacheDirectory: string,
  inputs: FrozenBuildInputs,
): Promise<ActiveServer> {
  const viteModuleUrl = pathToFileURL(join(APP, 'node_modules/vite/dist/node/index.js')).href;
  const vite = (await import(viteModuleUrl)) as ViteRuntime;
  const loaded = await vite.loadConfigFromFile(
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
  const server = await vite.createServer({
    ...loaded.config,
    configFile: false,
    root: APP,
    cacheDir: join(cacheDirectory, `vite-cache-${phase}`),
    clearScreen: false,
    plugins: [...filteredPlugins, ...(phase === 'historical' ? [historicalPlugin(inputs)] : [])],
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
  return Object.freeze({
    phase,
    server,
    port: address.port,
    url: `http://127.0.0.1:${String(address.port)}`,
  });
}

export async function createVite8CrossBuildHarness(): Promise<Vite8CrossBuildHarness> {
  const inputs = loadFrozenBuildInputs();
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'rifty-vite8-crossbuild-e2e-'));
  let state: 'new' | 'historical' | 'current' | 'closed' = 'new';
  let active: ActiveServer | null = null;
  let stablePort: number | null = null;

  return Object.freeze({
    evidence: inputs.evidence,
    snapshots: inputs.snapshots,
    async startHistorical() {
      assert(state === 'new', `historical Vite app cannot start from ${state} state`);
      active = await startViteServer('historical', 0, cacheDirectory, inputs);
      stablePort = active.port;
      state = 'historical';
      return Object.freeze({ phase: active.phase, port: active.port, url: active.url });
    },
    async startCurrent() {
      assert(
        state === 'historical' && active !== null && stablePort !== null,
        `current Vite app cannot start from ${state} state`,
      );
      await active.server.close();
      active = null;
      const current = await startViteServer('current', stablePort, cacheDirectory, inputs);
      assert(current.port === stablePort, 'current Vite app changed the historical origin');
      active = current;
      state = 'current';
      return Object.freeze({ phase: current.phase, port: current.port, url: current.url });
    },
    async close() {
      if (state === 'closed') return;
      state = 'closed';
      const server = active;
      active = null;
      try {
        await server?.server.close();
      } finally {
        await rm(cacheDirectory, { recursive: true, force: true });
      }
    },
  });
}
