export const registryUrl: string;
export function inputFixture(
  name: 'root' | 'retained' | 'conflict' | 'nested',
): Promise<{ packageJsonText: string; packageLockText: string }>;
export function registryFixture(): Promise<{
  requests: { url: string; method: string }[];
  fetch: typeof globalThis.fetch;
  tarball(name: string, version: string): Uint8Array;
}>;
