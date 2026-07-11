import { setKernelWorkerUrl } from '@riftydev/kernel';
import { configureNodeEntryWorker } from '@riftydev/runtime-js/builtins/node-entry-url';
import { type WorkbenchProjectCatalog, parseProjectCatalog } from '../project-catalog.ts';
import type { ProjectSpec } from '../project-spec.ts';

export type WorkbenchStorageBackend = 'opfs' | 'memory';

export interface WorkbenchWorkerAssets {
  readonly sqliteWasmUrl: string;
  readonly esbuildWasmUrl: string;
}

export interface WorkbenchChildRuntimeConfig extends WorkbenchWorkerAssets {
  readonly kernelWorkerUrl: string;
  readonly nodeEntryWorkerUrl: string;
}

export interface ChildRuntimeConfigSetters {
  readonly setKernelWorkerUrl: (url: string | URL) => void;
  readonly configureNodeEntryWorker: (
    url: string | URL,
    runtimeEnv: Readonly<Record<string, string>>,
  ) => void;
}

export interface WorkbenchWorkerRegistry {
  readonly registryUrl: string;
  readonly resolverUrl?: string;
  readonly resolverBundleUrl?: string;
  readonly resolverPins?: Readonly<Record<string, string>>;
}

export interface RecursiveWorkerEntryUrls {
  readonly kernelWorkerUrl: string;
  readonly nodeEntryWorkerUrl: string;
  readonly devServerWorkerUrl: string;
}

export interface OwnerWorkerConfig {
  readonly catalog: WorkbenchProjectCatalog;
  readonly assets: WorkbenchWorkerAssets;
  readonly registry: WorkbenchWorkerRegistry;
  readonly workers: RecursiveWorkerEntryUrls;
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`workspace-owner: missing required env ${key}`);
  }
  return value;
}

function assetUrl(value: string, key: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`workspace-owner: ${key} is not an absolute URL`);
  }
  if (!['http:', 'https:', 'blob:'].includes(parsed.protocol)) {
    throw new TypeError(`workspace-owner: ${key} has unsupported protocol ${parsed.protocol}`);
  }
  return value;
}

function endpointUrl(value: string, key: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`workspace-owner: ${key} is not an absolute URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError(`workspace-owner: ${key} must use http or https`);
  }
  if (parsed.username || parsed.password) {
    throw new TypeError(`workspace-owner: ${key} must not contain credentials`);
  }
  return value;
}

function optionalEndpoint(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key];
  return value === undefined ? undefined : endpointUrl(required(env, key), key);
}

function parseResolverPins(raw: string | undefined): Readonly<Record<string, string>> | undefined {
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TypeError(`workspace-owner: RIFTY_RESOLVER_PINS is invalid JSON (${reason})`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('workspace-owner: RIFTY_RESOLVER_PINS must be an object');
  }
  const pins: Record<string, string> = {};
  for (const [templateId, hash] of Object.entries(value)) {
    if (templateId.length === 0 || typeof hash !== 'string' || hash.length === 0) {
      throw new TypeError(
        'workspace-owner: RIFTY_RESOLVER_PINS entries must map template ids to non-empty hashes',
      );
    }
    pins[templateId] = hash;
  }
  return pins;
}

export function parseWorkerAssets(env: Record<string, string | undefined>): WorkbenchWorkerAssets {
  return {
    sqliteWasmUrl: assetUrl(required(env, 'RIFTY_SQLITE_WASM_URL'), 'RIFTY_SQLITE_WASM_URL'),
    esbuildWasmUrl: assetUrl(required(env, 'RIFTY_ESBUILD_WASM_URL'), 'RIFTY_ESBUILD_WASM_URL'),
  };
}

export function parseChildRuntimeConfig(
  env: Record<string, string | undefined>,
): WorkbenchChildRuntimeConfig {
  return {
    ...parseWorkerAssets(env),
    kernelWorkerUrl: assetUrl(required(env, 'RIFTY_KERNEL_WORKER_URL'), 'RIFTY_KERNEL_WORKER_URL'),
    nodeEntryWorkerUrl: assetUrl(
      required(env, 'RIFTY_NODE_ENTRY_WORKER_URL'),
      'RIFTY_NODE_ENTRY_WORKER_URL',
    ),
  };
}

const REAL_CHILD_SETTERS: ChildRuntimeConfigSetters = {
  setKernelWorkerUrl,
  configureNodeEntryWorker,
};

/** Validate and install the recursive worker seam in every node-capable child. */
export function installChildRuntimeConfig(
  env: Record<string, string | undefined>,
  setters: ChildRuntimeConfigSetters = REAL_CHILD_SETTERS,
): WorkbenchChildRuntimeConfig {
  const config = parseChildRuntimeConfig(env);
  setters.setKernelWorkerUrl(config.kernelWorkerUrl);
  setters.configureNodeEntryWorker(config.nodeEntryWorkerUrl, buildChildRuntimeEnv(config));
  return config;
}

/** One validation boundary for every host-owned owner-worker input. */
export function parseOwnerWorkerConfig(env: Record<string, string | undefined>): OwnerWorkerConfig {
  const resolverUrl = optionalEndpoint(env, 'RIFTY_RESOLVER_URL');
  const resolverBundleUrl = optionalEndpoint(env, 'RIFTY_RESOLVER_BUNDLE_URL');
  const resolverPins = parseResolverPins(env.RIFTY_RESOLVER_PINS);
  return {
    catalog: parseProjectCatalog(required(env, 'RIFTY_PROJECT_CATALOG')),
    assets: parseWorkerAssets(env),
    registry: {
      registryUrl: endpointUrl(required(env, 'RIFTY_REGISTRY_URL'), 'RIFTY_REGISTRY_URL'),
      ...(resolverUrl === undefined ? {} : { resolverUrl }),
      ...(resolverBundleUrl === undefined ? {} : { resolverBundleUrl }),
      ...(resolverPins === undefined ? {} : { resolverPins }),
    },
    workers: {
      kernelWorkerUrl: assetUrl(
        required(env, 'RIFTY_KERNEL_WORKER_URL'),
        'RIFTY_KERNEL_WORKER_URL',
      ),
      nodeEntryWorkerUrl: assetUrl(
        required(env, 'RIFTY_NODE_ENTRY_WORKER_URL'),
        'RIFTY_NODE_ENTRY_WORKER_URL',
      ),
      devServerWorkerUrl: assetUrl(
        required(env, 'RIFTY_DEV_SERVER_WORKER_URL'),
        'RIFTY_DEV_SERVER_WORKER_URL',
      ),
    },
  };
}

/** One serializer for the runtime config inherited by every node-capable child. */
export function buildChildRuntimeEnv(
  config: WorkbenchChildRuntimeConfig,
  projectSpec?: ProjectSpec,
): Record<string, string> {
  const env: Record<string, string> = {
    RIFTY_SQLITE_WASM_URL: assetUrl(config.sqliteWasmUrl, 'RIFTY_SQLITE_WASM_URL'),
    RIFTY_ESBUILD_WASM_URL: assetUrl(config.esbuildWasmUrl, 'RIFTY_ESBUILD_WASM_URL'),
    RIFTY_KERNEL_WORKER_URL: assetUrl(config.kernelWorkerUrl, 'RIFTY_KERNEL_WORKER_URL'),
    RIFTY_NODE_ENTRY_WORKER_URL: assetUrl(config.nodeEntryWorkerUrl, 'RIFTY_NODE_ENTRY_WORKER_URL'),
  };
  if (projectSpec !== undefined) env.RIFTY_RFV_PROJECT_SPEC = JSON.stringify(projectSpec);
  return env;
}
