/**
 * Registry client. Pluggable fetcher so tests can mock.
 *
 * URLs follow D-004 (ADR-0028): base URL from env/option, never hardcoded.
 * {@link getRegistryBaseUrl} is the single factory every consumer goes through.
 */

import {
  DEFAULT_FETCH_STALL_MS,
  discardBody,
  drainBodyBounded,
  fetchHeadersBounded,
} from './bounded-fetch.ts';

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
  /**
   * No-progress bound (ms) on the header wait AND each body chunk (the shared
   * bounded-fetch chokepoint; mirrors `InstallOptions.resolverStallTimeoutMs`).
   * A breach counts as TRANSIENT — it rides the retry ladder above, then fails
   * loudly. Default {@link DEFAULT_FETCH_STALL_MS}.
   */
  stallTimeoutMs?: number;
}

export interface RegistryRequestOptions {
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
}

function registryAbort(signal: AbortSignal, label: string): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(`${label}: aborted`);
}

async function waitWithSignal(
  operation: Promise<void>,
  signal: AbortSignal | undefined,
  label: string,
): Promise<void> {
  if (!signal) return await operation;
  if (signal.aborted) throw registryAbort(signal, label);
  operation.catch(() => {}); // abort can win while an injected sleep settles later
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(registryAbort(signal, label));
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
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

const packumentDecoder = new TextDecoder('utf-8');

export class RegistryClient {
  readonly baseUrl: string;
  private readonly fetch: Fetcher;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly stallTimeoutMs: number;

  constructor(opts: RegistryClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? getRegistryBaseUrl()).replace(/\/$/, '');
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.sleep = opts.sleep ?? defaultSleep;
    this.stallTimeoutMs = opts.stallTimeoutMs ?? DEFAULT_FETCH_STALL_MS;
  }

  /**
   * One BOUNDED attempt = header wait + full body drain (the shared
   * bounded-fetch chokepoint — no phase is ever awaited unbounded), retried on
   * TRANSIENT failures only — 429, 5xx, a thrown network error, or a
   * stall/byte-cap breach — with `Retry-After`/exponential backoff. A non-ok
   * response that survives every retry is RETURNED (body cancelled — callers
   * read only the status) so the caller throws the existing status-shaped
   * error; a persistent network error/stall is rethrown loudly (its message
   * names the operation, phase, and bound). A permanent 4xx (e.g. 404) never
   * retries.
   */
  private async fetchBytesWithRetry(
    url: string,
    label: string,
    options: RegistryRequestOptions = {},
  ): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; response: Response }> {
    let lastNetworkError: unknown;
    for (let attempt = 0; ; attempt += 1) {
      let response: Response | undefined;
      let bytes: Uint8Array | undefined;
      try {
        if (options.signal?.aborted) throw registryAbort(options.signal, label);
        response = await fetchHeadersBounded(
          (signal) => this.fetch(url, { signal }),
          this.stallTimeoutMs,
          label,
          options.signal,
        );
        if (response.ok) {
          bytes = await drainBodyBounded(response, {
            stallTimeoutMs: this.stallTimeoutMs,
            maxBytes: options.maxBytes,
            label,
            signal: options.signal,
          });
        } else {
          // Never-consumed body (callers read only the status) — cancelled
          // NOW, or the retry ladder piles open streams; see discardBody.
          discardBody(response);
        }
        lastNetworkError = undefined;
      } catch (err) {
        if (options.signal?.aborted) throw registryAbort(options.signal, label);
        response = undefined;
        lastNetworkError = err;
      }
      if (response?.ok && bytes !== undefined) return { ok: true, bytes };
      const transient =
        lastNetworkError !== undefined ||
        response?.status === 429 ||
        (response !== undefined && response.status >= 500);
      if (!transient || attempt >= this.maxRetries) {
        if (response !== undefined) return { ok: false, response };
        throw lastNetworkError;
      }
      await waitWithSignal(this.sleep(retryDelayMs(attempt, response)), options.signal, label);
    }
  }

  async getPackument(
    name: string,
    options: Omit<RegistryRequestOptions, 'maxBytes'> = {},
  ): Promise<Packument> {
    const url = `${this.baseUrl}/${encodeURIComponent(name).replace('%40', '@')}`;
    const result = await this.fetchBytesWithRetry(url, `packument ${url}`, options);
    if (!result.ok) throw new Error(`Failed to fetch packument ${name}: ${result.response.status}`);
    return JSON.parse(packumentDecoder.decode(result.bytes)) as Packument;
  }

  async getTarball(tarballUrl: string, options: RegistryRequestOptions = {}): Promise<Uint8Array> {
    if (
      options.maxBytes !== undefined &&
      (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0)
    ) {
      throw new TypeError('registry tarball maxBytes must be a positive safe integer');
    }
    const result = await this.fetchBytesWithRetry(tarballUrl, `tarball ${tarballUrl}`, options);
    if (!result.ok) throw new Error(`Failed to fetch tarball: ${result.response.status}`);
    return result.bytes;
  }
}
