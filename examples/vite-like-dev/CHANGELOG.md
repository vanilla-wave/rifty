# Changelog — @rifty-examples/vite-like-dev

## [Unreleased]

### Changed

- Transform execution is now an explicit `transformModule` capability. Plain
  JavaScript still runs without one; TS/TSX/JSX requests fail loudly with
  `NotImplementedError('vite-like-dev.transformModule')`. Integration coverage
  injects exact host esbuild; product esbuild activation is registry-owned.

### Fixed

- Declaration files (`.d.ts` / `.d.cts` / `.d.mts`) are now rejected as
  non-runnable modules with a loud 500 instead of being treated as transformable
  `.ts` requests and served as a fake-success empty module.

### Added

- `.ts` / `.tsx` / `.jsx` module requests run through the injected transform
  capability, and served ESM is parsed to rewrite bare specifiers to VFS-served
  URLs via the runtime resolver. The existing HTML/HMR behavior stays intact.
  Extensionless relative TS imports are resolved through the same loader and
  rewritten to served URLs instead of leaking `from "./dep"` to the browser.
