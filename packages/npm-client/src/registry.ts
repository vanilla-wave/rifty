/**
 * Registry client. The fetcher is pluggable so tests can use a mock.
 *
 * URLs follow the D-004 contract: a base URL configured by env or option,
 * never hardcoded. Default dev base is `/npm-registry` (Vite proxy); prod
 * decision is Q4'.
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

export class RegistryClient {
  readonly baseUrl: string;
  private readonly fetch: Fetcher;

  constructor(opts: { baseUrl?: string; fetch?: Fetcher } = {}) {
    this.baseUrl = (opts.baseUrl ?? '/npm-registry').replace(/\/$/, '');
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
