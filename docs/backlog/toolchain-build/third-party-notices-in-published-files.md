---
area: toolchain-build
status: ready
title: Every published package that bundles third-party code ships one generated notices file listing it
created: 2026-11-24
why: bundlers inline npm packages and whole generated/vendored upstream files into published @riftydev tarballs without their licenses (MIT/ISC/BSD/Zlib/Apache-2.0 require them with every copy)
user_story: As a maintainer about to publish @riftydev packages, I want each tarball to carry the licenses of the code bundled into it, but today workbench inlines 49 npm packages, the isolate guest 4, and undici/TypeScript/esbuild generated sources ship without any license text
sources: [docs/adr/runtime-js/0541-run-node-fetch-classes-over-the-browser-i-o-boundary.md, docs/public/publishing.md, docs/backlog/distribution/dependency-license-audit.md]
code: [tools/publishing/third-party-notices.mjs, tools/publishing/third-party-manifest.json, tools/checks/third-party-notices.mjs, tools/publishing/build-workbench-assets.mjs, packages/isolate-guest/scripts/build-guest.mjs, packages/isolate-host/scripts/build-runtime.mjs]
---

## Context

Measured 2026-11-24 on main `841fa5300` (esbuild 0.28.0 metafile, tsup sourcemap
`sources`):

- tsup `dist/` of the 19 publishable packages inlines no npm package; it inlines
  whole generated/vendored upstream files: runtime-js (undici 7.25.0
  `fetch/generated/classes.js`, TypeScript 5.9.3 `module-loader/generated/typescript-browser.js`),
  ts-language-service (TypeScript lib `vendor/lib-bundle.json`, also packed as is),
  shadow-registry (esbuild-wasm 0.28.0 `runtime/generated/esbuild-runtime.js`,
  embedding Go 1.26.1 `lib/wasm/wasm_exec.js`, BSD-3-Clause; Go's LICENSE is not
  in esbuild-wasm).
- workbench `dist/assets` (since 0.7.0): 49 npm packages (41 MIT, 3 Apache-2.0
  — typescript, crc-32, clean-git-ref —, 2 ISC, 1 BSD-3-Clause, pako MIT AND
  Zlib, sha.js MIT AND BSD-3-Clause), the three generated sources above, copies
  of `quickjs.wasm` and `sql-wasm.wasm`. License files: 71 585 B.
- isolate-guest `dist/guest.js` (unpublished): acorn, cjs-module-lexer,
  quickjs-emscripten-core, @jitl/quickjs-ffi-types + the TypeScript compiler;
  isolate-host copies it byte for byte.
- No own license file: `diff3@0.0.3` (MIT in source headers, two notices),
  `clean-git-ref@2.0.1` (Apache-2.0 declared, no text in npm or upstream repo
  at v2.0.1), `isarray@1.0.0` (MIT in README). pako's Zlib part lives only in
  `lib/zlib/*.js` headers. typescript ships `ThirdPartyNoticeText.txt`; no
  Apache `NOTICE` file in any of the three Apache packages.
- Published without notices (npm, 2026-11-24): runtime-js 0.6.0–0.11.0,
  workbench 0.1.0–0.11.0, shadow-registry 0.7.0–0.11.0, ts-language-service
  0.1.0–0.11.0. Fixed by the next version; nothing is (re)published here.

## Challenge

challenge: 2026-11-24 — clear — existing-baseline repair (README §Challenge: no premise critic); approach chosen by the user ("как Vite"), recorded below

## User scenario

Maintainer runs `pnpm build:libs` then `pnpm check:third-party-notices`;
`npm pack` of workbench, isolate-guest, isolate-host (and runtime-js,
ts-language-service, shadow-registry) contains `dist/THIRD_PARTY_NOTICES.md`
listing every package and copied file the bundler put into that tarball.

## Acceptance

1. Counted: npm packages the bundler inlined (esbuild metafile / tsup
   sourcemap `sources`) and whole files under `generated/`/`vendor/` dirs
   (bundled or packed as is); fragments and lines are not → scenario
2. One `dist/THIRD_PARTY_NOTICES.md` per publishable package with any counted
   input, written by `build:libs` from the bundler's input list; manual records
   (`tools/publishing/third-party-manifest.json`) only for generated/vendored
   dirs and for texts missing from a package's own files → scenario
3. Bundles carry no license text, only the line
   `/*! For third-party licenses see dist/THIRD_PARTY_NOTICES.md of this npm package */`;
   guest `legalComments` stays `'none'`; `guest.js` bytes before/after named → scenario
4. One check before publish (`pr:check` after `build:libs`, CI, `release.yml`,
   `first-publish.sh`): for every publishable package the packed notices file
   (`npm pack --dry-run`) equals the one derived from the bundler inputs, and
   every packed JS file with counted inputs carries the link line; red on
   mutants: package removed from the file, new inlined package without license
   and record, file in `vendor/` without manifest record; no content
   fingerprinting → scenario
5. Client-bundle budgets (`pnpm test:client-bundles`) unchanged; sizes before/after named → scenario
6. `docs/public/publishing.md` and ADR-0541 say how it works → ADR-0541

## Out of scope

- What emscripten's runtime put inside `quickjs.wasm`/`sql-wasm.wasm`: counted at package level as upstream ships them (declared residual).
- Someone taking one `guest.js` out of the package gets only the link line (as with webpack); accepted by the user.
- Hand-ported code (agent `src/pi-cli`, ADR-0569): already ships `THIRD_PARTY_NOTICES.md`; not a bundler input.
- Re-release or deprecation of published versions: user decision.

## Decisions

- User, 2026-11-24: the Vite-style package notices file; no license texts in bundles; no content fingerprint.
- Manager, 2026-11-24 (reversible): list from the bundler's metafile; node_modules inputs → package + its license files; generated/vendor inputs → small manual manifest; one mechanism for both.
- Manager, 2026-11-24: emscripten wasm counted per upstream package; contents not analysed.
- Manager, 2026-11-24: a record covers exactly its own package/file; no "any NOTICE in the tarball" fallback.
- File in `dist/` (already in `files`): npm packs it with no `files` change.
- No ADR: recorded in ADR-0541 §Notices + publishing.md.
