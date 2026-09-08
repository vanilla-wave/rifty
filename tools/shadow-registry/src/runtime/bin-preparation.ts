import { binNameOf, isBinShimPath } from './launch.ts';
import { viteCliMode } from './vite-cli-prep.ts';
export { prepareViteBinSpawnRequest as preparePackageBinSpawnRequest } from './vite-cli-prep.ts';
export function installedBinPreviewSource(
  path: string,
  args: readonly string[],
): 'node' | 'preview' {
  return isBinShimPath(path) && binNameOf(path) === 'vite' && viteCliMode(args) === 'preview'
    ? 'preview'
    : 'node';
}
export const installedBinPreviewLabel = 'vite preview';
