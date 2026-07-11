import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getEddyBundleBaseUrl,
  getRegistryProxyPrefix,
  getResolverUrl,
  playgroundNodeWorkerRuntimeEnv,
  playgroundRegistryConfig,
} from './workbench-host-config.ts';

afterEach(() => vi.unstubAllEnvs());

describe('Vite workbench host config', () => {
  it('owns the explicit local registry proxy default', () => {
    expect(getRegistryProxyPrefix(undefined)).toBe('/npm-registry');
    expect(getRegistryProxyPrefix('https://registry.example.test/npm')).toBe(
      'https://registry.example.test/npm',
    );
  });

  it('keeps optional resolver endpoints off until the host configures them', () => {
    expect(getResolverUrl(undefined)).toBeUndefined();
    expect(getEddyBundleBaseUrl(undefined)).toBeUndefined();
    expect(getResolverUrl('https://resolver.example.test')).toBe('https://resolver.example.test');
  });

  it('maps Vite env into one explicit package registry config', () => {
    vi.stubEnv('VITE_RIFTY_REGISTRY_URL', 'https://registry.example.test/npm');
    vi.stubEnv('VITE_RIFTY_RESOLVER_URL', 'https://resolver.example.test');
    vi.stubEnv('VITE_RIFTY_EDDY_BUNDLE_URL', 'https://bundles.example.test');
    vi.stubEnv('VITE_RIFTY_EDDY_PINS', '{"vite":"sha256-vite"}');

    expect(playgroundRegistryConfig()).toEqual({
      registryUrl: 'https://registry.example.test/npm',
      resolverUrl: 'https://resolver.example.test',
      resolverBundleUrl: 'https://bundles.example.test',
      resolverPins: { vite: 'sha256-vite' },
    });
  });

  it('rejects malformed pins before any owner worker can spawn', () => {
    vi.stubEnv('VITE_RIFTY_EDDY_PINS', '{not-json');
    expect(() => playgroundRegistryConfig()).toThrow(/VITE_RIFTY_EDDY_PINS is invalid JSON/);
  });

  it('derives every recursive node bootstrap asset from the shared resolved host config', () => {
    expect(
      playgroundNodeWorkerRuntimeEnv({
        ownerWorkerUrl: 'https://host.test/owner.js',
        kernelWorkerUrl: 'https://host.test/kernel.js',
        nodeWorkerUrl: 'https://host.test/node.js',
        devServerWorkerUrl: 'https://host.test/dev.js',
        serviceWorkerUrl: 'https://host.test/sw.js',
        sqliteWasmUrl: 'https://host.test/sqlite.wasm',
        esbuildWasmUrl: 'https://host.test/esbuild.wasm',
      }),
    ).toEqual({
      RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite.wasm',
      RIFTY_ESBUILD_WASM_URL: 'https://host.test/esbuild.wasm',
      RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js',
      RIFTY_NODE_ENTRY_WORKER_URL: 'https://host.test/node.js',
    });
  });
});
