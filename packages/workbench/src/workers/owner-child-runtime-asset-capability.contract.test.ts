import type { SpawnWorkerSpec } from '@riftydev/kernel';
import { describe, expect, it } from 'vitest';
import type { BinSpawnRequest } from '../glue/bin-executor.ts';
import type { NodeServerPackageConfig } from '../workbench/internal/project-package-config.ts';
import type { NodeWorkerRuntimeConfig } from './node-worker-runtime-config.ts';
import { buildChildSpawnSpec } from './owner-child-bin-executor.ts';
import {
  type DevServerChildSpawnParams,
  buildDevServerChildSpawnSpec,
} from './owner-child-dev-server.ts';
import { buildNodeChildSpawnSpec } from './owner-child-node-executor.ts';

const SHADOW_ASSET_CAPABILITY = 'rifty.shadow-assets.v1';
const NODE_RUNTIME_ENV = Object.freeze({
  RIFTY_KERNEL_WORKER_URL: 'blob:kernel',
  RIFTY_NODE_ENTRY_WORKER_URL: 'blob:node',
  RIFTY_SQLITE_WASM_URL: 'blob:sqlite',
});
const NODE_RUNTIME: NodeWorkerRuntimeConfig = Object.freeze({
  kernelWorkerUrl: 'blob:kernel',
  nodeEntryWorkerUrl: 'blob:node',
  sqliteWasmUrl: 'blob:sqlite',
});
const CAPABILITY_PORTS_TYPE = {} as Readonly<Record<string, MessagePort>>;

type BinBuilderWithCapabilities = (
  request: BinSpawnRequest,
  nodeEntryUrl: string,
  runtimeEnv: Readonly<Record<string, string>>,
  capabilityPorts?: typeof CAPABILITY_PORTS_TYPE,
) => SpawnWorkerSpec;

type NodeBuilderWithCapabilities = (
  entry: string,
  args: readonly string[],
  env: Record<string, string>,
  cwd: string,
  nodeEntryUrl: string,
  runtimeEnv: Readonly<Record<string, string>>,
  tty?: boolean,
  cols?: number,
  rows?: number,
  previewScope?: string,
  remoteFsRoot?: string,
  capabilityPorts?: typeof CAPABILITY_PORTS_TYPE,
) => SpawnWorkerSpec;

type DevServerBuilderWithCapabilities = (
  params: DevServerChildSpawnParams,
  devServerWorkerUrl: string,
  runtime: NodeWorkerRuntimeConfig,
  capabilityPorts?: typeof CAPABILITY_PORTS_TYPE,
) => SpawnWorkerSpec;

const buildBin = buildChildSpawnSpec as unknown as BinBuilderWithCapabilities;
const buildNode = buildNodeChildSpawnSpec as unknown as NodeBuilderWithCapabilities;
const buildDevServer = buildDevServerChildSpawnSpec as unknown as DevServerBuilderWithCapabilities;

function expectExactCapability(spec: SpawnWorkerSpec, endpoint: MessagePort): void {
  if (spec.entry.kind !== 'url') throw new Error('fixture expected a URL worker entry');
  expect(spec.entry.capabilityPorts?.[SHADOW_ASSET_CAPABILITY] === endpoint).toBe(true);
  expect(Object.keys(spec.entry.capabilityPorts ?? {})).toEqual([SHADOW_ASSET_CAPABILITY]);
  expect(spec.env).not.toHaveProperty(SHADOW_ASSET_CAPABILITY);
  expect(spec.argv.join('\0')).not.toContain(SHADOW_ASSET_CAPABILITY);
}

describe('finite owner child-spawner capability sweep', () => {
  it('puts a fresh exact-plan endpoint on every bin URL entry only', () => {
    const channel = new MessageChannel();
    try {
      const spec = buildBin(
        {
          shimPath: '/node_modules/.bin/vite',
          args: ['dev'],
          env: { USER_VALUE: 'kept' },
          cwd: '/',
          isTTY: false,
        },
        'blob:node-entry',
        NODE_RUNTIME_ENV,
        { [SHADOW_ASSET_CAPABILITY]: channel.port2 },
      );

      expectExactCapability(spec, channel.port2);
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });

  it('puts a fresh exact-plan endpoint on every Node URL entry only', () => {
    const channel = new MessageChannel();
    try {
      const spec = buildNode(
        '/src/server.mjs',
        [],
        { USER_VALUE: 'kept' },
        '/',
        'blob:node-entry',
        NODE_RUNTIME_ENV,
        false,
        80,
        24,
        undefined,
        undefined,
        { [SHADOW_ASSET_CAPABILITY]: channel.port2 },
      );

      expectExactCapability(spec, channel.port2);
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });

  it('puts a fresh exact-plan endpoint on every dev-server URL entry only', () => {
    const channel = new MessageChannel();
    const cfg: NodeServerPackageConfig = {
      runtime: 'node-server',
      root: '/',
      port: 5174,
      entryPath: '/server.mjs',
      packageName: 'server',
      packageVersion: '1.0.0',
      installDeps: {},
      packageJson: '{"name":"server"}\n',
      seedFiles: { '/server.mjs': 'export {}\n' },
    };
    try {
      const spec = buildDevServer(
        { cfg, env: { USER_VALUE: 'kept' } },
        'blob:dev-server-entry',
        NODE_RUNTIME,
        { [SHADOW_ASSET_CAPABILITY]: channel.port2 },
      );

      expectExactCapability(spec, channel.port2);
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });

  it('keeps an attested empty plan free of channels across all three siblings', () => {
    const bin = buildBin(
      {
        shimPath: '/node_modules/.bin/vite',
        args: [],
        env: {},
        cwd: '/',
        isTTY: false,
      },
      'blob:node-entry',
      NODE_RUNTIME_ENV,
    );
    const node = buildNode('/src/cli.mjs', [], {}, '/', 'blob:node-entry', NODE_RUNTIME_ENV);
    const cfg: NodeServerPackageConfig = {
      runtime: 'node-server',
      root: '/',
      port: 5174,
      entryPath: '/server.mjs',
      packageName: 'server',
      packageVersion: '1.0.0',
      installDeps: {},
      packageJson: '{"name":"server"}\n',
      seedFiles: { '/server.mjs': 'export {}\n' },
    };
    const devServer = buildDevServer({ cfg, env: {} }, 'blob:dev-server-entry', NODE_RUNTIME);

    for (const spec of [bin, node, devServer]) {
      if (spec.entry.kind !== 'url') throw new Error('fixture expected a URL worker entry');
      expect(spec.entry).not.toHaveProperty('capabilityPorts');
    }
  });
});
