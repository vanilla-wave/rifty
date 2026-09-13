export interface InstalledManifest {
  readonly name: string;
  readonly version: string;
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>;
}
export interface InstalledEntry {
  readonly dir: string;
  readonly manifest: InstalledManifest;
}
export interface RegistryEntry {
  readonly name: string;
  readonly manifest: InstalledManifest;
  readonly tarball: string;
  readonly integrity: string;
  readonly shasum: string;
}
export interface PackRunOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly env?: Record<string, string>;
}
export interface InstalledRegistry {
  readonly origin: string;
  readonly requests: string[];
  readonly responses: unknown[];
  assertResolution(entry: {
    readonly resolved: string;
    readonly integrity: string;
    readonly version: string;
  }): void;
  deny(): void;
  close(): Promise<void>;
}
export function readJson(path: string): Promise<unknown>;
export function findInstalledPackage(name: string, startingDirectory: string): Promise<string>;
export function installedClosure(
  seedDirectories: Iterable<string>,
): Promise<Map<string, InstalledEntry>>;
export function packInstalledPackages(
  packages: Iterable<readonly [string, { readonly dir: string }]>,
  tarballRoot: string,
  npmCacheRoot: string,
  run: (command: string, args: string[], options: PackRunOptions) => Promise<unknown>,
): Promise<Map<string, string>>;
export function tarballIntegrity(bytes: Uint8Array): string;
export function registryEntries(
  closure: Iterable<readonly [string, { readonly manifest: InstalledManifest }]>,
  tarballs: Map<string, string>,
): Promise<Map<string, RegistryEntry>>;
export function startInstalledRegistry(
  packages: Map<string, RegistryEntry>,
  options?: {
    readonly registerClose?: (close: () => Promise<void>) => { cleanup(): Promise<void> };
  },
): Promise<InstalledRegistry>;
