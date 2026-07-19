import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { gzipSync } from 'node:zlib';
import { globalProcessManager } from '@riftydev/kernel';
import {
  type InstallOptions,
  type InstallResult,
  type Packument,
  RegistryClient,
  type ShadowAssetManager,
  type ShadowAssetSource,
  createMemoryShadowAssetStorage,
  createShadowAssetManager,
  install as npmClientInstall,
  shadowAssetPlanFromLockfileBytes,
} from '@riftydev/npm-client';
import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import type { CommandContext, ProcessExit } from '@riftydev/shell';
import {
  MemoryFsSync,
  createMemoryFs,
  resetSyncMirror,
  setSyncMirror,
} from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ASSET_MAX_BYTES, DEFAULT_ASSET_STALL_MS } from '../glue/bounded-asset-fetch.ts';
import { buildDepSnapshot, serializeDepSnapshot } from '../glue/dep-snapshot.ts';
import type { InstallFn } from '../glue/npm-shell-command.ts';
import { createPtyClient } from '../glue/pty-client.ts';
import type { OwnerToPageFrame } from '../glue/pty-protocol.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { publishedEsbuildWasmTarball } from '../test-fixtures/published-esbuild-wasm-tarball.ts';
import { projectTerminalStateFromOwner } from '../workbench/internal/playground-terminal-state.ts';
import { createProjectRuntimeAcquisitionController } from '../workbench/internal/project-runtime-acquisition.ts';
import { createNodeCliProjectRuntime } from '../workbench/node-project-runtime.ts';
import { createPreviewReadiness } from '../workbench/preview-readiness.ts';
import { createUnusedProjectContent } from '../workbench/project-content.test-fixture.ts';
import {
  type InspectedProjectDefinition,
  defineNodeCliProject,
  inspectProjectDefinition,
  projects,
} from '../workbench/project-definition.ts';
import {
  type MaterializedProject,
  createProjectMaterializer,
} from '../workbench/project-materialization.ts';
import {
  type ProjectRuntime,
  type ProjectSession,
  createProjectSession,
} from '../workbench/project-session.ts';
import {
  type ProjectTerminalPortState,
  createProjectTerminal,
} from '../workbench/project-terminal.ts';
import { createViteProjectRuntime } from '../workbench/vite-project-runtime.ts';
import { type OwnerPackageState, createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import type { AcquisitionProvenance, SnapshotFailure } from './package-acquisition-authority.ts';
import { workbenchPackageConfig } from './workbench-package-config.ts';
import { createWorkbenchProjectComposition } from './workbench-project-composition.ts';
import { createWorkbenchProjectRuntime } from './workbench-project-runtime.ts';
import { createWorkbenchProjectStore } from './workbench-project-store.ts';
import { createWorkbenchProjectVfs } from './workbench-project-vfs.ts';
import { createNpmPackageRuntimeAssetPort } from './workbench-runtime-assets.ts';

const VITE_PORT = 6_127;
const OWNER_TOKEN = 'first-materialization-owner';
const NODE_ENTRY_WORKER_URL = 'https://playground.test/workers/node-entry.js';
const DEV_SERVER_WORKER_URL = 'https://playground.test/workers/dev-server.js';
const NODE_WORKER_RUNTIME_ENV = Object.freeze({
  RIFTY_KERNEL_WORKER_URL: 'https://playground.test/workers/kernel.js',
  RIFTY_NODE_ENTRY_WORKER_URL: NODE_ENTRY_WORKER_URL,
  RIFTY_SQLITE_WASM_URL: 'https://playground.test/sqlite.wasm',
});
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type FirstMaterialization =
  | { readonly kind: 'install' }
  | {
      readonly kind: 'snapshot';
      readonly snapshot: {
        readonly snapshotId: string;
        readonly assetUrl: string;
        readonly templateId: string;
      };
    };

type PlaygroundDefinition<TReady = unknown> = InspectedProjectDefinition<TReady> & {
  readonly starterId: string;
  readonly templateId: string;
  readonly firstMaterialization: FirstMaterialization;
  readonly port?: number;
};

/** Owner-born decision: the page consumes it, but never reconstructs package state. */
type ProjectAcquisitionPlan =
  | { readonly kind: 'ready'; readonly provenance: AcquisitionProvenance }
  | { readonly kind: 'install'; readonly snapshotFailures: readonly SnapshotFailure[] };

interface Timeline {
  readonly events: string[];
  readonly installs: InstallOptions[];
  activeInstalls: number;
  maxActiveInstalls: number;
}

interface OwnerHarnessOptions {
  readonly beforeInstallReturn?: (options: InstallOptions) => Promise<void>;
  readonly createInstall?: (timeline: Timeline) => InstallFn;
  readonly registry?: RegistryClient;
  readonly runtimeAssetManager?: ShadowAssetManager;
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function writeTarString(target: Uint8Array, value: string, offset: number, length: number): void {
  target.set(encoder.encode(value).subarray(0, length), offset);
}

function tarHeader(path: string, size: number): Uint8Array {
  const header = new Uint8Array(512);
  writeTarString(header, path, 0, 100);
  writeTarString(header, '0000644', 100, 7);
  writeTarString(header, '0000000', 108, 7);
  writeTarString(header, '0000000', 116, 7);
  writeTarString(header, size.toString(8).padStart(11, '0'), 124, 11);
  header[135] = 0x20;
  writeTarString(header, '00000000000', 136, 11);
  header[147] = 0x20;
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeTarString(header, 'ustar', 257, 6);
  writeTarString(header, '00', 263, 2);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarString(header, checksum.toString(8).padStart(6, '0'), 148, 6);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function fixturePackageTarball(
  manifest: Readonly<Record<string, unknown>>,
  files: Readonly<Record<string, string>> = {},
): Uint8Array {
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  const entries = [
    { path: 'package/package.json', bytes: manifestBytes },
    ...Object.entries(files).map(([path, content]) => ({
      path: `package/${path}`,
      bytes: encoder.encode(content),
    })),
  ];
  const archive: Uint8Array[] = [];
  for (const entry of entries) {
    const padded = new Uint8Array(Math.ceil(entry.bytes.byteLength / 512) * 512);
    padded.set(entry.bytes);
    archive.push(tarHeader(entry.path, entry.bytes.byteLength), padded);
  }
  archive.push(new Uint8Array(1024));
  return new Uint8Array(gzipSync(concatBytes(...archive)));
}

const VITE_SEVEN_MANIFEST = Object.freeze({
  name: 'vite',
  version: '7.3.6',
  dependencies: Object.freeze({ esbuild: '^0.27.0 || ^0.28.0' }),
  bin: Object.freeze({ vite: 'bin/vite.js' }),
});
const ESBUILD_MANIFEST = Object.freeze({
  name: 'esbuild',
  version: '0.28.0',
});

class ViteSevenRegistry extends RegistryClient {
  constructor() {
    super({ baseUrl: '/unused', fetch: async () => new Response(null, { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    if (name === 'vite') {
      return {
        name,
        'dist-tags': { latest: VITE_SEVEN_MANIFEST.version },
        versions: {
          [VITE_SEVEN_MANIFEST.version]: {
            name: VITE_SEVEN_MANIFEST.name,
            version: VITE_SEVEN_MANIFEST.version,
            dependencies: { ...VITE_SEVEN_MANIFEST.dependencies },
            bin: { ...VITE_SEVEN_MANIFEST.bin },
            dist: { tarball: 'fixture://vite/7.3.6' },
          },
        },
      };
    }
    if (name === ESBUILD_MANIFEST.name) {
      return {
        name,
        'dist-tags': { latest: ESBUILD_MANIFEST.version },
        versions: {
          [ESBUILD_MANIFEST.version]: {
            name: ESBUILD_MANIFEST.name,
            version: ESBUILD_MANIFEST.version,
            dist: { tarball: 'fixture://esbuild/0.28.0' },
          },
        },
      };
    }
    throw new Error(`Vite 7 fixture registry received unexpected packument ${name}`);
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    if (url === 'fixture://vite/7.3.6') {
      return fixturePackageTarball(VITE_SEVEN_MANIFEST, {
        'bin/vite.js': '#!/usr/bin/env node\n',
      });
    }
    if (url === 'fixture://esbuild/0.28.0') {
      throw new Error('Vite 7 synthetic esbuild must not request a tarball');
    }
    throw new Error(`Vite 7 fixture registry received unexpected tarball ${url}`);
  }
}

interface ViteSevenRuntimeAssets {
  readonly manager: ShadowAssetManager;
  readonly registry: RegistryClient;
  readonly entered: Promise<void>;
  attempts(): number;
  release(): void;
}

function viteSevenRuntimeAssets(
  options: {
    readonly gateFirst?: boolean;
    readonly failFirst?: boolean;
  } = {},
): ViteSevenRuntimeAssets {
  const descriptor = builtinShadowAssetCatalog.assets[0];
  if (descriptor === undefined) throw new Error('builtin catalog omitted the Vite 7 runtime asset');
  const entered = deferred();
  const release = deferred();
  let attempts = 0;
  const source: ShadowAssetSource = {
    acquire: async (requests) => {
      attempts += 1;
      entered.resolve();
      if (options.gateFirst === true && attempts === 1) await release.promise;
      if (options.failFirst === true && attempts === 1) {
        throw new Error('injected first runtime-asset source failure');
      }
      const bytes = await publishedEsbuildWasmTarball();
      return requests.map((request) => {
        if (
          request.name !== descriptor.source.name ||
          request.version !== descriptor.source.version ||
          request.integrity !== descriptor.source.integrity ||
          request.maxTarballBytes !== descriptor.maxTarballBytes
        ) {
          throw new Error('Vite 7 runtime-asset source received a non-canonical request');
        }
        return Object.freeze({
          request: Object.freeze({ ...request }),
          bytes: bytes.slice(),
          fillTransport: 'standard' as const,
          fillCache: 'network' as const,
        });
      });
    },
    close: async () => undefined,
  };
  return {
    manager: createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source,
    }),
    registry: new ViteSevenRegistry(),
    entered: entered.promise,
    attempts: () => attempts,
    release: release.resolve,
  };
}

function installResult(name: string, version: string): InstallResult {
  return {
    packages: [{ name, version, dependencies: {}, files: {} }],
    lockfile: {
      name: 'app',
      version: '0.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {},
    },
    conflicts: [],
    provenance: {
      resolution: 'metadata',
      packages: [{ name, version, transport: 'registry' }],
    },
  };
}

function realInstallBoundary(
  timeline: Timeline,
  beforeReturn?: (options: InstallOptions) => Promise<void>,
): InstallFn {
  return async (input) => {
    if (typeof input !== 'object') throw new Error('Expected InstallOptions');
    const options = input as InstallOptions;
    const packageJsonText = await options.vfs.readFileText(`${options.cwd}/package.json`);
    const requested = Object.entries(dependencyMap(packageJsonText))[0];
    if (requested === undefined) throw new Error('Test install expected one dependency');
    const [name, version] = requested;
    timeline.events.push(`install:start:${options.cwd}`);
    timeline.installs.push(options);
    timeline.activeInstalls += 1;
    timeline.maxActiveInstalls = Math.max(timeline.maxActiveInstalls, timeline.activeInstalls);
    try {
      const result = installResult(name, version);
      options.onTreeMutationStart?.();
      await options.vfs.mkdir(`${options.cwd}/node_modules/${name}`, { recursive: true });
      await options.vfs.writeFile(
        `${options.cwd}/node_modules/${name}/package.json`,
        `${JSON.stringify({ name, version })}\n`,
      );
      if (name === 'vite') {
        await options.vfs.mkdir(`${options.cwd}/node_modules/.bin`, { recursive: true });
        await options.vfs.writeFile(
          `${options.cwd}/node_modules/.bin/vite`,
          '#!/usr/bin/env node\n',
        );
      }
      await options.vfs.writeFile(
        `${options.cwd}/package-lock.json`,
        JSON.stringify(result.lockfile, null, 2),
      );
      options.onPackage?.({ name, version, cacheHit: false });
      await beforeReturn?.(options);
      timeline.events.push(`install:end:${options.cwd}`);
      return result;
    } finally {
      timeline.activeInstalls -= 1;
    }
  };
}

function npmClientInstallBoundary(timeline: Timeline): InstallFn {
  return async (input) => {
    if (typeof input !== 'object') throw new Error('Expected InstallOptions');
    const options = input as InstallOptions;
    timeline.events.push(`install:start:${options.cwd}`);
    timeline.installs.push(options);
    timeline.activeInstalls += 1;
    timeline.maxActiveInstalls = Math.max(timeline.maxActiveInstalls, timeline.activeInstalls);
    try {
      const result = await npmClientInstall(options);
      timeline.events.push(`install:end:${options.cwd}`);
      return result;
    } finally {
      timeline.activeInstalls -= 1;
    }
  };
}

function withPlaygroundMetadata<TReady>(
  definition: InspectedProjectDefinition<TReady>,
  metadata: {
    readonly starterId: string;
    readonly templateId: string;
    readonly firstMaterialization: FirstMaterialization;
    readonly port?: number;
  },
): PlaygroundDefinition<TReady> {
  return Object.freeze({ ...definition, ...metadata });
}

function viteDefinition(
  firstMaterialization: FirstMaterialization,
  id = 'vite-project',
  viteVersion = '8.0.16',
): PlaygroundDefinition {
  return withPlaygroundMetadata(
    inspectProjectDefinition(
      projects.vite({
        id,
        files: {
          '/index.html': '<main id="app"></main>',
          '/src/main.ts': "console.log('vite output')\n",
        },
        viteVersion,
      }),
    ),
    {
      starterId: 'vite-starter',
      templateId: 'vite-template-v1',
      firstMaterialization,
      port: VITE_PORT,
    },
  );
}

function cliDefinition(): PlaygroundDefinition<void> {
  return withPlaygroundMetadata(
    inspectProjectDefinition(
      defineNodeCliProject({
        id: 'cli-project',
        files: { '/src/cli.mjs': "console.log('cli output')\n" },
        dependencies: { kleur: '4.1.5' },
        entryPath: '/src/cli.mjs',
        args: ['--format', 'json'],
      }),
    ),
    {
      starterId: 'cli-starter',
      templateId: 'cli-template-v1',
      firstMaterialization: { kind: 'install' },
    },
  );
}

function noDependencyCliDefinition(): PlaygroundDefinition<void> {
  return withPlaygroundMetadata(
    inspectProjectDefinition(
      defineNodeCliProject({
        id: 'no-dependency-cli-project',
        files: { '/src/cli.mjs': "console.log('no-dependency cli output')\n" },
        entryPath: '/src/cli.mjs',
      }),
    ),
    {
      starterId: 'no-dependency-cli-starter',
      templateId: 'no-dependency-cli-template-v1',
      firstMaterialization: { kind: 'install' },
    },
  );
}

function dependencyMap(packageJsonText: string): Record<string, string> {
  const manifest = JSON.parse(packageJsonText) as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const value = manifest[field];
    if (value === undefined) continue;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Test manifest ${field} is invalid`);
    }
    for (const [name, version] of Object.entries(value)) {
      if (typeof version !== 'string') throw new Error(`Test manifest ${field}.${name} is invalid`);
      result[name] = version;
    }
  }
  return result;
}

function bakedSnapshot(
  definition: PlaygroundDefinition,
  templateId: string,
): ReturnType<typeof buildDepSnapshot> {
  const packageJsonBytes = definition.files['/package.json'];
  if (packageJsonBytes === undefined) throw new Error('Definition omitted normalized package.json');
  const packageJsonText = decoder.decode(packageJsonBytes);
  const root = '/bake';
  const fs = new MemoryFsSync();
  fs.mkdirSync(`${root}/node_modules/vite`, { recursive: true });
  fs.mkdirSync(`${root}/node_modules/.bin`, { recursive: true });
  fs.writeFileSync(`${root}/package.json`, encoder.encode(packageJsonText));
  fs.writeFileSync(
    `${root}/node_modules/vite/package.json`,
    encoder.encode('{"name":"vite","version":"8.0.16"}\n'),
  );
  fs.writeFileSync(`${root}/node_modules/.bin/vite`, encoder.encode('#!/usr/bin/env node\n'));
  fs.writeFileSync(
    `${root}/package-lock.json`,
    encoder.encode(JSON.stringify(installResult('vite', '8.0.16').lockfile, null, 2)),
  );
  return buildDepSnapshot(fs, root, {
    templateId,
    deps: dependencyMap(packageJsonText),
    packages: 1,
  });
}

function serializedSnapshotFixture(
  definition: PlaygroundDefinition,
  templateId: string,
): { readonly bytes: Uint8Array; readonly snapshotId: string } {
  const bytes = encoder.encode(serializeDepSnapshot(bakedSnapshot(definition, templateId)));
  return snapshotFixtureFromBytes(bytes);
}

function snapshotFixtureFromBytes(bytes: Uint8Array): {
  readonly bytes: Uint8Array;
  readonly snapshotId: string;
} {
  return {
    bytes,
    snapshotId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function snapshotFixtureFromValue(snapshot: ReturnType<typeof buildDepSnapshot>): {
  readonly bytes: Uint8Array;
  readonly snapshotId: string;
} {
  return snapshotFixtureFromBytes(encoder.encode(serializeDepSnapshot(snapshot)));
}

function staleSnapshotId(snapshotId: string): string {
  const finalNibble = snapshotId.at(-1);
  if (finalNibble === undefined) throw new Error('Snapshot id is empty');
  return `${snapshotId.slice(0, -1)}${finalNibble === '0' ? '1' : '0'}`;
}

function gzipSnapshot(bytes: Uint8Array, level: number): Uint8Array<ArrayBuffer> {
  const compressed = gzipSync(bytes, { level });
  const copied = new Uint8Array(compressed.byteLength);
  copied.set(compressed);
  return copied;
}

type SnapshotFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface PreparedSnapshotFault {
  readonly snapshotId: string;
  readonly templateId: string;
  readonly expectedReason: string;
  readonly fetch: SnapshotFetch;
  readonly afterOpenStarted?: () => Promise<void>;
  readonly triggerFault?: () => Promise<void>;
  readonly beforeOpen?: (harness: OwnerHarness, definition: PlaygroundDefinition) => void;
  readonly assertBoundary?: () => void;
}

interface SnapshotFallbackCase {
  readonly name: string;
  readonly slug: string;
  prepare(definition: PlaygroundDefinition, assetUrl: string): PreparedSnapshotFault;
}

function snapshotFetchFailure(
  assetUrl: string,
  stage: 'fetch' | 'decompress' | 'parse',
  detail: string,
): string {
  const label = `dependency snapshot ${assetUrl}${stage === 'decompress' ? ' decompression' : ''}`;
  return `snapshot-fetch-failed: Dependency snapshot ${assetUrl} ${stage} failed: ${label}: ${detail}`;
}

function gzipResponse(bytes: Uint8Array): Promise<Response> {
  return Promise.resolve(new Response(gzipSnapshot(bytes, 6)));
}

function differentPackageJsonSnapshot(
  definition: PlaygroundDefinition,
  templateId: string,
): ReturnType<typeof buildDepSnapshot> {
  const snapshot = bakedSnapshot(definition, templateId);
  const manifest = JSON.parse(snapshot.packageJsonText) as Record<string, unknown>;
  let changed = false;
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const candidate = manifest[field];
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const dependencies = candidate as Record<string, unknown>;
    if (typeof dependencies.vite !== 'string') continue;
    dependencies.vite = '0.0.0-review-mismatch';
    changed = true;
  }
  if (!changed) throw new Error('Vite fault fixture has no dependency to change');
  const packageJsonText = `${JSON.stringify(manifest)}\n`;
  return { ...snapshot, packageJsonText, deps: dependencyMap(packageJsonText) };
}

function logicalOverCapDecompressionStream(
  formats: string[],
  boundary: {
    pulls: number;
    cancelled: boolean;
    exhausted: boolean;
  },
): typeof DecompressionStream {
  return class {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<BufferSource>;

    constructor(format: string) {
      formats.push(format);
      const chunk = new Uint8Array(1024 * 1024);
      const availableChunks = DEFAULT_ASSET_MAX_BYTES / chunk.byteLength + 32;
      this.readable = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (boundary.pulls === availableChunks) {
            boundary.exhausted = true;
            controller.close();
            return;
          }
          boundary.pulls += 1;
          controller.enqueue(chunk);
        },
        cancel() {
          boundary.cancelled = true;
        },
      });
      this.writable = new WritableStream<BufferSource>({ write: () => {} });
    }
  } as unknown as typeof DecompressionStream;
}

function logicalOverCapByteStream(boundary: {
  pulls: number;
  cancelled: boolean;
  exhausted: boolean;
}): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(1024 * 1024);
  const chunkCount = DEFAULT_ASSET_MAX_BYTES / chunk.byteLength + 32;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (boundary.pulls === chunkCount) {
        boundary.exhausted = true;
        controller.close();
        return;
      }
      boundary.pulls += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      boundary.cancelled = true;
    },
  });
}

function stalledDecompressionStream(
  formats: string[],
  onStarted: () => void,
  onCancelled: () => void,
): typeof DecompressionStream {
  return class {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<BufferSource>;

    constructor(format: string) {
      formats.push(format);
      this.readable = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([0x7b]));
        },
        pull() {
          onStarted();
        },
        cancel() {
          onCancelled();
        },
      });
      this.writable = new WritableStream<BufferSource>({ write: () => {} });
    }
  } as unknown as typeof DecompressionStream;
}

const SNAPSHOT_FALLBACK_CASES: readonly SnapshotFallbackCase[] = [
  {
    name: '10s response-header timeout',
    slug: 'header-timeout',
    prepare: (_definition, assetUrl) => {
      vi.useFakeTimers();
      const started = deferred();
      let signal: AbortSignal | undefined;
      return {
        snapshotId: `sha256:${'1'.repeat(64)}`,
        templateId: 'vite-deps-current',
        expectedReason: snapshotFetchFailure(
          assetUrl,
          'fetch',
          `no response headers for ${String(DEFAULT_ASSET_STALL_MS)}ms`,
        ),
        fetch: (_input, init) => {
          signal = init?.signal ?? undefined;
          started.resolve();
          return new Promise<Response>(() => {});
        },
        afterOpenStarted: async () => {
          await started.promise;
          await vi.advanceTimersByTimeAsync(DEFAULT_ASSET_STALL_MS - 1);
          expect(signal?.aborted).toBe(false);
        },
        triggerFault: async () => {
          await vi.advanceTimersByTimeAsync(1);
          expect(signal?.aborted).toBe(true);
        },
        assertBoundary: () => expect(signal?.aborted).toBe(true),
      };
    },
  },
  {
    name: '10s per-chunk no-progress timeout',
    slug: 'body-timeout',
    prepare: (_definition, assetUrl) => {
      vi.useFakeTimers();
      const started = deferred();
      let signal: AbortSignal | undefined;
      return {
        snapshotId: `sha256:${'2'.repeat(64)}`,
        templateId: 'vite-deps-current',
        expectedReason: snapshotFetchFailure(
          assetUrl,
          'fetch',
          `no body progress for ${String(DEFAULT_ASSET_STALL_MS)}ms`,
        ),
        fetch: (_input, init) => {
          signal = init?.signal ?? undefined;
          return Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(Uint8Array.from([0x7b]));
                },
                pull() {
                  started.resolve();
                },
              }),
            ),
          );
        },
        afterOpenStarted: async () => {
          await started.promise;
          await vi.advanceTimersByTimeAsync(DEFAULT_ASSET_STALL_MS - 1);
          expect(signal?.aborted).toBe(false);
        },
        triggerFault: async () => {
          await vi.advanceTimersByTimeAsync(1);
          expect(signal?.aborted).toBe(true);
        },
        assertBoundary: () => expect(signal?.aborted).toBe(true),
      };
    },
  },
  {
    name: '10s decompressed per-chunk no-progress timeout',
    slug: 'decompressed-body-timeout',
    prepare: (_definition, assetUrl) => {
      vi.useFakeTimers();
      const started = deferred();
      const formats: string[] = [];
      let cancelled = false;
      vi.stubGlobal(
        'DecompressionStream',
        stalledDecompressionStream(formats, started.resolve, () => {
          cancelled = true;
        }),
      );
      return {
        snapshotId: `sha256:${'d'.repeat(64)}`,
        templateId: 'vite-deps-current',
        expectedReason: snapshotFetchFailure(
          assetUrl,
          'decompress',
          `no body progress for ${String(DEFAULT_ASSET_STALL_MS)}ms`,
        ),
        fetch: async () => new Response(Uint8Array.from([0x1f, 0x8b, 0x00])),
        afterOpenStarted: async () => {
          await started.promise;
          await vi.advanceTimersByTimeAsync(DEFAULT_ASSET_STALL_MS - 1);
          expect(cancelled).toBe(false);
        },
        triggerFault: async () => {
          await vi.advanceTimersByTimeAsync(1);
          expect(cancelled).toBe(true);
        },
        assertBoundary: () => {
          expect(formats).toEqual(['gzip']);
          expect(cancelled).toBe(true);
        },
      };
    },
  },
  {
    name: '128MiB fetched-byte cap',
    slug: 'fetch-cap',
    prepare: (_definition, assetUrl) => ({
      snapshotId: `sha256:${'3'.repeat(64)}`,
      templateId: 'vite-deps-current',
      expectedReason: snapshotFetchFailure(
        assetUrl,
        'fetch',
        `body exceeded ${String(DEFAULT_ASSET_MAX_BYTES)} bytes`,
      ),
      fetch: async () =>
        new Response(null, {
          headers: { 'content-length': String(DEFAULT_ASSET_MAX_BYTES + 1) },
        }),
    }),
  },
  ...(['missing', 'lying'] as const).map(
    (lengthKind): SnapshotFallbackCase => ({
      name: `128MiB streamed fetched-byte cap with ${lengthKind} Content-Length`,
      slug: `fetch-stream-cap-${lengthKind}-length`,
      prepare: (_definition, assetUrl) => {
        const boundary = { pulls: 0, cancelled: false, exhausted: false };
        return {
          snapshotId: `sha256:${(lengthKind === 'missing' ? '5' : '6').repeat(64)}`,
          templateId: 'vite-deps-current',
          expectedReason: snapshotFetchFailure(
            assetUrl,
            'fetch',
            `body exceeded ${String(DEFAULT_ASSET_MAX_BYTES)} bytes`,
          ),
          fetch: async () =>
            new Response(logicalOverCapByteStream(boundary), {
              ...(lengthKind === 'lying' ? { headers: { 'content-length': '1' } } : {}),
            }),
          assertBoundary: () => {
            expect(boundary.pulls * 1024 * 1024).toBeGreaterThan(DEFAULT_ASSET_MAX_BYTES);
            expect(boundary.pulls).toBeLessThan(DEFAULT_ASSET_MAX_BYTES / (1024 * 1024) + 32);
            expect(boundary.cancelled).toBe(true);
            expect(boundary.exhausted).toBe(false);
          },
        };
      },
    }),
  ),
  {
    name: '128MiB decompressed-byte cap',
    slug: 'decompress-cap',
    prepare: (_definition, assetUrl) => {
      const formats: string[] = [];
      const boundary = { pulls: 0, cancelled: false, exhausted: false };
      vi.stubGlobal('DecompressionStream', logicalOverCapDecompressionStream(formats, boundary));
      return {
        snapshotId: `sha256:${'4'.repeat(64)}`,
        templateId: 'vite-deps-current',
        expectedReason: snapshotFetchFailure(
          assetUrl,
          'decompress',
          `body exceeded ${String(DEFAULT_ASSET_MAX_BYTES)} bytes`,
        ),
        fetch: async () => new Response(Uint8Array.from([0x1f, 0x8b, 0x00])),
        assertBoundary: () => {
          expect(formats).toEqual(['gzip']);
          expect(boundary.pulls * 1024 * 1024).toBeGreaterThan(DEFAULT_ASSET_MAX_BYTES);
          expect(boundary.pulls).toBeLessThan(DEFAULT_ASSET_MAX_BYTES / (1024 * 1024) + 32);
          expect(boundary.cancelled).toBe(true);
          expect(boundary.exhausted).toBe(false);
        },
      };
    },
  },
  {
    name: 'parsed snapshot version failure',
    slug: 'parse-failure',
    prepare: (_definition, assetUrl) => {
      const fixture = snapshotFixtureFromBytes(encoder.encode('{"version":1}'));
      return {
        snapshotId: fixture.snapshotId,
        templateId: 'vite-deps-current',
        expectedReason: snapshotFetchFailure(
          assetUrl,
          'parse',
          'Unsupported dep snapshot version 1',
        ),
        fetch: () => gzipResponse(fixture.bytes),
      };
    },
  },
  {
    name: 'snapshot deps disagree with its package.json',
    slug: 'deps-mismatch',
    prepare: (definition, assetUrl) => {
      const snapshot = bakedSnapshot(definition, 'vite-deps-current');
      const fixture = snapshotFixtureFromValue({
        ...snapshot,
        deps: { ...snapshot.deps, vite: '0.0.0-review-mismatch' },
      });
      return {
        snapshotId: fixture.snapshotId,
        templateId: 'vite-deps-current',
        expectedReason: snapshotFetchFailure(
          assetUrl,
          'parse',
          'Malformed dep snapshot: deps do not match packageJsonText',
        ),
        fetch: () => gzipResponse(fixture.bytes),
      };
    },
  },
  {
    name: 'snapshot package.json differs from the definition',
    slug: 'package-json-mismatch',
    prepare: (definition) => {
      const fixture = snapshotFixtureFromValue(
        differentPackageJsonSnapshot(definition, 'vite-deps-current'),
      );
      return {
        snapshotId: fixture.snapshotId,
        templateId: 'vite-deps-current',
        expectedReason: 'package-json-mismatch',
        fetch: () => gzipResponse(fixture.bytes),
      };
    },
  },
  {
    name: 'snapshot installArtifactIdentity differs from the runtime',
    slug: 'identity-mismatch',
    prepare: (definition) => {
      const snapshot = bakedSnapshot(definition, 'vite-deps-current');
      const fixture = snapshotFixtureFromValue({
        ...snapshot,
        installArtifactIdentity: staleSnapshotId(snapshot.installArtifactIdentity),
      });
      return {
        snapshotId: fixture.snapshotId,
        templateId: 'vite-deps-current',
        expectedReason: 'install-artifact-identity-mismatch',
        fetch: () => gzipResponse(fixture.bytes),
      };
    },
  },
  {
    name: 'snapshot template differs from its trusted descriptor',
    slug: 'template-mismatch',
    prepare: (definition) => {
      const fixture = serializedSnapshotFixture(definition, 'vite-deps-wrong');
      return {
        snapshotId: fixture.snapshotId,
        templateId: 'vite-deps-current',
        expectedReason: 'snapshot-template-mismatch',
        fetch: () => gzipResponse(fixture.bytes),
      };
    },
  },
  {
    name: 'descriptor id differs from exact serialized bytes',
    slug: 'snapshot-id-mismatch',
    prepare: (definition) => {
      const fixture = serializedSnapshotFixture(definition, 'vite-deps-current');
      return {
        snapshotId: staleSnapshotId(fixture.snapshotId),
        templateId: 'vite-deps-current',
        expectedReason: 'snapshot-id-mismatch',
        fetch: () => gzipResponse(fixture.bytes),
      };
    },
  },
  {
    name: 'hash mismatch wins before malformed bytes are parsed',
    slug: 'hash-before-parse',
    prepare: (_definition) => {
      const fixture = snapshotFixtureFromBytes(encoder.encode('{"version":1}'));
      return {
        snapshotId: staleSnapshotId(fixture.snapshotId),
        templateId: 'vite-deps-current',
        expectedReason: 'snapshot-id-mismatch',
        fetch: () => gzipResponse(fixture.bytes),
      };
    },
  },
  {
    name: 'snapshot restore plan rejects an unsafe archive before tree mutation',
    slug: 'restore-plan-failure',
    prepare: (definition) => {
      const snapshot = bakedSnapshot(definition, 'vite-deps-current');
      const fixture = snapshotFixtureFromValue({
        ...snapshot,
        nodeModules: {
          ...snapshot.nodeModules,
          files: [{ path: '../escape', encoding: 'base64', content: '' }],
        },
      });
      return {
        snapshotId: fixture.snapshotId,
        templateId: 'vite-deps-current',
        expectedReason: 'snapshot-restore-plan-failed: Unsafe archive path "../escape"',
        fetch: () => gzipResponse(fixture.bytes),
      };
    },
  },
  {
    name: 'snapshot restore apply failure records its exact reason',
    slug: 'restore-apply-failure',
    prepare: (definition) => {
      const fixture = serializedSnapshotFixture(definition, 'vite-deps-current');
      let restoreFetched = false;
      return {
        snapshotId: fixture.snapshotId,
        templateId: 'vite-deps-current',
        expectedReason: 'snapshot-restore-failed: injected restore apply failure',
        fetch: () => {
          restoreFetched = true;
          return gzipResponse(fixture.bytes);
        },
        beforeOpen: (harness, ownedDefinition) => {
          const target = `${projectRoot(ownedDefinition)}/node_modules/vite/package.json`;
          const writeFile = harness.authority.writeFileSync.bind(harness.authority);
          let injected = false;
          vi.spyOn(harness.authority, 'writeFileSync').mockImplementation((path, bytes) => {
            if (restoreFetched && !injected && path === target) {
              injected = true;
              throw new Error('injected restore apply failure');
            }
            writeFile(path, bytes);
          });
        },
      };
    },
  },
];

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function settlePromptly<T>(
  promise: Promise<T>,
): Promise<
  | { readonly status: 'resolved'; readonly value: T }
  | { readonly status: 'rejected'; readonly error: unknown }
  | { readonly status: 'pending' }
> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    promise.then(
      (value) => ({ status: 'resolved' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    ),
    new Promise<{ readonly status: 'pending' }>((resolve) => {
      timer = setTimeout(() => resolve({ status: 'pending' }), 25);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return outcome;
}

interface ChildInput extends EventEmitter {
  write(chunk: unknown, callback?: (error?: Error | null) => void): boolean;
  end(): ChildInput;
}

class ChildWorker extends EventEmitter {
  readonly kind = 'worker' as const;
  readonly stdoutOutput = new EventEmitter();
  readonly stderrOutput = new EventEmitter();
  readonly input = new EventEmitter() as ChildInput;
  killedWith: string | null = null;

  constructor(
    readonly command: string,
    readonly spec: Parameters<typeof globalProcessManager.spawnWorker>[1],
  ) {
    super();
    this.input.write = (_chunk, callback) => {
      callback?.();
      return true;
    };
    this.input.end = () => {
      queueMicrotask(() => this.input.emit('finish'));
      return this.input;
    };
  }

  stdout(): EventEmitter {
    return this.stdoutOutput;
  }

  stderr(): EventEmitter {
    return this.stderrOutput;
  }

  stdin(): ChildInput {
    return this.input;
  }

  send(): boolean {
    return true;
  }

  resize(): boolean {
    return true;
  }

  kill(signal = 'SIGTERM'): boolean {
    this.killedWith = signal;
    return true;
  }

  disconnect(): void {}

  setCwd(): void {}

  finish(output: string, exit: ProcessExit = { code: 0, signal: null }): void {
    this.stdoutOutput.emit('data', encoder.encode(output));
    this.emit('exit', exit.code, exit.signal);
  }
}

interface OwnerHarness {
  readonly authority: ReturnType<typeof createOwnerVfsAuthorityComposition>['authority'];
  readonly materializer: ReturnType<typeof createProjectMaterializer>;
  readonly packageState: OwnerPackageState;
  readonly timeline: Timeline;
  readonly children: ChildWorker[];
  open(definition: PlaygroundDefinition): Promise<MaterializedProject>;
  session(
    definition: PlaygroundDefinition,
    materialized: MaterializedProject,
  ): Promise<ProjectSession<unknown>>;
  close(): Promise<void>;
}

function ownerHarness(options: OwnerHarnessOptions = {}): OwnerHarness {
  const timeline: Timeline = {
    events: [],
    installs: [],
    activeInstalls: 0,
    maxActiveInstalls: 0,
  };
  const pair = createMemoryFs();
  const { authority, appliedMutations, installStampClaims } = createOwnerVfsAuthorityComposition(
    pair.fsSync,
    {
      ownerEpoch: 'first-materialization-test-owner',
      initialRoots: ['/'],
    },
  );
  setSyncMirror(authority, { async: pair.vfs });
  const runtimeAssetManager = options.runtimeAssetManager;
  const runtimeAssets =
    runtimeAssetManager === undefined
      ? undefined
      : createNpmPackageRuntimeAssetPort(runtimeAssetManager);
  const packageState = createOwnerPackageState({
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: () => authority.flush(),
    nodeWorkerRuntimeEnv: NODE_WORKER_RUNTIME_ENV,
    log: (line) => timeline.events.push(`owner-log:${line}`),
    registry:
      options.registry ??
      new RegistryClient({
        baseUrl: 'https://playground.test/registry',
        fetch: async () => new Response('', { status: 599 }),
      }),
    ...(runtimeAssets === undefined ? {} : { runtimeAssets }),
    install:
      options.createInstall?.(timeline) ??
      realInstallBoundary(timeline, options.beforeInstallReturn),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });
  let stageSequence = 0;
  const store = createWorkbenchProjectStore(authority, {
    createStageId: () => `stage-${String(++stageSequence)}`,
  });
  const materializer = createProjectMaterializer({
    owner: store,
    acquisition: {
      ensure: (request) =>
        packageState.activateAndEnsure(
          workbenchPackageConfig(request.definition, request.projectRoot, {
            packageJsonBytes: authority.readFileBytesSync(`${request.projectRoot}/package.json`),
          }),
        ),
    },
  });
  const children: ChildWorker[] = [];
  vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation((command, spec) => {
    const child = new ChildWorker(command, spec);
    children.push(child);
    timeline.events.push(`child:spawn:${command}:${spec.argv.join(' ')}`);
    return child as never;
  });

  const session = async (
    definition: PlaygroundDefinition,
    materialized: MaterializedProject,
  ): Promise<ProjectSession<unknown>> => {
    const config = workbenchPackageConfig(definition, materialized.projectRoot, {
      packageJsonBytes: authority.readFileBytesSync(`${materialized.projectRoot}/package.json`),
    });
    const acquisition = materialized.acquisition as ProjectAcquisitionPlan;
    const runtimeAcquisition = createProjectRuntimeAcquisitionController(acquisition);
    let pty = createPtyClient({
      send: () => {},
      onFirstMaterializationConsumed: (evidence) =>
        runtimeAcquisition.acceptFirstMaterializationConsumed(evidence),
    });
    let auxiliaryTerminalSequence = 0;
    let alive = true;
    let resolveClosed!: (reason: unknown) => void;
    const closed = new Promise<unknown>((resolve) => {
      resolveClosed = resolve;
    });
    const composition = await createWorkbenchProjectComposition({
      createVfs: () =>
        createWorkbenchProjectVfs({
          projectRoot: materialized.projectRoot,
          authority,
          appliedMutations,
          packageMutations: packageState.mutations,
          durability: 'ephemeral',
          emit: () => {},
          fatal: (error) => {
            throw error;
          },
        }),
      createRuntime: (vfs) =>
        createWorkbenchProjectRuntime({
          projectRoot: materialized.projectRoot,
          packageConfig: config,
          authority,
          packageState,
          ...(runtimeAssetManager === undefined
            ? {}
            : {
                runtimeAssetReader: (plan) => runtimeAssetManager.runtimeReader(plan),
              }),
          nodeEntryWorkerUrl: NODE_ENTRY_WORKER_URL,
          devServerWorkerUrl: DEV_SERVER_WORKER_URL,
          nodeWorkerRuntimeEnv: NODE_WORKER_RUNTIME_ENV,
          mutationGuard: vfs.mutationGuard,
          publicationBarrier: vfs.publicationBarrier,
          send(frame: OwnerToPageFrame) {
            if (frame.type === 'pty:chunk') {
              timeline.events.push(
                `pty:${frame.stream}:${decoder.decode(frame.data).replaceAll('\n', '\\n')}`,
              );
            }
            if (frame.type === 'pty:run-ready') {
              timeline.events.push(`pty:run-ready:${frame.sid}:${frame.rid}`);
            }
            pty.onFrame(frame);
          },
        }),
    });
    composition.vfs.publishSnapshot();
    pty = createPtyClient({
      send(frame) {
        if (frame.type === 'pty:exec') timeline.events.push(`exec:${frame.line}`);
        void Promise.resolve(composition.runtime.handlePtyFrame(frame));
      },
      onFirstMaterializationConsumed: (evidence) =>
        runtimeAcquisition.acceptFirstMaterializationConsumed(evidence),
    });
    const port = {
      closed,
      isAlive: () => alive,
      openSession: (sid: string, initialState?: ProjectTerminalPortState) =>
        pty.openSession(sid, initialState ?? { cwd: materialized.projectRoot }),
      snapshot: (sid: string) =>
        projectTerminalStateFromOwner(materialized.projectRoot, pty.snapshot(sid)),
      execResult: pty.execResult,
      writeStdin: pty.writeStdin,
      endStdin: pty.endStdin,
      resizeSession: pty.resizeSession,
      resize: pty.resize,
      signal: pty.signal,
      closeSession: pty.closeSession,
    };
    const terminal = createProjectTerminal({ id: 'workbench-default-terminal', port });
    terminal.attach((chunk, stream) => {
      timeline.events.push(`terminal:${stream}:${chunk.replaceAll('\n', '\\n')}`);
    });
    const previewReadiness = () =>
      createPreviewReadiness({
        timeoutMs: 100,
        subscribe: () => () => {},
        requestSnapshot: () => {},
        mountRoute: () => () => {},
        proveServiceWorkerControl: async () => {},
        probe: async () => ({ ok: true, status: 200 }),
      });
    const runtime: ProjectRuntime<unknown> =
      definition.kind === 'node-cli'
        ? createNodeCliProjectRuntime({
            terminal,
            entryPath: definition.entryPath,
            args: definition.args,
            acquisition: runtimeAcquisition.runtime,
          })
        : createViteProjectRuntime({
            terminal,
            ownerToken: OWNER_TOKEN,
            createPreviewReadiness: previewReadiness,
            port: definition.port,
            acquisition: runtimeAcquisition.runtime,
          });
    return createProjectSession<unknown>({
      content: createUnusedProjectContent(`first-materialization-${definition.id}`),
      runtime,
      terminal,
      createTerminal: () => {
        const opened = createProjectTerminal({
          id: `workbench-auxiliary-terminal-${String(++auxiliaryTerminalSequence)}`,
          port,
        });
        opened.attach((chunk, stream) => {
          timeline.events.push(`terminal:${stream}:${chunk.replaceAll('\n', '\\n')}`);
        });
        return opened;
      },
      async closeOwner() {
        const results = await Promise.allSettled([
          composition.runtime.close(),
          composition.vfs.close(),
        ]);
        alive = false;
        resolveClosed(undefined);
        pty.disconnect();
        const failures = results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, 'First-materialization owner close failed');
        }
      },
    });
  };

  return {
    authority,
    materializer,
    packageState,
    timeline,
    children,
    open: (definition) => materializer.open(definition),
    session,
    async close() {
      await packageState.quiesce();
      await materializer.close();
      await runtimeAssetManager?.close();
    },
  };
}

async function waitForChild(
  harness: OwnerHarness,
  at: number,
  timeout = 1_000,
): Promise<ChildWorker> {
  await vi.waitFor(() => expect(harness.children.length).toBeGreaterThan(at), { timeout });
  const child = harness.children[at];
  if (child === undefined) throw new Error(`Missing child ${String(at)}`);
  return child;
}

function eventIndex(events: readonly string[], fragment: string): number {
  const index = events.findIndex((event) => event.includes(fragment));
  expect(
    index,
    `Missing timeline event containing ${fragment}:\n${events.join('\n')}`,
  ).toBeGreaterThanOrEqual(0);
  return index;
}

function eventIndexMatching(
  events: readonly string[],
  description: string,
  matches: (event: string) => boolean,
): number {
  const index = events.findIndex(matches);
  expect(
    index,
    `Missing timeline event ${description}:\n${events.join('\n')}`,
  ).toBeGreaterThanOrEqual(0);
  return index;
}

function isDeferredInstallPlan(value: unknown): value is Extract<
  ProjectAcquisitionPlan,
  {
    readonly kind: 'install';
  }
> {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.kind === 'install' && Array.isArray(record.snapshotFailures);
}

function projectRoot(definition: PlaygroundDefinition): string {
  return `/.rifty/workbench/v1/projects/${definition.storageSegment}/tree`;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSyncMirror();
});

describe('Workbench companion first materialization Contract+RED', () => {
  it.each(['cold', 'rejected-snapshot'] as const)(
    'holds a deferred Vite 7 %s child behind real manager readiness, then consumes first success once',
    async (variant) => {
      const rejectedFixture = snapshotFixtureFromBytes(encoder.encode('{"version":1}'));
      const snapshot = {
        snapshotId: rejectedFixture.snapshotId,
        assetUrl: 'https://playground.test/snapshots/vite-seven-rejected.json.gz',
        templateId: 'vite-seven-rejected-v1',
      } as const;
      const fetchSnapshot = vi.fn(async () => {
        if (variant === 'cold') {
          throw new Error('kind:install must not fetch a dependency snapshot');
        }
        return gzipResponse(rejectedFixture.bytes);
      });
      vi.stubGlobal('fetch', fetchSnapshot);
      const assets = viteSevenRuntimeAssets({ gateFirst: true });
      const h = ownerHarness({
        registry: assets.registry,
        runtimeAssetManager: assets.manager,
        createInstall: npmClientInstallBoundary,
      });
      const definition = viteDefinition(
        variant === 'cold' ? { kind: 'install' } : { kind: 'snapshot', snapshot },
        `vite-seven-runtime-assets-${variant}`,
        '7.3.6',
      );

      const materialized = await h.open(definition);
      expect.soft(isDeferredInstallPlan(materialized.acquisition)).toBe(true);
      expect.soft(h.timeline.installs).toEqual([]);
      expect.soft(h.children).toEqual([]);
      expect.soft(assets.attempts()).toBe(0);

      const session = await h.session(definition, materialized);
      const run = session.run();
      await assets.entered;
      const beforeReady = await settlePromptly(run.exited);
      const beforeRelease = [...h.timeline.events];
      expect.soft(beforeReady).toEqual({ status: 'pending' });
      expect.soft(h.children).toEqual([]);
      expect
        .soft(beforeRelease.some((event) => event.includes('runtime asset 1/1 fetch')))
        .toBe(true);
      expect.soft(beforeRelease.some((event) => event.startsWith('child:spawn:'))).toBe(false);

      assets.release();
      const child = await waitForChild(h, 0, 10_000);
      child.finish(`vite: seven ${variant} output\n`, { code: 7, signal: null });
      await run.exited;
      await run.close();
      const beforeSecondRun = h.timeline.events.length;
      const secondRun = session.run();
      const secondChild = await waitForChild(h, 1, 10_000);
      secondChild.finish(`vite: seven ${variant} warm output\n`);
      await secondRun.exited;
      await secondRun.close();
      await session.close();

      const root = projectRoot(definition);
      const directPlan = shadowAssetPlanFromLockfileBytes(
        h.authority.readFileBytesSync(`${root}/package-lock.json`),
      );
      const managerReceipt = await assets.manager.installer.inspectReceipt(
        directPlan.requiredSetDigest,
      );
      const epoch = h.packageState.readPackageTreeEpoch({
        root,
        slug: definition.storageSegment,
      });
      await h.close();

      if (variant === 'cold') expect.soft(fetchSnapshot).not.toHaveBeenCalled();
      else expect.soft(fetchSnapshot).toHaveBeenCalledTimes(1);
      expect.soft(h.timeline.installs).toHaveLength(1);
      expect.soft(assets.attempts()).toBe(1);
      expect.soft(directPlan.assets).toHaveLength(1);
      expect.soft(directPlan.substitutions).toMatchObject([
        {
          publicName: 'esbuild',
          requestedRange: '^0.27.0 || ^0.28.0',
          resolvedPublicVersion: '0.28.0',
        },
      ]);
      expect.soft(directPlan.assets[0]).toMatchObject({
        id: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
        memberSize: 13_918_738,
      });
      expect.soft(managerReceipt).not.toBeNull();
      expect.soft(epoch.readiness).toEqual({
        kind: 'ready',
        plan: directPlan,
        receipt: managerReceipt,
      });

      const visibleInstall = eventIndex(h.timeline.events, 'terminal:stdout:$ npm install');
      const cacheCheck = eventIndex(h.timeline.events, 'runtime asset 1/1 cache-check');
      const fetch = eventIndex(h.timeline.events, 'runtime asset 1/1 fetch');
      const verify = eventIndex(h.timeline.events, 'runtime asset 1/1 verify');
      const persist = eventIndex(h.timeline.events, 'runtime asset 1/1 persist');
      const ready = eventIndex(h.timeline.events, 'runtime assets ready: 1');
      const spawn = eventIndex(h.timeline.events, 'child:spawn:');
      expect(cacheCheck).toBeGreaterThan(visibleInstall);
      expect(fetch).toBeGreaterThan(cacheCheck);
      expect(verify).toBeGreaterThan(fetch);
      expect(persist).toBeGreaterThan(verify);
      expect(ready).toBeGreaterThan(persist);
      expect(spawn).toBeGreaterThan(ready);
      expect(h.timeline.events.slice(beforeSecondRun)).toContain(`exec:vite --port ${VITE_PORT}`);
      expect(h.timeline.events.slice(beforeSecondRun).join('\n')).not.toContain('$ npm install');
      expect(h.timeline.events.slice(beforeSecondRun).join('\n')).not.toContain('runtime asset');
    },
    15_000,
  );

  it('keeps failed Vite 7 readiness retryable and consumes only the first successful run', async () => {
    const fetchSnapshot = vi.fn(async () => {
      throw new Error('kind:install must not fetch a dependency snapshot');
    });
    vi.stubGlobal('fetch', fetchSnapshot);
    const assets = viteSevenRuntimeAssets({ failFirst: true });
    const h = ownerHarness({
      registry: assets.registry,
      runtimeAssetManager: assets.manager,
      createInstall: npmClientInstallBoundary,
    });
    const definition = viteDefinition(
      { kind: 'install' },
      'vite-seven-runtime-assets-retry',
      '7.3.6',
    );

    const materialized = await h.open(definition);
    const session = await h.session(definition, materialized);
    const failedRun = session.run();
    await expect(failedRun.exited).resolves.toEqual({ code: 1, signal: null });
    await failedRun.close();
    expect.soft(h.children).toEqual([]);
    expect.soft(h.timeline.installs).toHaveLength(1);
    expect.soft(assets.attempts(), h.timeline.events.join('\n')).toBe(1);

    const beforeRetry = h.timeline.events.length;
    const retry = session.run();
    const retryChild = await waitForChild(h, 0, 10_000).catch((error: unknown) => {
      throw new Error(h.timeline.events.join('\n'), { cause: error });
    });
    retryChild.finish('vite: seven retry output\n');
    await retry.exited;
    await retry.close();
    await session.close();

    const warmMaterialized = await h.open(definition);
    const beforeWarmRun = h.timeline.events.length;
    const warmSession = await h.session(definition, warmMaterialized);
    const warmRun = warmSession.run();
    const warmChild = await waitForChild(h, 1, 10_000);
    warmChild.finish('vite: seven retry warm output\n');
    await warmRun.exited;
    await warmRun.close();
    await warmSession.close();
    await h.close();

    const retryEvents = h.timeline.events.slice(beforeRetry);
    const successfulRetryEvents = h.timeline.events.slice(beforeRetry, beforeWarmRun);
    expect.soft(fetchSnapshot).not.toHaveBeenCalled();
    expect.soft(assets.attempts()).toBe(2);
    expect.soft(h.timeline.installs).toHaveLength(1);
    expect
      .soft(h.timeline.events.filter((event) => event.includes('terminal:stdout:$ npm install')))
      .toHaveLength(1);
    expect.soft(retryEvents.join('\n')).not.toContain('terminal:stdout:$ npm install');
    const retryCacheCheck = eventIndex(successfulRetryEvents, 'runtime asset 1/1 cache-check');
    const retryFetch = eventIndex(successfulRetryEvents, 'runtime asset 1/1 fetch');
    const retryVerify = eventIndex(successfulRetryEvents, 'runtime asset 1/1 verify');
    const retryPersist = eventIndex(successfulRetryEvents, 'runtime asset 1/1 persist');
    const retryReady = eventIndex(successfulRetryEvents, 'runtime assets ready: 1');
    const retrySpawn = eventIndex(successfulRetryEvents, 'child:spawn:');
    expect(retryFetch).toBeGreaterThan(retryCacheCheck);
    expect(retryVerify).toBeGreaterThan(retryFetch);
    expect(retryPersist).toBeGreaterThan(retryVerify);
    expect(retryReady).toBeGreaterThan(retryPersist);
    expect(retrySpawn).toBeGreaterThan(retryReady);
    expect(h.timeline.events.slice(beforeWarmRun)).toContain(`exec:vite --port ${VITE_PORT}`);
    expect(h.timeline.events.slice(beforeWarmRun).join('\n')).not.toContain('npm install');
    expect(h.timeline.events.slice(beforeWarmRun).join('\n')).not.toContain('runtime asset');
  }, 15_000);

  it('runs a cold install visibly on the default PTY, preserves the Vite port, then reuses the warm claim', async () => {
    const fetchSnapshot = vi.fn(async () => {
      throw new Error('kind:install must not fetch a dependency snapshot');
    });
    vi.stubGlobal('fetch', fetchSnapshot);
    const h = ownerHarness();
    const definition = viteDefinition({ kind: 'install' });

    const firstMaterialized = await h.open(definition);
    const beforeFirstRun = [...h.timeline.events];
    const firstSession = await h.session(definition, firstMaterialized);
    const firstRun = firstSession.run();
    const firstChild = await waitForChild(h, 0);
    firstChild.finish('vite: first output\n');
    await firstRun.exited;
    await firstRun.close();
    await firstSession.close();

    const installsAfterFirstRun = h.timeline.installs.length;
    const secondMaterialized = await h.open(definition);
    const secondPlan = secondMaterialized.acquisition as ProjectAcquisitionPlan;
    const beforeSecondRun = h.timeline.events.length;
    const secondSession = await h.session(definition, secondMaterialized);
    const secondRun = secondSession.run();
    const secondChild = await waitForChild(h, 1);
    secondChild.finish('vite: warm output\n');
    await secondRun.exited;
    await secondRun.close();
    await secondSession.close();
    await h.close();

    expect.soft(beforeFirstRun).toEqual([]);
    expect.soft(fetchSnapshot).not.toHaveBeenCalled();
    expect.soft(installsAfterFirstRun).toBe(1);
    expect.soft(h.timeline.installs).toHaveLength(1);
    expect.soft(secondPlan).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'existing', packages: 1 },
    });

    const firstExec = eventIndex(h.timeline.events, `exec:npm install && vite --port ${VITE_PORT}`);
    const installStart = eventIndex(h.timeline.events, 'install:start:');
    const packageProgress = eventIndex(h.timeline.events, 'terminal:stdout:npm: + vite@8.0.16');
    const firstSpawn = eventIndexMatching(
      h.timeline.events,
      `containing child:spawn and --port ${VITE_PORT}`,
      (event) => event.startsWith('child:spawn:') && event.includes(`--port ${VITE_PORT}`),
    );
    const firstViteOutput = eventIndex(h.timeline.events, 'terminal:stdout:vite: first output');
    expect(installStart).toBeGreaterThan(firstExec);
    expect(packageProgress).toBeGreaterThan(installStart);
    expect(firstSpawn).toBeGreaterThan(packageProgress);
    expect(firstViteOutput).toBeGreaterThan(firstSpawn);
    expect(h.timeline.events.slice(beforeSecondRun)).toContain(`exec:vite --port ${VITE_PORT}`);
    expect(h.timeline.events.slice(beforeSecondRun).join('\n')).not.toContain('npm: installing');
  });

  // Fault class: observable-order. Deferred acquisition belongs to the
  // project owner, so an earlier successful public terminal install must be
  // visible before the primary runtime chooses its later command line.
  it('consumes root first materialization from a public auxiliary terminal before the primary run', async () => {
    const fetchSnapshot = vi.fn(async () => {
      throw new Error('kind:install must not fetch a dependency snapshot');
    });
    vi.stubGlobal('fetch', fetchSnapshot);
    const h = ownerHarness();
    const definition = viteDefinition({ kind: 'install' }, 'vite-auxiliary-first');

    const materialized = await h.open(definition);
    const session = await h.session(definition, materialized);
    const auxiliary = session.terminals.open();
    const auxiliaryRun = auxiliary.run('npm install');
    await auxiliaryRun.ready;
    await expect(auxiliaryRun.exited).resolves.toEqual({ code: 0, signal: null });
    await auxiliaryRun.close();

    const beforePrimaryRun = h.timeline.events.length;
    const primaryRun = session.run();
    const child = await waitForChild(h, 0);
    child.finish('vite: auxiliary-first output\n');
    await primaryRun.exited;
    await primaryRun.close();
    await session.close();
    await h.close();

    const primaryEvents = h.timeline.events.slice(beforePrimaryRun);
    expect.soft(fetchSnapshot).not.toHaveBeenCalled();
    expect.soft(h.timeline.installs).toHaveLength(1);
    expect(primaryEvents.filter((event) => event.startsWith('exec:'))).toEqual([
      `exec:vite --port ${VITE_PORT}`,
    ]);
    expect(primaryEvents.join('\n')).not.toContain('npm install');
  });

  // Fault class: concurrent-same-key. Every already-admitted consumer of one
  // project latch observes the first successful settlement, independent of
  // which terminal performed it.
  it('shares concurrent auxiliary consumption with the admitted primary run and every future run', async () => {
    const releaseInstall = deferred();
    let gateInstall = false;
    let timeline: Timeline | null = null;
    const fetchSnapshot = vi.fn(async () => {
      throw new Error('kind:install must not fetch a dependency snapshot');
    });
    vi.stubGlobal('fetch', fetchSnapshot);
    const h = ownerHarness({
      beforeInstallReturn: async () => {
        if (!gateInstall) return;
        timeline?.events.push('install:gate');
        await releaseInstall.promise;
      },
    });
    timeline = h.timeline;
    const definition = viteDefinition({ kind: 'install' }, 'vite-auxiliary-concurrent');

    const materialized = await h.open(definition);
    const session = await h.session(definition, materialized);
    gateInstall = true;
    const auxiliary = session.terminals.open();
    const auxiliaryRun = auxiliary.run('npm install');
    await auxiliaryRun.ready;
    await vi.waitFor(() => expect(h.timeline.events).toContain('install:gate'));

    const primaryRun = session.run();
    await vi.waitFor(() =>
      expect(h.timeline.events.filter((event) => event.startsWith('pty:run-ready:'))).toHaveLength(
        2,
      ),
    );
    const beforeReleaseEvents = [...h.timeline.events];
    const primaryBeforeRelease = await settlePromptly(primaryRun.exited);
    const installsBeforeRelease = h.timeline.installs.length;
    const childrenBeforeRelease = h.children.length;
    gateInstall = false;
    releaseInstall.resolve();

    const child = await waitForChild(h, 0);
    child.finish('vite: concurrent auxiliary output\n');
    await Promise.all([auxiliaryRun.exited, primaryRun.exited]);
    await Promise.all([auxiliaryRun.close(), primaryRun.close()]);

    const beforeFutureRun = h.timeline.events.length;
    const futureRun = session.run();
    const futureChild = await waitForChild(h, 1);
    futureChild.finish('vite: concurrent auxiliary warm output\n');
    await futureRun.exited;
    await futureRun.close();
    await session.close();
    await h.close();

    expect.soft(primaryBeforeRelease).toEqual({ status: 'pending' });
    expect.soft(installsBeforeRelease).toBe(1);
    expect.soft(childrenBeforeRelease).toBe(0);
    expect.soft(fetchSnapshot).not.toHaveBeenCalled();
    expect.soft(h.timeline.installs).toHaveLength(1);
    expect(beforeReleaseEvents.filter((event) => event.startsWith('exec:'))).toEqual([
      'exec:npm install',
      `exec:npm install && vite --port ${VITE_PORT}`,
    ]);
    expect(beforeReleaseEvents.filter((event) => event.startsWith('pty:run-ready:'))).toHaveLength(
      2,
    );
    const futureEvents = h.timeline.events.slice(beforeFutureRun);
    expect(futureEvents.filter((event) => event.startsWith('exec:'))).toEqual([
      `exec:vite --port ${VITE_PORT}`,
    ]);
    expect(futureEvents.join('\n')).not.toContain('npm install');
  });

  it('runs a fresh Node CLI install on the same default PTY before spawning the CLI child', async () => {
    const fetchSnapshot = vi.fn(async () => {
      throw new Error('kind:install must not fetch a dependency snapshot');
    });
    vi.stubGlobal('fetch', fetchSnapshot);
    const h = ownerHarness();
    const definition = cliDefinition();

    const materialized = await h.open(definition);
    const beforeRun = [...h.timeline.events];
    const session = await h.session(definition, materialized);
    const run = session.run();
    const child = await waitForChild(h, 0);
    child.finish('cli: real output\n', { code: 7, signal: null });
    await expect(run.exited).resolves.toEqual({ code: 7, signal: null });
    await run.close();
    await session.close();
    await h.close();

    expect.soft(beforeRun).toEqual([]);
    expect.soft(fetchSnapshot).not.toHaveBeenCalled();
    expect.soft(h.timeline.installs).toHaveLength(1);
    const exec = eventIndex(
      h.timeline.events,
      'exec:npm install && node ./src/cli.mjs --format json',
    );
    const visibleInstall = eventIndex(h.timeline.events, 'terminal:stdout:$ npm install');
    const install = eventIndex(h.timeline.events, 'install:start:');
    const packageProgress = eventIndex(h.timeline.events, 'terminal:stdout:npm: + kleur@4.1.5');
    const childSpawn = eventIndex(h.timeline.events, 'child:spawn:node:');
    const cliOutput = eventIndex(h.timeline.events, 'terminal:stdout:cli: real output');
    expect(visibleInstall).toBeGreaterThan(exec);
    expect(install).toBeGreaterThan(visibleInstall);
    expect(packageProgress).toBeGreaterThan(install);
    expect(childSpawn).toBeGreaterThan(packageProgress);
    expect(cliOutput).toBeGreaterThan(childSpawn);
  });

  // Fault class: provenance-lie. Exit zero from the exact no-dependency
  // install must carry its empty-plan attestation through the public session
  // before the Node child is admitted.
  it('admits a no-dependency Node CLI after its empty install succeeds', async () => {
    const acquire = vi.fn(async () => {
      throw new Error('an empty runtime-asset plan must not acquire bytes');
    });
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: { acquire, close: async () => undefined },
    });
    const h = ownerHarness({ runtimeAssetManager: manager });
    const definition = noDependencyCliDefinition();

    const materialized = await h.open(definition);
    const session = await h.session(definition, materialized);
    const run = session.run();
    const child = await waitForChild(h, 0);
    child.finish('cli: no-dependency output\n');
    await expect(run.exited).resolves.toEqual({ code: 0, signal: null });
    await run.close();
    await session.close();
    await h.close();

    expect.soft(h.timeline.installs).toEqual([]);
    expect.soft(acquire).not.toHaveBeenCalled();
    expect.soft(h.timeline.events).toContain('exec:npm install && node ./src/cli.mjs');
    expect.soft(h.timeline.events.join('\n')).toContain('npm: no dependencies to install');
    expect.soft(h.timeline.events.join('\n')).toContain('child:spawn:node:');
  });

  // Fault class: concurrent-same-key. Deferred first materialization, terminal
  // npm, and warm inspection are commands in one owner FIFO, not sibling queues.
  it('queues a same-key prepare behind an active terminal install and returns its exact warm claim', async () => {
    const releaseInstall = deferred();
    let gateInstall = false;
    let timeline: Timeline | null = null;
    const fetchSnapshot = vi.fn(async () => {
      throw new Error('kind:install must not fetch a dependency snapshot');
    });
    vi.stubGlobal('fetch', fetchSnapshot);
    const h = ownerHarness({
      beforeInstallReturn: async () => {
        if (!gateInstall) return;
        timeline?.events.push('install:gate');
        await releaseInstall.promise;
      },
    });
    timeline = h.timeline;
    const definition = viteDefinition({ kind: 'install' }, 'vite-fifo-prepare');

    const first = await h.open(definition);
    if (!isDeferredInstallPlan(first.acquisition)) {
      await h.close();
      throw new Error(
        `Expected a deferred install plan before the FIFO assertion, received ${JSON.stringify(first.acquisition)}`,
      );
    }

    gateInstall = true;
    const session = await h.session(definition, first);
    const run = session.run();
    await vi.waitFor(() => expect(h.timeline.events).toContain('install:gate'));

    const concurrent = h.open(definition).then((materialized) => {
      h.timeline.events.push('prepare:warm:resolved');
      return materialized;
    });
    const beforeRelease = await settlePromptly(concurrent);
    const installsBeforeRelease = h.timeline.installs.length;
    const activeBeforeRelease = h.timeline.activeInstalls;
    const maxActiveBeforeRelease = h.timeline.maxActiveInstalls;
    const childrenBeforeRelease = h.children.length;
    releaseInstall.resolve();

    const child = await waitForChild(h, 0);
    child.finish('vite: fifo prepare output\n');
    await run.exited;
    const second = await concurrent;
    await run.close();
    await session.close();
    await h.close();

    expect.soft(beforeRelease).toEqual({ status: 'pending' });
    expect.soft(installsBeforeRelease).toBe(1);
    expect.soft(activeBeforeRelease).toBe(1);
    expect.soft(maxActiveBeforeRelease).toBe(1);
    expect.soft(childrenBeforeRelease).toBe(0);
    expect.soft(fetchSnapshot).not.toHaveBeenCalled();
    expect.soft(h.timeline.installs).toHaveLength(1);
    expect.soft(h.timeline.maxActiveInstalls).toBe(1);
    expect.soft(second.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'existing', packages: 1 },
    });
    expect(eventIndex(h.timeline.events, 'prepare:warm:resolved')).toBeGreaterThan(
      eventIndex(h.timeline.events, 'install:end:'),
    );
  });

  it('queues terminal install behind an active snapshot prepare, then reuses the restored claim', async () => {
    const fixture = serializedSnapshotFixture(
      viteDefinition({ kind: 'install' }),
      'vite-fifo-snapshot-v1',
    );
    const descriptor = {
      snapshotId: fixture.snapshotId,
      assetUrl: 'https://playground.test/snapshots/vite-fifo.json.gz',
      templateId: 'vite-fifo-snapshot-v1',
    } as const;
    const definition = viteDefinition(
      { kind: 'snapshot', snapshot: descriptor },
      'vite-fifo-snapshot',
    );
    const snapshotStarted = deferred();
    const releaseSnapshot = deferred();
    let timeline: Timeline | null = null;
    const fetchSnapshot = vi.fn(async () => {
      timeline?.events.push('snapshot:fetch:start');
      snapshotStarted.resolve();
      await releaseSnapshot.promise;
      timeline?.events.push('snapshot:fetch:end');
      return new Response(gzipSnapshot(fixture.bytes, 6));
    });
    vi.stubGlobal('fetch', fetchSnapshot);
    const h = ownerHarness();
    timeline = h.timeline;

    const preparing = h.open(definition);
    const firstBoundary = await Promise.race([
      snapshotStarted.promise.then(() => ({ status: 'snapshot-started' as const })),
      preparing.then(
        (value) => ({ status: 'open-resolved' as const, value }),
        (error: unknown) => ({ status: 'open-rejected' as const, error }),
      ),
    ]);
    if (firstBoundary.status !== 'snapshot-started') {
      await h.close();
      expect(firstBoundary.status).toBe('snapshot-started');
      return;
    }

    const materializedWhilePreparing: MaterializedProject = Object.freeze({
      projectKey: definition.storageSegment,
      projectRoot: projectRoot(definition),
      acquisition: Object.freeze({ kind: 'install', snapshotFailures: Object.freeze([]) }),
    });
    const session = await h.session(definition, materializedWhilePreparing);
    const run = session.run();
    await vi.waitFor(() =>
      expect(h.timeline.events).toContain(`exec:npm install && vite --port ${VITE_PORT}`),
    );
    const runBeforeRelease = await settlePromptly(run.exited);
    const installsBeforeRelease = h.timeline.installs.length;
    const childrenBeforeRelease = h.children.length;
    releaseSnapshot.resolve();

    const prepared = await preparing;
    const child = await waitForChild(h, 0);
    child.finish('vite: snapshot fifo output\n');
    await run.exited;
    await run.close();
    await session.close();
    await h.close();

    expect.soft(runBeforeRelease).toEqual({ status: 'pending' });
    expect.soft(installsBeforeRelease).toBe(0);
    expect.soft(childrenBeforeRelease).toBe(0);
    expect.soft(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect.soft(h.timeline.installs).toEqual([]);
    expect.soft(h.timeline.maxActiveInstalls).toBe(0);
    expect.soft(prepared.acquisition).toMatchObject({
      kind: 'ready',
      provenance: {
        outcome: 'snapshot',
        snapshotId: descriptor.snapshotId,
        packages: 1,
      },
    });
    expect(
      eventIndexMatching(h.timeline.events, 'for the queued Vite child spawn', (event) =>
        event.startsWith('child:spawn:'),
      ),
    ).toBeGreaterThan(eventIndex(h.timeline.events, 'snapshot:fetch:end'));
  });

  // Fault class: torn-multi-step. Snapshot replacement and explicit template
  // node_modules reassertion are one package-authority transaction.
  it('reasserts exact binary template node_modules bytes after snapshot restore replaces the tree', async () => {
    const id = 'vite-snapshot-template-node-modules';
    const templateId = 'vite-snapshot-template-node-modules-v1';
    const fixturePath = '/node_modules/@rifty/example-types/fixture.bin';
    const fixtureBytes = new Uint8Array([0x00, 0xff, 0x07, 0x80]);
    const definitionWith = (firstMaterialization: FirstMaterialization): PlaygroundDefinition =>
      withPlaygroundMetadata(
        inspectProjectDefinition(
          projects.vite({
            id,
            files: {
              '/index.html': '<main id="app"></main>',
              '/src/main.ts': "console.log('typed fixture')\n",
              [fixturePath]: fixtureBytes,
            },
            viteVersion: '8.0.16',
          }),
        ),
        {
          starterId: 'vite-starter',
          templateId,
          firstMaterialization,
          port: VITE_PORT,
        },
      );
    const baseline = definitionWith({ kind: 'install' });
    const snapshot = bakedSnapshot(baseline, templateId);
    const fixture = snapshotFixtureFromValue(snapshot);
    const descriptor = {
      snapshotId: fixture.snapshotId,
      assetUrl: 'https://playground.test/snapshots/vite-template-node-modules.json.gz',
      templateId,
    } as const;
    const definition = definitionWith({ kind: 'snapshot', snapshot: descriptor });
    const fetchSnapshot = vi.fn(async () => new Response(gzipSnapshot(fixture.bytes, 6)));
    vi.stubGlobal('fetch', fetchSnapshot);
    const h = ownerHarness();

    const materialized = await h.open(definition);
    await h.close();

    expect
      .soft(snapshot.nodeModules.files.map((file) => file.path))
      .not.toContain(fixturePath.slice('/node_modules/'.length));
    expect.soft(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect.soft(materialized.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'snapshot', snapshotId: descriptor.snapshotId },
    });
    expect(h.authority.readFileBytesSync(`${materialized.projectRoot}${fixturePath}`)).toEqual(
      fixtureBytes,
    );
  });

  // Fault class: provenance-lie. A snapshot-born tree is not install-first;
  // later bare npm cannot be authorized to replace its current user manifest.
  it('preserves a snapshot-materialized user manifest during a later bare npm install', async () => {
    const id = 'vite-snapshot-user-manifest';
    const templateId = 'vite-snapshot-user-manifest-v1';
    const baseline = viteDefinition({ kind: 'install' }, id);
    const fixture = serializedSnapshotFixture(baseline, templateId);
    const descriptor = {
      snapshotId: fixture.snapshotId,
      assetUrl: 'https://playground.test/snapshots/vite-user-manifest.json.gz',
      templateId,
    } as const;
    const definition = viteDefinition({ kind: 'snapshot', snapshot: descriptor }, id);
    const fetchSnapshot = vi.fn(async () => new Response(gzipSnapshot(fixture.bytes, 6)));
    vi.stubGlobal('fetch', fetchSnapshot);
    const h = ownerHarness();

    const materialized = await h.open(definition);
    await h.packageState.quiesce();
    const manifestPath = `${materialized.projectRoot}/package.json`;
    const userManifest = `${JSON.stringify({
      name: 'user-tooling-project',
      version: '1.0.0',
      dependencies: { cowsay: '1.6.0' },
    })}\n`;
    await h.packageState.mutations.guardedMutation(
      [{ kind: 'write', path: manifestPath }],
      async () => {
        h.authority.writeFileSync(manifestPath, encoder.encode(userManifest));
      },
    );
    await h.packageState.quiesce();

    const sink = { write: (_chunk: string | Uint8Array): void => {} };
    const npm = h.packageState.createNpmCommand(async () => 1);
    await expect(
      npm(['install'], {
        cwd: materialized.projectRoot,
        env: {},
        stdout: sink,
        stderr: sink,
      }),
    ).resolves.toBe(0);
    await h.packageState.quiesce();
    await h.close();

    expect.soft(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect.soft(h.timeline.installs).toHaveLength(1);
    expect(decoder.decode(h.authority.readFileBytesSync(manifestPath))).toBe(userManifest);
    expect(
      h.authority.existsSync(`${materialized.projectRoot}/node_modules/cowsay/package.json`),
    ).toBe(true);
  });

  it('reinstalls A from its current extended manifest after a direct tree mutation revokes it, then A→B→A', async () => {
    const id = 'vite-reopen-current-manifest';
    const templateId = 'vite-reopen-current-manifest-v1';
    const fixture = serializedSnapshotFixture(viteDefinition({ kind: 'install' }, id), templateId);
    const descriptor = {
      snapshotId: fixture.snapshotId,
      assetUrl: 'https://playground.test/snapshots/vite-reopen-current-manifest.json.gz',
      templateId,
    } as const;
    const definitionA = viteDefinition({ kind: 'snapshot', snapshot: descriptor }, id);
    const definitionB = viteDefinition({ kind: 'install' }, 'vite-reopen-switch-away');
    const installerManifests: string[] = [];
    const fetchSnapshot = vi.fn(async () => new Response(gzipSnapshot(fixture.bytes, 6)));
    vi.stubGlobal('fetch', fetchSnapshot);
    const h = ownerHarness({
      beforeInstallReturn: async (options) => {
        const manifest = await options.vfs.readFileText(`${options.cwd}/package.json`);
        installerManifests.push(manifest);
        if (dependencyMap(manifest).cowsay !== '1.6.0') return;
        await options.vfs.mkdir(`${options.cwd}/node_modules/cowsay`, { recursive: true });
        await options.vfs.writeFile(
          `${options.cwd}/node_modules/cowsay/package.json`,
          '{"name":"cowsay","version":"1.6.0"}\n',
        );
        await options.vfs.writeFile(
          `${options.cwd}/node_modules/cowsay/marker.txt`,
          'cowsay-ready\n',
        );
        await options.vfs.mkdir(`${options.cwd}/node_modules/.bin`, { recursive: true });
        await options.vfs.writeFile(
          `${options.cwd}/node_modules/.bin/cowsay`,
          '#!/usr/bin/env node\n',
        );
      },
    });

    const first = await h.open(definitionA);
    await h.packageState.quiesce();
    const sink = { write: (_chunk: string | Uint8Array): void => {} };
    const npm = h.packageState.createNpmCommand(async () => 1);
    await expect(
      npm(['install', 'cowsay@1.6.0'], {
        cwd: first.projectRoot,
        env: {},
        stdout: sink,
        stderr: sink,
      }),
    ).resolves.toBe(0);
    await h.packageState.quiesce();
    const warmBeforeMutation = await h.open(definitionA);

    const markerPath = `${first.projectRoot}/node_modules/cowsay/marker.txt`;
    const cowsayBinPath = `${first.projectRoot}/node_modules/.bin/cowsay`;
    expect.soft(h.authority.existsSync(markerPath)).toBe(true);
    expect.soft(h.authority.existsSync(cowsayBinPath)).toBe(true);

    const viteTempDir = `${first.projectRoot}/node_modules/.vite-temp`;
    const timestampModule = `${viteTempDir}/vite.config.js.timestamp-1752700000000-a1b2c3d4.mjs`;
    await h.packageState.mutations.guardedMutation(
      [{ kind: 'mkdir', path: viteTempDir }],
      async () => {
        h.authority.mkdirSync(viteTempDir, { recursive: true });
      },
    );
    await h.packageState.mutations.guardedMutation(
      [{ kind: 'write', path: timestampModule }],
      async () => {
        h.authority.writeFileSync(timestampModule, encoder.encode('export default {}\n'));
      },
    );
    await h.packageState.mutations.guardedMutation(
      [{ kind: 'rm', path: timestampModule }],
      async () => {
        h.authority.rmSync(timestampModule, { force: true });
      },
    );
    await h.packageState.quiesce();

    await h.open(definitionB);
    const installsBeforeReopen = h.timeline.installs.length;
    const reopened = await h.open(definitionA);
    if (!isDeferredInstallPlan(reopened.acquisition)) {
      await h.close();
      expect(reopened.acquisition).toEqual({
        kind: 'install',
        snapshotFailures: [{ snapshotId: descriptor.snapshotId, reason: 'package-json-mismatch' }],
      });
      return;
    }

    const session = await h.session(definitionA, reopened);
    const run = session.run();
    const child = await waitForChild(h, 0);
    child.finish('vite: reopened current manifest output\n');
    await run.exited;
    await run.close();
    await session.close();
    await h.close();

    expect.soft(first.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'snapshot', snapshotId: descriptor.snapshotId },
    });
    expect.soft(warmBeforeMutation.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'existing' },
    });
    expect.soft(fetchSnapshot).toHaveBeenCalledTimes(2);
    expect.soft(installsBeforeReopen).toBe(1);
    expect.soft(reopened.acquisition).toEqual({
      kind: 'install',
      snapshotFailures: [{ snapshotId: descriptor.snapshotId, reason: 'package-json-mismatch' }],
    });
    expect.soft(h.timeline.installs).toHaveLength(installsBeforeReopen + 1);
    expect.soft(dependencyMap(installerManifests.at(-1) ?? '{}')).toMatchObject({
      vite: '8.0.16',
      cowsay: '1.6.0',
    });
    expect.soft(h.authority.existsSync(markerPath)).toBe(true);
    expect.soft(h.authority.existsSync(cowsayBinPath)).toBe(true);
  });

  // One Workbench owns one active ProjectSession/VFS cursor. Exercise duplicate
  // consumers at the reachable sibling npm ingress, through the same package FIFO.
  it('serializes two consumers of one deferred install into one install and one exact warm reuse', async () => {
    const releaseInstall = deferred();
    let gateInstall = false;
    let timeline: Timeline | null = null;
    const fetchSnapshot = vi.fn(async () => {
      throw new Error('kind:install must not fetch a dependency snapshot');
    });
    vi.stubGlobal('fetch', fetchSnapshot);
    const h = ownerHarness({
      beforeInstallReturn: async () => {
        if (!gateInstall) return;
        timeline?.events.push('install:two-runs:gate');
        await releaseInstall.promise;
      },
    });
    timeline = h.timeline;
    const definition = viteDefinition({ kind: 'install' }, 'vite-fifo-two-runs');

    const materialized = await h.open(definition);
    if (!isDeferredInstallPlan(materialized.acquisition)) {
      await h.close();
      throw new Error(
        `Expected a deferred install plan before the concurrency assertion, received ${JSON.stringify(materialized.acquisition)}`,
      );
    }

    const terminalOutput = (consumer: string) => ({
      write(chunk: string | Uint8Array) {
        const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk);
        h.timeline.events.push(`terminal:${consumer}:${text.replaceAll('\n', '\\n')}`);
      },
    });
    const context = (consumer: string): CommandContext => ({
      cwd: materialized.projectRoot,
      env: {},
      stdout: terminalOutput(consumer),
      stderr: terminalOutput(consumer),
    });
    const consumptionEvidence = vi.fn();
    const firstNpm = h.packageState.createNpmCommand(async () => 1, {
      onFirstMaterializationConsumed: consumptionEvidence,
    });
    const secondNpm = h.packageState.createNpmCommand(async () => 1, {
      onFirstMaterializationConsumed: consumptionEvidence,
    });
    gateInstall = true;
    const firstRun = firstNpm(['install'], context('first'));
    const secondRun = secondNpm(['install'], context('second'));
    await vi.waitFor(() => expect(h.timeline.events).toContain('install:two-runs:gate'));
    const firstBeforeRelease = await settlePromptly(firstRun);
    const secondBeforeRelease = await settlePromptly(secondRun);
    const installsBeforeRelease = h.timeline.installs.length;
    const activeBeforeRelease = h.timeline.activeInstalls;
    releaseInstall.resolve();

    await expect(Promise.all([firstRun, secondRun])).resolves.toEqual([0, 0]);
    const warm = await h.open(definition);
    await h.close();

    expect.soft(firstBeforeRelease).toEqual({ status: 'pending' });
    expect.soft(secondBeforeRelease).toEqual({ status: 'pending' });
    expect.soft(installsBeforeRelease).toBe(1);
    expect.soft(activeBeforeRelease).toBe(1);
    expect.soft(fetchSnapshot).not.toHaveBeenCalled();
    expect.soft(h.timeline.installs).toHaveLength(1);
    expect.soft(h.timeline.maxActiveInstalls).toBe(1);
    expect.soft(consumptionEvidence).toHaveBeenCalledTimes(1);
    expect
      .soft(h.timeline.events.filter((event) => event.includes('$ npm install')))
      .toHaveLength(1);
    expect.soft(warm.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'existing', packages: 1 },
    });
    expect.soft(h.children).toEqual([]);
  });

  it('hashes decompressed snapshot bytes, accepts gzip recompression, and reuses the exact warm claim', async () => {
    const fixture = serializedSnapshotFixture(viteDefinition({ kind: 'install' }), 'vite-deps-v1');
    const fastGzip = gzipSnapshot(fixture.bytes, 1);
    const smallGzip = gzipSnapshot(fixture.bytes, 9);
    const fastDescriptor = {
      snapshotId: fixture.snapshotId,
      assetUrl: 'https://playground.test/snapshots/vite-fast.json.gz',
      templateId: 'vite-deps-v1',
    } as const;
    const smallDescriptor = {
      ...fastDescriptor,
      assetUrl: 'https://playground.test/snapshots/vite-small.json.gz',
    } as const;
    const fastDefinition = viteDefinition(
      { kind: 'snapshot', snapshot: fastDescriptor },
      'vite-gzip-fast',
    );
    const smallDefinition = viteDefinition(
      { kind: 'snapshot', snapshot: smallDescriptor },
      'vite-gzip-small',
    );
    const fetchSnapshot = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === fastDescriptor.assetUrl) return new Response(fastGzip);
      if (href === smallDescriptor.assetUrl) return new Response(smallGzip);
      throw new Error(`Unexpected snapshot URL: ${href}`);
    });
    vi.stubGlobal('fetch', fetchSnapshot);
    const h = ownerHarness();

    const first = await h.open(fastDefinition);
    await h.packageState.quiesce();
    const recompressed = await h.open(smallDefinition);
    await h.packageState.quiesce();
    const warm = await h.open(fastDefinition);
    await h.packageState.quiesce();
    await h.close();

    expect.soft(fastGzip).not.toEqual(smallGzip);
    expect.soft(fastDescriptor.snapshotId).toBe(smallDescriptor.snapshotId);
    expect.soft(fetchSnapshot).toHaveBeenCalledTimes(2);
    expect
      .soft(fetchSnapshot)
      .toHaveBeenNthCalledWith(
        1,
        fastDescriptor.assetUrl,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    expect
      .soft(fetchSnapshot)
      .toHaveBeenNthCalledWith(
        2,
        smallDescriptor.assetUrl,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    expect.soft(h.timeline.installs).toEqual([]);
    expect.soft(first.acquisition).toMatchObject({
      kind: 'ready',
      provenance: {
        outcome: 'snapshot',
        snapshotId: fastDescriptor.snapshotId,
        packages: 1,
      },
    });
    expect.soft(recompressed.acquisition).toMatchObject({
      kind: 'ready',
      provenance: {
        outcome: 'snapshot',
        snapshotId: smallDescriptor.snapshotId,
        packages: 1,
      },
    });
    expect.soft(warm.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'existing', packages: 1 },
    });
    expect(h.authority.existsSync(`${first.projectRoot}/node_modules/vite/package.json`)).toBe(
      true,
    );
    expect(
      h.authority.existsSync(`${recompressed.projectRoot}/node_modules/vite/package.json`),
    ).toBe(true);
  });

  it.each(SNAPSHOT_FALLBACK_CASES)(
    'records $name exactly, defers install to the session, then falls back visibly',
    async (testCase) => {
      expect(DEFAULT_ASSET_STALL_MS).toBe(10_000);
      expect(DEFAULT_ASSET_MAX_BYTES).toBe(128 * 1024 * 1024);
      const id = `vite-${testCase.slug}`;
      const assetUrl = `https://playground.test/snapshots/${testCase.slug}.json.gz`;
      const baseDefinition = viteDefinition({ kind: 'install' }, id);
      const prepared = testCase.prepare(baseDefinition, assetUrl);
      const descriptor = {
        snapshotId: prepared.snapshotId,
        assetUrl,
        templateId: prepared.templateId,
      } as const;
      const definition = viteDefinition({ kind: 'snapshot', snapshot: descriptor }, id);
      const fetchSnapshot = vi.fn(prepared.fetch);
      vi.stubGlobal('fetch', fetchSnapshot);
      const h = ownerHarness();
      prepared.beforeOpen?.(h, definition);

      const opening = h.open(definition);
      opening.catch(() => {});
      if (prepared.afterOpenStarted !== undefined) {
        const boundary = await Promise.race([
          prepared.afterOpenStarted().then(() => ({ status: 'fault-settled' as const })),
          opening.then(
            (value) => ({ status: 'open-resolved' as const, value }),
            (error: unknown) => ({ status: 'open-rejected' as const, error }),
          ),
        ]);
        if (boundary.status !== 'fault-settled') {
          vi.useRealTimers();
          await h.close();
          throw new Error(
            `Expected ${testCase.name} fetch boundary before project open settled; received ${boundary.status}`,
          );
        }
      }
      await prepared.triggerFault?.();
      const materialized = await opening;
      vi.useRealTimers();
      if (!isDeferredInstallPlan(materialized.acquisition)) {
        await h.close();
        throw new Error(
          `Expected deferred fallback for ${testCase.name}, received ${JSON.stringify(materialized.acquisition)}`,
        );
      }
      prepared.assertBoundary?.();

      expect.soft(fetchSnapshot).toHaveBeenCalledTimes(1);
      expect
        .soft(fetchSnapshot)
        .toHaveBeenCalledWith(
          assetUrl,
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      expect.soft(materialized.acquisition).toEqual({
        kind: 'install',
        snapshotFailures: [
          {
            snapshotId: descriptor.snapshotId,
            reason: prepared.expectedReason,
          },
        ],
      });
      expect.soft(h.timeline.installs).toEqual([]);
      expect.soft(h.children).toEqual([]);
      expect.soft(h.timeline.events.some((event) => event.startsWith('exec:'))).toBe(false);

      const session = await h.session(definition, materialized);
      expect.soft(h.timeline.installs).toEqual([]);
      expect.soft(h.children).toEqual([]);
      expect.soft(h.timeline.events.some((event) => event.startsWith('exec:'))).toBe(false);
      const run = session.run();
      const child = await waitForChild(h, 0);
      child.finish(`vite: ${testCase.slug} fallback output\n`);
      await expect(run.exited).resolves.toEqual({ code: 0, signal: null });
      await run.close();
      await session.close();
      await h.close();

      expect.soft(h.timeline.installs).toHaveLength(1);
      expect(
        h.authority.existsSync(`${materialized.projectRoot}/node_modules/vite/package.json`),
      ).toBe(true);
      const rejection = eventIndexMatching(
        h.timeline.events,
        `terminal snapshot reason ${prepared.expectedReason}`,
        (event) => event.startsWith('terminal:stdout:') && event.includes(prepared.expectedReason),
      );
      const visibleInstall = eventIndex(h.timeline.events, 'terminal:stdout:$ npm install');
      const install = eventIndex(h.timeline.events, 'terminal:stdout:npm: installing');
      const output = eventIndex(
        h.timeline.events,
        `terminal:stdout:vite: ${testCase.slug} fallback output`,
      );
      expect(visibleInstall).toBeGreaterThan(rejection);
      expect(install).toBeGreaterThan(visibleInstall);
      expect(output).toBeGreaterThan(install);
    },
  );
});
