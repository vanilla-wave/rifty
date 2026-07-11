import { describe, expect, it } from 'vitest';
import { TEST_PROJECT_CATALOG, TEST_VITE_TEMPLATE } from '../test-project.ts';
import {
  type WorkbenchChildRuntimeConfig,
  type WorkbenchWorkerAssets,
  buildChildRuntimeEnv,
  installChildRuntimeConfig,
  parseOwnerWorkerConfig,
} from './worker-config.ts';

const assets: WorkbenchWorkerAssets = {
  sqliteWasmUrl: 'https://host.test/sqlite.wasm',
  esbuildWasmUrl: 'https://host.test/esbuild.wasm',
};
const childConfig: WorkbenchChildRuntimeConfig = {
  ...assets,
  kernelWorkerUrl: 'https://host.test/kernel.js',
  nodeEntryWorkerUrl: 'https://host.test/node.js',
};

describe('worker config boundary', () => {
  it('parses the complete host-injected owner config without defaults', () => {
    const config = parseOwnerWorkerConfig({
      RIFTY_PROJECT_CATALOG: JSON.stringify(TEST_PROJECT_CATALOG),
      RIFTY_SQLITE_WASM_URL: assets.sqliteWasmUrl,
      RIFTY_ESBUILD_WASM_URL: assets.esbuildWasmUrl,
      RIFTY_REGISTRY_URL: 'https://host.test/npm',
      RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js',
      RIFTY_NODE_ENTRY_WORKER_URL: 'https://host.test/node.js',
      RIFTY_DEV_SERVER_WORKER_URL: 'https://host.test/dev.js',
      RIFTY_RESOLVER_URL: 'https://host.test/resolve',
      RIFTY_RESOLVER_BUNDLE_URL: 'https://cdn.test/bundles',
      RIFTY_RESOLVER_PINS: JSON.stringify({ vite: 'sha256-vite' }),
    });

    expect(config).toEqual({
      catalog: TEST_PROJECT_CATALOG,
      assets,
      registry: {
        registryUrl: 'https://host.test/npm',
        resolverUrl: 'https://host.test/resolve',
        resolverBundleUrl: 'https://cdn.test/bundles',
        resolverPins: { vite: 'sha256-vite' },
      },
      workers: {
        kernelWorkerUrl: 'https://host.test/kernel.js',
        nodeEntryWorkerUrl: 'https://host.test/node.js',
        devServerWorkerUrl: 'https://host.test/dev.js',
      },
    });
  });

  it.each([
    'RIFTY_PROJECT_CATALOG',
    'RIFTY_SQLITE_WASM_URL',
    'RIFTY_ESBUILD_WASM_URL',
    'RIFTY_REGISTRY_URL',
    'RIFTY_KERNEL_WORKER_URL',
    'RIFTY_NODE_ENTRY_WORKER_URL',
    'RIFTY_DEV_SERVER_WORKER_URL',
  ])('throws before owner boot when %s is missing', (missing) => {
    const env: Record<string, string> = {
      RIFTY_PROJECT_CATALOG: JSON.stringify(TEST_PROJECT_CATALOG),
      RIFTY_SQLITE_WASM_URL: assets.sqliteWasmUrl,
      RIFTY_ESBUILD_WASM_URL: assets.esbuildWasmUrl,
      RIFTY_REGISTRY_URL: 'https://host.test/npm',
      RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js',
      RIFTY_NODE_ENTRY_WORKER_URL: 'https://host.test/node.js',
      RIFTY_DEV_SERVER_WORKER_URL: 'https://host.test/dev.js',
    };
    delete env[missing];
    expect(() => parseOwnerWorkerConfig(env)).toThrow(missing);
  });

  it('throws on malformed resolver pins instead of silently disabling them', () => {
    expect(() =>
      parseOwnerWorkerConfig({
        RIFTY_PROJECT_CATALOG: JSON.stringify(TEST_PROJECT_CATALOG),
        RIFTY_SQLITE_WASM_URL: assets.sqliteWasmUrl,
        RIFTY_ESBUILD_WASM_URL: assets.esbuildWasmUrl,
        RIFTY_REGISTRY_URL: 'https://host.test/npm',
        RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js',
        RIFTY_NODE_ENTRY_WORKER_URL: 'https://host.test/node.js',
        RIFTY_DEV_SERVER_WORKER_URL: 'https://host.test/dev.js',
        RIFTY_RESOLVER_PINS: '{bad json',
      }),
    ).toThrow(/RIFTY_RESOLVER_PINS/);
  });

  it('serializes the shared child assets and an optional project spec in one place', () => {
    expect(buildChildRuntimeEnv(childConfig, TEST_VITE_TEMPLATE)).toEqual({
      RIFTY_SQLITE_WASM_URL: assets.sqliteWasmUrl,
      RIFTY_ESBUILD_WASM_URL: assets.esbuildWasmUrl,
      RIFTY_KERNEL_WORKER_URL: childConfig.kernelWorkerUrl,
      RIFTY_NODE_ENTRY_WORKER_URL: childConfig.nodeEntryWorkerUrl,
      RIFTY_RFV_PROJECT_SPEC: JSON.stringify(TEST_VITE_TEMPLATE),
    });
    expect(buildChildRuntimeEnv(childConfig)).toEqual({
      RIFTY_SQLITE_WASM_URL: assets.sqliteWasmUrl,
      RIFTY_ESBUILD_WASM_URL: assets.esbuildWasmUrl,
      RIFTY_KERNEL_WORKER_URL: childConfig.kernelWorkerUrl,
      RIFTY_NODE_ENTRY_WORKER_URL: childConfig.nodeEntryWorkerUrl,
    });
  });

  it('installs recursive worker URLs in every child realm through one chokepoint', () => {
    const installed: string[] = [];
    expect(
      installChildRuntimeConfig(
        {
          RIFTY_SQLITE_WASM_URL: assets.sqliteWasmUrl,
          RIFTY_ESBUILD_WASM_URL: assets.esbuildWasmUrl,
          RIFTY_KERNEL_WORKER_URL: childConfig.kernelWorkerUrl,
          RIFTY_NODE_ENTRY_WORKER_URL: childConfig.nodeEntryWorkerUrl,
        },
        {
          setKernelWorkerUrl: (url) => installed.push(`kernel:${String(url)}`),
          configureNodeEntryWorker: (url, runtimeEnv) =>
            installed.push(`node:${String(url)}:${JSON.stringify(runtimeEnv)}`),
        },
      ),
    ).toEqual(childConfig);
    expect(installed).toEqual([
      `kernel:${childConfig.kernelWorkerUrl}`,
      `node:${childConfig.nodeEntryWorkerUrl}:${JSON.stringify(buildChildRuntimeEnv(childConfig))}`,
    ]);
  });
});
