export interface PackageBinSpawnRequest {
  readonly shimPath: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly previewScope?: string;
}
export function isBinShimPath(path: string): boolean {
  return path.includes('/node_modules/.bin/');
}
export function binNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
export function createPreviewScope(): string {
  return globalThis.crypto?.randomUUID?.() ?? `preview-${Date.now()}-${Math.random()}`;
}
export function preparePackageServerEnvironment(
  env: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return { ...env, NAPI_RS_FORCE_WASI: '1' };
}
