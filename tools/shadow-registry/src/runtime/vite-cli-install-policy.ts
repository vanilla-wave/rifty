/** Chokidar's directory catalog must never contain a directory as its own empty child. */
export const viteRootWatchPatchPolicy = {
  needle: 'if (item !== ONE_DOT && item !== TWO_DOTS) items.add(item);',
  replacement: 'if (item !== EMPTY_STR && item !== ONE_DOT && item !== TWO_DOTS) items.add(item);',
} as const;

export function viteRootWatchPatchApplied(source: string): boolean {
  return source.includes(viteRootWatchPatchPolicy.replacement);
}

/** Exact Vite-bundled Chokidar transform; drift fails acquisition loudly. */
export function applyViteRootWatchPatch(source: string): string {
  if (viteRootWatchPatchApplied(source)) return source;
  if (!source.includes(viteRootWatchPatchPolicy.needle)) {
    throw new Error('vite root watcher patch failed: Chokidar DirEntry.add shape not found');
  }
  return source.replace(viteRootWatchPatchPolicy.needle, viteRootWatchPatchPolicy.replacement);
}

/** Vite strips the leading slash when its project root is the filesystem root. */
export const viteRootUrlPatchPolicy = {
  needle: 'resolved.id.slice(root.length)',
  replacement: 'resolved.id.slice(root === "/" ? 0 : root.length)',
} as const;

export function viteRootUrlPatchApplied(source: string): boolean {
  return source.includes(viteRootUrlPatchPolicy.replacement);
}

/** Preserve ordinary module URLs, including the single React Refresh module identity. */
export function applyViteRootUrlPatch(source: string): string {
  const original = source.split(viteRootUrlPatchPolicy.needle).length - 1;
  const prepared = source.split(viteRootUrlPatchPolicy.replacement).length - 1;
  if (original + prepared !== 1)
    throw new Error(
      `vite root URL patch failed: expected exactly one resolved-id root slice; found ${original + prepared}`,
    );
  return prepared
    ? source
    : source.replace(viteRootUrlPatchPolicy.needle, viteRootUrlPatchPolicy.replacement);
}
