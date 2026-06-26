---
area: runtime-js
status: active
title: Gate tsconfig baseUrl bare-specifier fallback by moduleResolution
created: 2026-06-26
why: auto-discovered tsconfig baseUrl is applied to bare specifiers even when modern TS moduleResolution would not use it.
user_story: As a Vite-style TS project user, I want rifty to resolve bare imports like TypeScript under bundler/node16/nodenext, but today baseUrl can intercept them when only paths should.
sources: [PR76 review C1, ADR-0170]
code: [packages/runtime-js/src/module-loader/tsconfig-paths.ts, packages/runtime-js/src/module-loader/resolver.ts, examples/vite-like-dev/src/index.ts]
---

## Context

`ModuleLoaderOptions.autoDiscoverTsconfigPaths` parses tsconfig and feeds both `paths` and `baseUrl` into runtime-js resolution. The resolver currently lets `baseUrl` participate in bare-specifier fallback whenever a `paths` pattern does not match. Modern TypeScript modes (`bundler`, `node16`, `nodenext`) do not use `baseUrl` for non-relative package-like resolution the same way; only `paths` should participate there.

## Options or Next

Carry the parsed `moduleResolution` mode alongside `paths`/`baseUrl`, gate baseUrl-for-bare to legacy-compatible modes, and add parity coverage for a `bundler` fixture where a bare specifier falls through to package resolution unless `paths` matches.

## Reversibility

REVERSIBLE — behavior correction behind the opt-in auto-discovery path, recorded here.
