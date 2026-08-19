interface PatchSite {
  readonly needle: string;
  readonly replacement: string;
}

const readableDeleteReference: PatchSite = {
  needle: `function napi_delete_reference(env, ref) {
            if (!env)
                return 1;
            var envObject = emnapiCtx.envStore.get(env);
            if (!ref)`,
  replacement: `function napi_delete_reference(env, ref) {
            if (!env)
                return 1;
            var envObject = emnapiCtx.envStore.get(env);
            if (!envObject && napiModule.childThread)
                return 0;
            if (!ref)`,
};

const readableUnref: PatchSite = {
  needle: `function napi_reference_unref(env, ref, result) {
            if (!env)
                return 1;
            var envObject = emnapiCtx.envStore.get(env);
            envObject.checkGCAccess();`,
  replacement: `function napi_reference_unref(env, ref, result) {
            if (!env)
                return 1;
            var envObject = emnapiCtx.envStore.get(env);
            if (!envObject && napiModule.childThread)
                return 0;
            envObject.checkGCAccess();`,
};

const minifiedDeleteReference: PatchSite = {
  needle:
    'napi_delete_reference:function(e,r){if(!e)return 1;var t=d.envStore.get(e);return r?(d.refStore.get(r).dispose(),t.clearLastError()):t.setLastError(1)}',
  replacement:
    'napi_delete_reference:function(e,r){if(!e)return 1;var t=d.envStore.get(e);if(!t&&g.childThread)return 0;return r?(d.refStore.get(r).dispose(),t.clearLastError()):t.setLastError(1)}',
};

const minifiedUnref: PatchSite = {
  needle:
    'napi_reference_unref:function(e,r,t){if(!e)return 1;var n=d.envStore.get(e);if(n.checkGCAccess(),!r)',
  replacement:
    'napi_reference_unref:function(e,r,t){if(!e)return 1;var n=d.envStore.get(e);if(!n&&g.childThread)return 0;if(n.checkGCAccess(),!r)',
};

/** Exact upstream 1.0.3 backport; included in installArtifactIdentity. */
export const emnapiCoreOrphanedReferencePatchPolicy = {
  version: '1.10.0',
  readable: [readableDeleteReference, readableUnref],
  minified: [minifiedDeleteReference, minifiedUnref],
} as const;

export type EmnapiCorePatchFormat = keyof Pick<
  typeof emnapiCoreOrphanedReferencePatchPolicy,
  'readable' | 'minified'
>;

export function emnapiCoreOrphanedReferencePatchApplied(
  source: string,
  format: EmnapiCorePatchFormat,
): boolean {
  return emnapiCoreOrphanedReferencePatchPolicy[format].every((site) =>
    source.includes(site.replacement),
  );
}

/** Backport Rolldown 1.1.5's child-thread cleanup behavior without changing package identity. */
export function applyEmnapiCoreOrphanedReferencePatch(
  source: string,
  format: EmnapiCorePatchFormat,
): string {
  const sites: readonly PatchSite[] = emnapiCoreOrphanedReferencePatchPolicy[format];
  if (sites.every((site) => source.includes(site.replacement))) return source;
  if (!sites.every((site) => source.includes(site.needle))) {
    throw new Error(`@emnapi/core orphaned-reference patch failed: ${format} anchors drifted`);
  }
  return sites.reduce((prepared, site) => prepared.replace(site.needle, site.replacement), source);
}
