/**
 * Registry client. The fetcher is pluggable so tests can use a mock.
 *
 * URLs follow the D-004 contract (ADR 0028): a base URL configured by env or
 * option, never hardcoded. {@link getRegistryBaseUrl} is the single factory
 * every consumer should go through; sources of truth are, in order:
 *
 *   1. `globalThis.__RIFTY_REGISTRY_URL__` — set by playground bootstrap.
 *   2. `globalThis.import.meta.env.RIFTY_REGISTRY_URL` — Vite build-time env.
 *   3. `process.env.REGISTRY_BASE_URL` — Node-side test/harness path.
 *   4. Default `/npm-registry` (Vite proxy in dev; Edge Function path in prod
 *      per ADR 0028).
 */

export interface Packument {
  name: string;
  'dist-tags'?: Record<string, string>;
  versions: Record<string, VersionManifest>;
}

export interface VersionManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  /**
   * Platform constraints (npm `os`/`cpu`). Read at resolve time by the
   * native-dependency policy (ADR-0051): a `cpu` array that excludes `wasm`
   * marks a compiled artifact rifty cannot run.
   */
  os?: string[];
  cpu?: string[];
  dist: {
    tarball: string;
    shasum?: string;
    integrity?: string;
  };
  main?: string;
  module?: string;
  exports?: unknown;
  type?: string;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Sources of the registry base URL, in priority order:
 *   1. `globalThis.__RIFTY_REGISTRY_URL__` (playground sets this at bootstrap),
 *   2. `globalThis.import.meta.env.RIFTY_REGISTRY_URL` (Vite-style build env),
 *   3. `process.env.REGISTRY_BASE_URL` (Node-side test harness),
 *   4. `/npm-registry` (default — Vite proxy in dev, Edge Function in prod).
 *
 * Each consumer in `@rifty/npm-client` calls this function; never hardcode
 * a registry URL elsewhere (D-004 / ADR 0028).
 */
export function getRegistryBaseUrl(): string {
  const g = globalThis as Record<string, unknown>;
  const fromBootstrap = g.__RIFTY_REGISTRY_URL__;
  if (typeof fromBootstrap === 'string' && fromBootstrap.length > 0) return fromBootstrap;

  // Vite-style: globalThis.import?.meta?.env?.RIFTY_REGISTRY_URL
  const importObj = g.import;
  if (importObj && typeof importObj === 'object') {
    const meta = (importObj as { meta?: unknown }).meta;
    if (meta && typeof meta === 'object') {
      const env = (meta as { env?: unknown }).env;
      if (env && typeof env === 'object') {
        const value = (env as Record<string, unknown>).RIFTY_REGISTRY_URL;
        if (typeof value === 'string' && value.length > 0) return value;
      }
    }
  }

  // Node-side (vitest, harness).
  if (typeof process !== 'undefined' && process.env) {
    const fromEnv = process.env.REGISTRY_BASE_URL;
    if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  }

  return '/npm-registry';
}

export class RegistryClient {
  readonly baseUrl: string;
  private readonly fetch: Fetcher;

  constructor(opts: { baseUrl?: string; fetch?: Fetcher } = {}) {
    this.baseUrl = (opts.baseUrl ?? getRegistryBaseUrl()).replace(/\/$/, '');
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async getPackument(name: string): Promise<Packument> {
    const url = `${this.baseUrl}/${encodeURIComponent(name).replace('%40', '@')}`;
    const response = await this.fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch packument ${name}: ${response.status}`);
    return (await response.json()) as Packument;
  }

  async getTarball(tarballUrl: string): Promise<Uint8Array> {
    const response = await this.fetch(tarballUrl);
    if (!response.ok) throw new Error(`Failed to fetch tarball: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}
