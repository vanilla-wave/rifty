// Per ADR 0015 the shim *data* lives in `@riftydev/shadow-registry`. The
// adapter that overlays these files into the playground VFS stays here
// (`realVite.ts`'s `overlayShims()`); this file is a thin re-export so
// existing import paths keep working.
export {
  browserShimFileSets,
  collectBrowserShimFiles,
  viteBuildShimFiles,
  viteBrowserShimFiles,
  type BrowserShimName,
} from '@riftydev/shadow-registry';
