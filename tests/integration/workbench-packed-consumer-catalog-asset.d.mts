export interface InstalledPackage {
  readonly dir: string;
  readonly manifest: Readonly<Record<string, unknown>> & {
    readonly name: string;
    readonly version: string;
  };
}

export function findInstalledPackage(name: string, startingDirectory: string): Promise<string>;

export function resolveDeclaredCatalogAsset(options: {
  readonly producerRoot: string;
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}): Promise<InstalledPackage & { readonly expectedIntegrity: string }>;
