import {
  type ResolvedWorkbenchAssetUrls,
  type ResolvedWorkbenchSessionConfig,
  type WorkbenchAssetUrls,
  type WorkbenchRegistryConfig,
  resolveWorkbenchConfig,
} from '@riftydev/workbench';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import esbuildWasmUrl from '../../../../tools/shadow-registry/vendor/esbuild-wasi-preview1/esbuild.wasm?url';
import devServerWorkerUrl from '../workers/dev-server-child-bootstrap.ts?worker&url';
import kernelWorkerUrl from '../workers/kernel-worker-entry.ts?worker&url';
import nodeWorkerUrl from '../workers/node-entry-bootstrap.ts?worker&url';
import ownerWorkerUrl from '../workers/real-vite-bootstrap.ts?worker&url';
import { PLAYGROUND_PROJECT_CATALOG } from './workbench-catalog.ts';

export const PLAYGROUND_WORKBENCH_ASSETS: WorkbenchAssetUrls = {
  ownerWorkerUrl,
  kernelWorkerUrl,
  nodeWorkerUrl,
  devServerWorkerUrl,
  serviceWorkerUrl: '/sw.js',
  sqliteWasmUrl: sqlWasmUrl,
  esbuildWasmUrl,
};

/**
 * Vite-hosted registry endpoint. The local fallback is the explicit proxy
 * configured in this app's vite.config.ts; the workbench package owns no
 * registry default.
 */
export function getRegistryProxyPrefix(
  value: unknown = import.meta.env.VITE_RIFTY_REGISTRY_URL,
): string {
  return typeof value === 'string' && value.length > 0 ? value : '/npm-registry';
}

export function getResolverUrl(
  value: unknown = import.meta.env.VITE_RIFTY_RESOLVER_URL,
): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function getEddyBundleBaseUrl(
  value: unknown = import.meta.env.VITE_RIFTY_EDDY_BUNDLE_URL,
): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseResolverPins(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new TypeError('VITE_RIFTY_EDDY_PINS must be a JSON object');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TypeError(`VITE_RIFTY_EDDY_PINS is invalid JSON: ${reason}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('VITE_RIFTY_EDDY_PINS must be a JSON object');
  }
  const pins: Record<string, string> = {};
  for (const [templateId, hash] of Object.entries(parsed)) {
    if (typeof hash !== 'string' || hash.length === 0) {
      throw new TypeError(`VITE_RIFTY_EDDY_PINS.${templateId} must be a non-empty string`);
    }
    pins[templateId] = hash;
  }
  return pins;
}

/** Translate Vite deployment config into the package's explicit host config. */
export function playgroundRegistryConfig(): WorkbenchRegistryConfig {
  const resolverUrl = getResolverUrl();
  const resolverBundleUrl = getEddyBundleBaseUrl();
  const resolverPins = parseResolverPins(import.meta.env.VITE_RIFTY_EDDY_PINS);
  return {
    registryUrl: getRegistryProxyPrefix(),
    ...(resolverUrl === undefined ? {} : { resolverUrl }),
    ...(resolverBundleUrl === undefined ? {} : { resolverBundleUrl }),
    ...(resolverPins === undefined ? {} : { resolverPins }),
  };
}

/** One Vite-owned validation boundary shared by the app and its browser harnesses. */
export function resolvePlaygroundWorkbenchConfig(): ResolvedWorkbenchSessionConfig {
  return resolveWorkbenchConfig({
    assets: PLAYGROUND_WORKBENCH_ASSETS,
    registry: playgroundRegistryConfig(),
    project: { catalog: PLAYGROUND_PROJECT_CATALOG },
  });
}

/** Host-only node bootstrap config; user `env` replacement must not erase it. */
export function playgroundNodeWorkerRuntimeEnv(
  assets: ResolvedWorkbenchAssetUrls,
): Readonly<Record<string, string>> {
  return {
    RIFTY_SQLITE_WASM_URL: assets.sqliteWasmUrl,
    RIFTY_ESBUILD_WASM_URL: assets.esbuildWasmUrl,
    RIFTY_KERNEL_WORKER_URL: assets.kernelWorkerUrl,
    RIFTY_NODE_ENTRY_WORKER_URL: assets.nodeWorkerUrl,
  };
}
