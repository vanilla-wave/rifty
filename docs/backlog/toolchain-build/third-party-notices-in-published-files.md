---
area: toolchain-build
status: ready
title: Every published file carrying a generated or vendored third-party source carries that source's license notice
created: 2026-11-24
why: undici, the TypeScript compiler + lib files and the esbuild runtime ship inside published @riftydev tarballs without their license text (MIT/Apache-2.0 require it); PR #444 adds Node's url/querystring the same way
user_story: As a maintainer about to publish @riftydev packages, I want every copied upstream source to reach npm with its license, but today the license sits in `src/**/generated/*.LICENSE` (not packed) or is stripped by `legalComments:'none'`
sources: [docs/adr/runtime-js/0541-run-node-fetch-classes-over-the-browser-i-o-boundary.md, docs/public/publishing.md]
code: [tools/publishing/generate-fetch-classes.mjs, tools/publishing/generate-eval-compiler.mjs, tools/shadow-registry/tools/generate-esbuild-runtime.ts, packages/ts-language-service/scripts/vendor-ts-lib.mjs, packages/isolate-guest/scripts/build-guest.mjs, packages/isolate-host/scripts/build-runtime.mjs]
---

## Context

Class: upstream code copied into the repo as a generated/vendored artifact
(`<pkg>/**/generated/`, `<pkg>/vendor/`) and bundled into published files.
Measured 2026-11-24 on main `841fa5300` after `pnpm build:libs`:

| source (license) | artifact | lands in (published) | notice there |
|---|---|---|---|
| undici 7.25.0 (MIT) | runtime-js `src/builtins/fetch/generated/classes.js` | runtime-js dist chunk, workbench `dist/assets` chunk | none (`undici.LICENSE` stays in `src`) |
| TypeScript 5.9.3 compiler (Apache-2.0) | runtime-js `src/module-loader/generated/typescript-browser.js` | runtime-js chunk, workbench chunk, isolate-guest/-host `dist/guest.js` | short header only; guest: none (`legalComments:'none'`) |
| TypeScript 5.9.3 lib `.d.ts` (Apache-2.0) | ts-language-service `vendor/lib-bundle.json` | `vendor/`, `dist/vendor/lib-bundle.json.js` | short header per file, no license text |
| esbuild 0.28.0 (MIT) | shadow-registry `src/runtime/generated/esbuild-runtime.js` | shadow-registry chunk, workbench chunk | none |
| Node v24.16.0 url/querystring (MIT), PR #444 | runtime-js `src/builtins/url-legacy/generated/legacy.js` | runtime-js, workbench, guest | `node.LICENSE` stays in `src` |

Published without notice (npm, 2026-11-24): runtime-js 0.6.0–0.11.0, workbench
0.1.0–0.11.0, shadow-registry 0.7.0–0.11.0, ts-language-service 0.1.0–0.11.0
(re-release/deprecation: user decision, reported to the manager).

License text, quoted:

- MIT (undici, esbuild, Node): "The above copyright notice and this permission
  notice shall be included in all copies or substantial portions of the Software."
- Apache-2.0 §4 (TypeScript `LICENSE.txt`): "(a) You must give any other
  recipients of the Work or Derivative Works a copy of this License; and (b) You
  must cause any modified files to carry prominent notices stating that You
  changed the files; and (c) You must retain, in the Source form of any
  Derivative Works that You distribute, all copyright, patent, trademark, and
  attribution notices from the Source form of the Work […]; and (d) If the Work
  includes a "NOTICE" text file as part of its distribution, then any Derivative
  Works that You distribute must include a readable copy of the attribution
  notices contained within such NOTICE file […]".
  `typescript@5.9.3` ships no `NOTICE` file (it ships `ThirdPartyNoticeText.txt`:
  notices of the third-party material in the lib `.d.ts` files — DefinitelyTyped,
  Unicode, W3C …). So: (a) full `LICENSE.txt`; (b) a change line on the
  wrapped+minified compiler; (c) the Microsoft header stays; lib files also carry
  `ThirdPartyNoticeText.txt`.

Inlined npm dependencies (workbench `dist/assets` ~50 packages, guest 4) and
copied `.wasm` (quickjs, sql.js) are the same legal class but a different
mechanism (build graph, not a committed artifact): finding
`docs/backlog/toolchain-build/bundled-npm-dependency-notices.md`.

## Challenge

challenge: 2026-11-24 — clear — existing-baseline repair (README §Challenge: no premise critic); scope (а) fixed by the manager, (б) split as a finding

## User scenario

Maintainer runs `pnpm build:libs && pnpm check:third-party-notices`; for each
publishable package it reads `npm pack --dry-run` and fails naming the package,
the packed file and the source whose code is there without its license.

## Acceptance

1. `check:third-party-notices` (in `pnpm pr:check` after `build:libs`, in CI and
   before `npm publish` in `release.yml`) reads every publishable package's
   `npm pack --dry-run` file list from disk; red on today's main for undici,
   TypeScript (compiler + lib) and esbuild → scenario
2. Discovery by convention, no per-source registry: every `generated/`/`vendor/`
   dir of a publishable package carries `<origin>.LICENSE` or is on the check's
   first-party list; a new third-party dir without a license is red; PR #444's
   `generated/node.LICENSE` is picked up with no check edit → scenario
3. Presence by content fingerprint of the committed artifact (whitespace-free
   windows), threshold and window size justified by measurement in the test;
   unit test: notice removed → red, new generated dir without license → red, a
   file without the source's code (false-positive candidate) → no requirement → scenario
4. Notice reaches the packed file: generators embed `/*! <LICENSE> */` (TypeScript:
   full `LICENSE.txt` + change line); guest/host `legalComments:'eof'`;
   `vendor/typescript.LICENSE` (LICENSE.txt + ThirdPartyNoticeText.txt) for the
   JSON lib bundle → ADR-0541
5. Sizes before/after: isolate guest bundle (+ warm `runCode` p50), packed client
   bundles (`pnpm test:client-bundles`, budget unchanged) → scenario
6. `docs/public/publishing.md` and ADR-0541 state how notices travel → ADR-0541

## Out of scope

- Notices of inlined npm dependencies and copied `.wasm` — finding `bundled-npm-dependency-notices.md`.
- Hand-ported code (agent `src/pi-cli`, ADR-0569): already ships `THIRD_PARTY_NOTICES.md`; no artifact to fingerprint.
- Re-release or deprecation of published versions: user decision.

## Decisions

- In-artifact legal comment over a package notices file: survives tsup chunking, copying `guest.js`, and consumer re-bundling (bundlers keep `/*!` by default).
- One check over packed files; generators own delivery; no build plugin.
- No ADR: delivery recorded in ADR-0541 §notices + publishing.md.
