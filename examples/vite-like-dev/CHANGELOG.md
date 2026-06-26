# Changelog — @rifty-examples/vite-like-dev

## [Unreleased]

### Fixed

- Declaration files (`.d.ts` / `.d.cts` / `.d.mts`) are now rejected as
  non-runnable modules with a loud 500 instead of being treated as transformable
  `.ts` requests and served as a fake-success empty module.

### Added

- `.ts` / `.tsx` / `.jsx` module requests now run through the real vendored
  esbuild WASI transform, and served ESM is parsed to rewrite bare specifiers to
  VFS-served URLs via the runtime resolver. The existing HTML/HMR behavior stays
  intact. Extensionless relative TS imports are now resolved through the same
  loader and rewritten to served URLs instead of leaking `from "./dep"` to the
  browser.
