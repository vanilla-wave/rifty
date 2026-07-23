/** Exact installed-tree transform; included in installArtifactIdentity. */
export const viteCliActionPatchPolicy = {
  needle: 'this.runMatchedCommand();',
  replacement: `var __riftyAction = this.runMatchedCommand();
      if (__riftyAction && typeof __riftyAction.then === "function" && globalThis.__riftyTrackCliPromise) {
        globalThis.__riftyTrackCliPromise(__riftyAction);
      }`,
} as const;

/** Chokidar's directory catalog must never contain a directory as its own empty child. */
export const viteRootWatchPatchPolicy = {
  needle: 'if (item !== ONE_DOT && item !== TWO_DOTS) items.add(item);',
  replacement: 'if (item !== EMPTY_STR && item !== ONE_DOT && item !== TWO_DOTS) items.add(item);',
} as const;

export function viteCliActionPatchApplied(source: string): boolean {
  return source.includes(viteCliActionPatchPolicy.replacement);
}

/** Pure installed-tree transform shared by acquisition and artifact proof. */
export function applyViteCliActionPatch(source: string): string {
  if (viteCliActionPatchApplied(source)) return source;
  if (!source.includes(viteCliActionPatchPolicy.needle)) {
    throw new Error('vite CLI keepalive patch failed: runMatchedCommand call shape not found');
  }
  return source.replace(viteCliActionPatchPolicy.needle, viteCliActionPatchPolicy.replacement);
}

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
