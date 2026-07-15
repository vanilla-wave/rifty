/** Exact installed-tree transform; included in installArtifactIdentity. */
export const viteCliActionPatchPolicy = {
  needle: 'this.runMatchedCommand();',
  replacement: `var __riftyAction = this.runMatchedCommand();
      if (__riftyAction && typeof __riftyAction.then === "function" && globalThis.__riftyTrackCliPromise) {
        globalThis.__riftyTrackCliPromise(__riftyAction);
      }`,
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
