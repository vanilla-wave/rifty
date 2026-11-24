# ADR 0574: Generate legacy node:url and node:querystring from pinned Node sources

Status: Proposed
Date: 2026-11

> TL;DR: `url.parse`/`format`/`resolve`/`resolveObject`, `Url` and `querystring` are Node v24.16.0's own JS, vendored and generated with checked anchors and a drift check; only `toASCII`, `isInsideNodeModules`, errors and intrinsics are bound. `toASCII` of a non-ASCII or `xn--` label uses the host's load-time `URL` (manager's reversible default, the user's choice pending); no `URL` → named gap.

## Context

Contract `docs/backlog/runtime-js/node-url-legacy-api-port.md`; probe
`docs/backlog/runtime-js/reference/url-legacy/`. rifty's `url.ts` approximated the legacy API
with `new URL` plus a regex fallback: 904/1 313 of Node's own url-test calls differ with a global
`URL`, 1 037 in the isolate guest (no `URL` at load). Node's legacy API is JS; native code is only
`toASCII` (ada 3.4.4 `idna::to_ascii`) and `isInsideNodeModules` (DEP0169's caller test).

`toASCII` on Unicode 17.0.0 IdnaTestV2 (6 276 inputs reach it; `idna-step/`): `tr46` 6.0.0
differs on 304 under every flag setting — ada always runs its own partial per-label Bidi check
(`is_label_valid`); Chromium 148 `URL` alone on 2 226 (no `xn--` check for an ASCII host); `URL`
plus ada's punycode round trip on 307 (305 Bidi, 2 IPv4 from mapped digits).

## Decision

1. Vendor Node v24.16.0 `lib/url.js`, `lib/querystring.js`, `lib/internal/querystring.js`,
   `lib/internal/constants.js`, `lib/internal/url.js` (protocol sets only) and Node's `LICENSE`
   under `tools/publishing/node-url-legacy/`, pinned by sha256. `generate-url-legacy.mjs` applies
   exact-once anchors and writes `builtins/url-legacy/generated/`; `check:url-legacy-drift`
   checks the committed output. Edits only bind inputs; parsing, formatting, resolution, escaping
   and the export objects stay upstream's.
2. Bindings (`builtins/url-legacy/bindings.ts`): `primordials` → intrinsics captured at load;
   `ERR_INVALID_ARG_TYPE`/`ERR_INVALID_URL`/`ERR_INVALID_URI` → Node's class, code, message, own
   enumerable `code`/`input`; `validateString`/`validateObject` (default options); `spliceOne`;
   `Buffer` → rifty's; `process` → the active process at call time (`emitWarning` patchable).
3. `toASCII` (`to-ascii.ts`): ASCII without an `xn--` label → unchanged (ada's ASCII path). Else
   the `URL` constructor and `hostname` getter captured at load parse `http://<host>/`; each
   `xn--` label of the result is decoded by ada's `punycode_to_utf32` (hand copy, ~60 lines;
   all-ASCII or > U+10FFFF → error, as ada) and the decoded name must parse back to the same
   host. Failure → `''` (ada's error; url.js throws `ERR_INVALID_URL`). No `URL` at load →
   `NotImplementedError('url.toASCII')`. A guest's later `globalThis.URL` is never read.
4. `isInsideNodeModules(4)`: `Error.captureStackTrace` under rifty's one `prepareStackTrace` owner
   with the guest's hook and `stackTraceLimit` set aside; window = 4 frames from `urlParse`, as
   Node's `CurrentStackTrace(4)`. A frame is the guest's iff V8 `isEval()` (rifty compiles guest
   CJS/ESM/`-e` with `Function`/indirect eval); others count as Node's `node:` frames. First guest
   frame with a non-empty name decides (`/node_modules/`).
5. `instanceof URL` → the load-time `URL`, else a class no value is an instance of.
   `bindingUrl.format(href, fragment, unicode, search, auth)` → `href` where no option changes it,
   else `NotImplementedError('url.format.options')`. `domainToASCII`, `domainToUnicode`,
   `urlToHttpOptions` → named-loud members (ADR-0443). `URL`, `URLSearchParams`,
   `pathToFileURL`, `fileURLToPath` stay rifty's.

## Portability inventory

| Binding | Class / authority | Drift guard | Kill condition |
|---|---|---|---|
| `toASCII` via host `URL` | platform-gap; manager 2026-11-24, user's choice pending | IdnaTestV2 rows pinned per host (browser-unit), ASCII rows exact in the isolate | user picks the generated `ada::idna` port, or the isolate gets a `URL` |
| `isInsideNodeModules` | platform-gap; this ADR | DEP0169 window parity rows | none (native in Node) |
| errors, validators, intrinsics | substitution-environment | generator anchors + differential corpus | none |

## Alternatives rejected

- Hand TS port: the same semantic copy, no drift check; `lib/url.js` is 1 049 lines.
- npm `url@0.11.4`: 127/1 313 differ.
- `tr46` for `toASCII`: 304 IdnaTestV2 rows differ (Context), +241 KB min.
- Named gap for every non-ASCII host on every host: throws where browser hosts work today.

## Consequences

- One `node:url` behaviour on every host for ASCII hosts; `Url` shape, errors, DEP0169/DEP0170.
- Browser hosts: `toASCII` residual declared (compat ⚠️); isolate: non-ASCII hosts loud (❌).
- Cost: recorded in the contract's GREEN line (bundle bytes, warm call) before merge.
- Re-pin of Node: rerun the generator, the corpus and IdnaTestV2 suites.
