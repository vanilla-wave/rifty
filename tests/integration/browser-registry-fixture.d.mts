import type { RegistryEntry } from './installed-registry.mjs';
export function browserRegistryPackages(repoRoot: string): Promise<Map<string, RegistryEntry>>;
