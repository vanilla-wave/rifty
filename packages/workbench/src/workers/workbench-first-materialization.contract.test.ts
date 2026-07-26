import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { gzipSync } from 'node:zlib';
import { globalProcessManager } from '@riftydev/kernel';
import { type InstallOptions, type InstallResult, RegistryClient } from '@riftydev/npm-client';
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
import { projectTerminalStateFromOwner } from '../workbench/internal/playground-terminal-state.ts';
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
import { createNoShadowInstallResultFixture } from './install-result.test-fixture.ts';
import { type OwnerPackageState, createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import type { AcquisitionProvenance, SnapshotFailure } from './package-acquisition-authority.ts';
import { workbenchPackageConfig } from './workbench-package-config.ts';
import { createWorkbenchProjectComposition } from './workbench-project-composition.ts';
import { createWorkbenchProjectRuntime } from './workbench-project-runtime.ts';
import { createWorkbenchProjectStore } from './workbench-project-store.ts';
import { createWorkbenchProjectVfs } from './workbench-project-vfs.ts';

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
}

async function installResult(name: string, version: string): Promise<InstallResult> {
  const result: InstallResult = {
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
  return await createNoShadowInstallResultFixture(result);
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
      options.onPackage?.({ name, version, cacheHit: false });
      await beforeReturn?.(options);
      timeline.events.push(`install:end:${options.cwd}`);
      return await installResult(name, version);
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
  packageJson?: string,
): PlaygroundDefinition {
  return withPlaygroundMetadata(
    inspectProjectDefinition(
      projects.vite({
        id,
        files: {
          '/index.html': '<main id="app"></main>',
          '/src/main.ts': "console.log('vite output')\n",
          ...(packageJson === undefined ? {} : { '/package.json': packageJson }),
        },
        viteVersion: '8.0.16',
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
    name: 'snapshot restore plan rejects a forged shadow trace before claim or tree mutation',
    slug: 'forged-shadow-trace',
    prepare: (definition) => {
      const snapshot = bakedSnapshot(definition, 'vite-deps-current');
      const fixture = snapshotFixtureFromValue({
        ...snapshot,
        lockfile: `${JSON.stringify({
          lockfileVersion: 3,
          packages: {
            'node_modules/esbuild': {
              version: '0.25.0',
              riftyShadowRecipe: 'forged-recipe',
            },
          },
        })}\n`,
      });
      let harness: OwnerHarness | undefined;
      let beforePlan: ReturnType<OwnerHarness['authority']['snapshot']> | undefined;
      return {
        snapshotId: fixture.snapshotId,
        templateId: 'vite-deps-current',
        expectedReason:
          'snapshot-restore-plan-failed: Not implemented: npm-client.lockfile.shadowSubstitutionTrace',
        beforeOpen: (owner) => {
          harness = owner;
        },
        fetch: () => {
          if (harness === undefined) throw new Error('forged shadow trace harness is missing');
          beforePlan = harness.authority.snapshot();
          return gzipResponse(fixture.bytes);
        },
        assertBoundary: () => {
          if (harness === undefined || beforePlan === undefined) {
            throw new Error('forged shadow trace pre-plan snapshot is missing');
          }
          expect(harness.authority.snapshot()).toEqual(beforePlan);
        },
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
  readonly #control = new MessageChannel();
  readonly ports = { ipc: this.#control.port1 };
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

  onListeningControl(): () => void {
    return () => {};
  }

  setCwd(): void {}

  finish(output: string, exit: ProcessExit = { code: 0, signal: null }): void {
    this.stdoutOutput.emit('data', encoder.encode(output));
    this.emit('exit', exit.code, exit.signal);
    this.#control.port1.close();
    this.#control.port2.close();
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
  const packageState = createOwnerPackageState({
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: () => authority.flush(),
    nodeWorkerRuntimeEnv: NODE_WORKER_RUNTIME_ENV,
    log: (line) => timeline.events.push(`owner-log:${line}`),
    registry: new RegistryClient({
      baseUrl: 'https://playground.test/registry',
      fetch: async () => new Response('', { status: 599 }),
    }),
    install: realInstallBoundary(timeline, options.beforeInstallReturn),
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
    let pty = createPtyClient({ send: () => {} });
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
    const acquisition = materialized.acquisition as ProjectAcquisitionPlan;
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
            acquisition,
          } as Parameters<typeof createNodeCliProjectRuntime>[0] & {
            readonly acquisition: ProjectAcquisitionPlan;
          })
        : createViteProjectRuntime({
            terminal,
            ownerToken: OWNER_TOKEN,
            createPreviewReadiness: previewReadiness,
            port: definition.port,
            acquisition,
          } as Parameters<typeof createViteProjectRuntime>[0] & {
            readonly port: number;
            readonly acquisition: ProjectAcquisitionPlan;
          });
    return createProjectSession<unknown>({
      content: createUnusedProjectContent(`first-materialization-${definition.id}`),
      runtime,
      terminal,
      createTerminal: () => {
        throw new Error('First-materialization contract uses exactly the default terminal');
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
    },
  };
}

async function waitForChild(harness: OwnerHarness, at: number): Promise<ChildWorker> {
  await vi.waitFor(() => expect(harness.children.length).toBeGreaterThan(at));
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

  it('queues an explicit terminal install behind snapshot prepare, then reconciles the restored tree', async () => {
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
    expect.soft(h.timeline.installs).toHaveLength(1);
    expect.soft(h.timeline.maxActiveInstalls).toBe(1);
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

  it('pins extraneous .vite-temp writes across install → npm run → install, then A→B→A', async () => {
    const id = 'vite-reopen-current-manifest';
    const templateId = 'vite-reopen-current-manifest-v1';
    const packageJson = '{"name":"vite-run-contract","scripts":{"dev":"vite"}}\n';
    const fixture = serializedSnapshotFixture(
      viteDefinition({ kind: 'install' }, id, packageJson),
      templateId,
    );
    const descriptor = {
      snapshotId: fixture.snapshotId,
      assetUrl: 'https://playground.test/snapshots/vite-reopen-current-manifest.json.gz',
      templateId,
    } as const;
    const definitionA = viteDefinition({ kind: 'snapshot', snapshot: descriptor }, id, packageJson);
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
    const viteTempDir = `${first.projectRoot}/node_modules/.vite-temp`;
    const timestampModule = `${viteTempDir}/vite.config.js.timestamp-1752700000000-a1b2c3d4.mjs`;
    const runMarker = `${viteTempDir}/run-cache.json`;
    let runs = 0;
    const npm = h.packageState.createNpmCommand(async (name) => {
      expect(name).toBe('dev');
      runs += 1;
      await h.packageState.mutations.guardedMutation(
        [{ kind: 'mkdir', path: viteTempDir }],
        async () => {
          h.authority.mkdirSync(viteTempDir, { recursive: true });
        },
      );
      await h.packageState.mutations.guardedMutation(
        [
          { kind: 'write', path: timestampModule },
          { kind: 'write', path: runMarker },
        ],
        async () => {
          h.authority.writeFileSync(timestampModule, encoder.encode('export default {}\n'));
          h.authority.writeFileSync(runMarker, encoder.encode('{"run":1}\n'));
        },
      );
      await h.packageState.mutations.guardedMutation(
        [{ kind: 'rm', path: timestampModule }],
        async () => {
          h.authority.rmSync(timestampModule, { force: true });
        },
      );
      return 0;
    });
    const context: CommandContext = {
      cwd: first.projectRoot,
      env: {},
      stdout: sink,
      stderr: sink,
    };
    await expect(npm(['install', 'cowsay@1.6.0'], context)).resolves.toBe(0);
    await h.packageState.quiesce();
    const warmBeforeMutation = await h.open(definitionA);

    const markerPath = `${first.projectRoot}/node_modules/cowsay/marker.txt`;
    const cowsayBinPath = `${first.projectRoot}/node_modules/.bin/cowsay`;
    expect.soft(h.authority.existsSync(markerPath)).toBe(true);
    expect.soft(h.authority.existsSync(cowsayBinPath)).toBe(true);

    await expect(npm(['run', 'dev'], context)).resolves.toBe(0);
    await h.packageState.quiesce();
    const warmAfterRun = await h.open(definitionA);
    await expect(npm(['install'], context)).resolves.toBe(0);
    await h.packageState.quiesce();
    const warmAfterSecondInstall = await h.open(definitionA);

    await h.open(definitionB);
    const installsBeforeReopen = h.timeline.installs.length;
    const reopened = await h.open(definitionA);
    await h.close();

    expect.soft(first.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'snapshot', snapshotId: descriptor.snapshotId },
    });
    expect.soft(warmBeforeMutation.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'existing' },
    });
    expect.soft(warmAfterRun.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'existing' },
    });
    expect.soft(warmAfterSecondInstall.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'existing' },
    });
    // ADR-0307: the .vite-temp churn is an extraneous tree write — reopening A
    // reuses its exact installed tree with no snapshot refetch and no install.
    expect.soft(reopened.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'existing' },
    });
    expect.soft(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect.soft(runs).toBe(1);
    expect.soft(installsBeforeReopen).toBe(2);
    expect.soft(h.timeline.installs).toHaveLength(installsBeforeReopen);
    expect.soft(dependencyMap(installerManifests.at(-1) ?? '{}')).toMatchObject({
      vite: '8.0.16',
      cowsay: '1.6.0',
    });
    expect.soft(decoder.decode(h.authority.readFileBytesSync(runMarker))).toBe('{"run":1}\n');
    expect.soft(h.authority.existsSync(markerPath)).toBe(true);
    expect.soft(h.authority.existsSync(cowsayBinPath)).toBe(true);
  });

  // One Workbench owns one active ProjectSession/VFS cursor. Exercise duplicate
  // consumers at the reachable sibling npm ingress, through the same package FIFO.
  it('serializes two explicit consumers of one deferred install without a stamp-only skip', async () => {
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
    const firstNpm = h.packageState.createNpmCommand(async () => 1);
    const secondNpm = h.packageState.createNpmCommand(async () => 1);
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
    expect.soft(h.timeline.installs).toHaveLength(2);
    expect.soft(h.timeline.maxActiveInstalls).toBe(1);
    expect
      .soft(h.timeline.events.filter((event) => event.includes('$ npm install')))
      .toHaveLength(2);
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
