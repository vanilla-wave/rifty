/**
 * Registry client. Pluggable fetcher so tests can mock.
 *
 * URLs follow D-004 (ADR-0028): base URL from env/option, never hardcoded.
 * {@link getRegistryBaseUrl} is the single factory every consumer goes through.
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
  scripts?: Record<string, string>;
  bin?: string | Record<string, string>;
  /**
   * Platform constraints (npm `os`/`cpu`). Read by the native-dependency policy
   * (ADR-0051): a `cpu` array excluding `wasm` marks a compiled artifact rifty
   * cannot run.
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
 * Registry base URL, in priority order:
 *   1. `globalThis.__RIFTY_REGISTRY_URL__` (playground bootstrap),
 *   2. `globalThis.import.meta.env.RIFTY_REGISTRY_URL` (Vite-style build env),
 *   3. `process.env.REGISTRY_BASE_URL` (Node-side test harness),
 *   4. `/npm-registry` (default — Vite proxy in dev; production consumers can
 *      set a full proxy URL).
 *
 * Never hardcode a registry URL elsewhere (D-004 / ADR-0028).
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

const DEFAULT_MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 300;
const MAX_RETRY_DELAY_MS = 8_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface RegistryClientOptions {
  baseUrl?: string;
  fetch?: Fetcher;
  /**
   * Retries on TRANSIENT failures (HTTP 429 rate-limit, 5xx, or a thrown network
   * error) AFTER the first attempt. Real npm retries with backoff; a single
   * rate-limited request must not abort a whole cold install (the express+sqlite
   * 429 the shared proxy returns). Default {@link DEFAULT_MAX_RETRIES}; 0 disables.
   */
  maxRetries?: number;
  /** Delay between retries — injectable so tests run without real timers. */
  sleep?: (ms: number) => Promise<void>;
}

/** Backoff for retry `attempt` (0-based): honor `Retry-After`, else exponential. */
function retryDelayMs(attempt: number, response: Response | undefined): number {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_RETRY_DELAY_MS);
    const when = Date.parse(retryAfter);
    if (!Number.isNaN(when)) return Math.min(Math.max(when - Date.now(), 0), MAX_RETRY_DELAY_MS);
  }
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

export class RegistryClient {
  readonly baseUrl: string;
  private readonly fetch: Fetcher;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: RegistryClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? getRegistryBaseUrl()).replace(/\/$/, '');
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /**
   * Fetch with bounded retry on TRANSIENT failures only — 429, 5xx, or a thrown
   * network error — with `Retry-After`/exponential backoff. A non-ok response that
   * survives every retry is RETURNED so the caller throws the existing
   * status-shaped error; a persistent network error is rethrown. A permanent 4xx
   * (e.g. 404) never retries.
   */
  private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    let lastNetworkError: unknown;
    for (let attempt = 0; ; attempt += 1) {
      let response: Response | undefined;
      try {
        response = await this.fetch(url, init);
        lastNetworkError = undefined;
      } catch (err) {
        response = undefined;
        lastNetworkError = err;
      }
      if (response?.ok) return response;
      const transient =
        lastNetworkError !== undefined ||
        response?.status === 429 ||
        (response !== undefined && response.status >= 500);
      if (!transient || attempt >= this.maxRetries) {
        if (response !== undefined) return response;
        throw lastNetworkError;
      }
      await this.sleep(retryDelayMs(attempt, response));
    }
  }

  async getPackument(name: string): Promise<Packument> {
    const url = `${this.baseUrl}/${encodeURIComponent(name).replace('%40', '@')}`;
    const response = await this.fetchWithRetry(url);
    if (!response.ok) throw new Error(`Failed to fetch packument ${name}: ${response.status}`);
    return (await response.json()) as Packument;
  }

  async getTarball(tarballUrl: string): Promise<Uint8Array> {
    const response = await this.fetchWithRetry(tarballUrl);
    if (!response.ok) throw new Error(`Failed to fetch tarball: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}
