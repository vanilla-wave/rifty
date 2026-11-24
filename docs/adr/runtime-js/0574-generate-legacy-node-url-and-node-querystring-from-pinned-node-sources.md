# ADR 0574: Generate legacy node:url and node:querystring from pinned Node sources

Status: Accepted
Date: 2026-11

> TL;DR: `url.parse`/`format`/`resolve`/`resolveObject`, `Url` and `querystring` are Node v24.16.0's own JS, vendored and generated with checked anchors and a drift check; only `toASCII`, `isInsideNodeModules`, errors and intrinsics are bound. `toASCII` of a non-ASCII or `xn--` label uses the host's load-time `URL` (the user's choice 2026-11-24); no `URL` → named gap.

## Context

Contract `docs/backlog/runtime-js/node-url-legacy-api-port.md`; probe
`docs/backlog/runtime-js/reference/url-legacy/`. rifty's `url.ts` approximated the legacy API
with `new URL` plus a regex fallback: 905/1 314 of Node's own url-test calls differ with a global
`URL`, 1 038 in the isolate guest (no `URL` at load). Node's legacy API is JS; native code is only
`toASCII` (ada 3.4.4 `idna::to_ascii`) and `isInsideNodeModules` (DEP0169's caller test).

`toASCII` on Unicode 17.0.0 IdnaTestV2 (6 276 inputs reach it; `idna-step/`): `tr46` 6.0.0
differs on 304 under every flag setting — ada always runs its own partial per-label Bidi check
(`is_label_valid`); Chromium 148 `URL` alone on 2 226 (no `xn--` check for an ASCII host); `URL`
plus ada's punycode round trip on 307 (305 Bidi, 2 IPv4 from mapped digits); with a neutral label
appended for the parse (Decision 3), on 6 598 hostnames: 341 (306 Bidi, 30 forbidden host code
points, 1 mapped `%`, 4 Unicode labels whose ASCII part starts with `xn--`), Chromium 148.

## Decision

1. Vendor Node v24.16.0 `lib/url.js`, `lib/querystring.js`, `lib/internal/querystring.js`,
   `lib/internal/constants.js`, `lib/internal/url.js` (protocol sets only) and Node's `LICENSE`
   under `tools/publishing/node-url-legacy/`, pinned by sha256. `generate-url-legacy.mjs` applies
   exact-once anchors and writes `builtins/url-legacy/generated/`; `check:url-legacy-drift`
   checks the committed output. Edits only bind inputs; parsing, formatting, resolution, escaping
   and the export objects stay upstream's.
2. Bindings (`builtins/url-legacy/bindings.ts`): `primordials` → intrinsics captured at load
   (also `Reflect.apply` and what `to-ascii.ts` calls; error-message building and
   `bindingUrl.format` still call live ones, `backlog/runtime-js/post-guest-paths-use-replaceable-intrinsics`);
   `ERR_INVALID_ARG_TYPE`/`ERR_INVALID_URL`/`ERR_INVALID_URI` → Node's class, code, message, own
   enumerable `code`/`input`; `validateString`/`validateObject` (default options); `spliceOne`;
   `Buffer` → rifty's; `process` → the active process at call time (`emitWarning` patchable).
3. `toASCII` (`to-ascii.ts`): ASCII without an `xn--` label → unchanged (ada's ASCII path). Else
   the `URL` constructor and `hostname` getter captured at load parse `http://<host>.x/` (the
   neutral last label keeps WHATWG's IPv4 "ends in a number" rule out; ada has none), `.x` cut; each
   `xn--` label of the result is decoded by ada's `punycode_to_utf32` (hand copy, ~60 lines;
   all-ASCII or > U+10FFFF → error, as ada) and the decoded name must parse back to the same
   host. Failure → `''` (ada's error; url.js throws `ERR_INVALID_URL`). No `URL` at load →
   `NotImplementedError('url.toASCII')`. A guest's later `globalThis.URL` is never read.
4. `isInsideNodeModules(4)`: superseded 2026-11-24 (§Corrections) — a constant `true`; no DEP0169.
5. `instanceof URL` → the load-time `URL`, else a class no value is an instance of.
   `bindingUrl.format(href, fragment, unicode, search, auth)` → `href` where no option changes it,
   else `NotImplementedError('url.format.options')`. `domainToASCII`, `domainToUnicode`,
   `urlToHttpOptions` → named-loud members (ADR-0443). `URL`, `URLSearchParams`,
   `pathToFileURL`, `fileURLToPath` stay rifty's.

## Portability inventory

| Binding | Class / authority | Drift guard | Kill condition |
|---|---|---|---|
| `toASCII` via host `URL` | platform-gap; the user's choice 2026-11-24 | IdnaTestV2 rows pinned per host (browser-unit), ASCII rows exact in the isolate | the isolate Web API goal delivers a `URL` (its candidate: the generated `ada::idna` port) |
| `isInsideNodeModules` (constant `true`, no DEP0169) | platform-gap; the user's choice 2026-11-24 | declared DEP0169 rows (Node's output without it) | a caller test that cannot break under any guest `Error` state |
| errors, validators, intrinsics | substitution-environment | generator anchors + differential corpus | none |

## Alternatives rejected

- Hand TS port: the same semantic copy, no drift check; `lib/url.js` is 1 049 lines.
- npm `url@0.11.4`: 127/1 313 differ.
- `tr46` for `toASCII`: 304 IdnaTestV2 rows differ (Context), +241 KB min.
- Named gap for every non-ASCII host on every host: throws where browser hosts work today.

## Consequences

- One `node:url` behaviour on every host for ASCII hosts; `Url` shape, errors, DEP0170 (DEP0169 not emitted, §Corrections).
- Browser hosts: `toASCII` residual declared (compat ⚠️); isolate: non-ASCII hosts loud (❌).
- Cost, 2026-11-24 at `313d64326` (Node v24.16.0, esbuild 0.28.0, Chromium 148; review round 1 adds a few hundred bytes, not remeasured): generated `legacy.js` 19 139 B;
  isolate `guest.js` 7 123 270 → 7 170 362 B (+47 092; gzip +10 855); `client-bundle-budget`
  generic 932 920 → 955 554 min (+22 634; gzip 279 754 → 287 956, +8 202 of 332 000), toolchain
  1 061 998 → 1 084 631 (+22 633; gzip +7 896 of 386 000), main/sw unchanged; ceilings untouched.
  Warm `runCode` median (40) of 1 000 `parse(…, true)` + `resolve`: 31.4 → 19.3 ms (empty run
  13.5 / 13.9 ms). Chromium, `toASCII` of a non-ASCII host warm: ~1.8 µs (two `URL` parses).
- Publishing gate: no package with this code is published before the generated-sources license
  unit (the Node notice is not in `dist`; review round 1).
- Re-pin of Node: rerun the generator, the corpus and IdnaTestV2 suites.

## Corrections

- 2026-11-24 — §4 overturned, the user's choice («ок» to the manager on removing caller detection):
  rifty has no `isInsideNodeModules` walk; the binding is `true` for every caller, so `url.parse`
  never emits DEP0169 (Node: for a caller outside `node_modules`); DEP0170 stays. Why: three review
  rounds in a row broke the walk through the guest's `Error` state — a non-writable
  `stackTraceLimit`, a frozen `Error` / unsettable `prepareStackTrace`, then a guest
  `Object.getOwnPropertyDescriptor` read by rifty's stack-hook owner — each time `url.parse` threw
  or the guest's hook stayed replaced (`.stack` of later errors an array). Declared: compat
  modules.md `node:url`; rows `dep0169-rows.cjs`, `error-state-rows.cjs`, `guest-rows.cjs`
  (Node's output without its DEP0169).
