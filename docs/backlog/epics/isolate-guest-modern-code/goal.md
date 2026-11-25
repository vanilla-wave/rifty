---
kind: epic
status: draft
title: Isolate guest modern code — Node 24's URL/URLSearchParams and ES module files in the isolate guest
created: 2026-11-25
value: A guest program in `runCode` or a sandbox `exec` that is an `.mjs`/`"type": "module"` file, imports an ESM-only package, or uses `URL`, `import.meta.url` and `pathToFileURL` gets what `node <path>` gives over the same files.
user_story: As a Node service running model-written code in an isolate-host sandbox, I want an `.mjs` entry that imports an ESM-only package and builds paths with `new URL('./out/', import.meta.url)` to run as in `node`, but today it is `NotImplementedError('isolate-host.esm')`, `URL` is a ceiling and the runtime's own `URL` uses leak `URLConstructor is not a constructor`
---

## Outcome

Split out of goal `isolate-guest-web-api` by the user's answer of 2026-11-25 (recorded by the
manager in that goal's Decisions). Draft, no units: whether to run it now is the user's.

The isolate guest (`runCode`, sandbox `exec`) gains Node 24's `URL`/`URLSearchParams` (and
`url.URL`/`url.URLSearchParams` as the same objects); the runtime's own `URL` uses
(`pathToFileURL`/`fileURLToPath`, `import()` by `file:` URL, `createRequire('file:…')`, `fs` with a
`URL` path) give Node's result; ES module files load as in `node <path>` (`.mjs`,
`"type": "module"`, typeless ESM `.js`, `import`/`import()`, top-level await, `import.meta`,
`require(esm)` with Node 24's default, leaving PR #440's `--no-require-module` deviation); the legacy
`url` API's isolate gap `url.toASCII` (PR #444) closes through the guest `URL`.

## User scenario

`/workspace/main.mjs` in a sandbox whose `node_modules` holds nanoid 5 (ESM-only) imports it and a
CommonJS module, builds paths with `new URL('./out/', import.meta.url)` and `fileURLToPath`, writes
a file; `sandbox.exec('main.mjs')` gives the stdout, stderr, exit code and files of
`node main.mjs` over the same files.

## Measured (2026-11-24, probes in `epics/isolate-guest-web-api/reference/`)

- Seam (`seam-esm`): a real `URL` installed before the runtime loads makes every `URL` row of
  `runtime-js/isolate-web-globals-captured-at-load` equal Node with no runtime change; load-time
  reads `internal/posix-file-url.ts:1` (`URL`), `builtins/url.ts:17` (`URLSearchParams`) — only
  these load-time reads were rerun on main bc3412420 (`today`); the seam's `URL` rows and the ESM
  results below are from 1c00c6292, before PR #444's `node:url` port.
- ESM (`seam-esm` §3): with `URL` first and `declareNoEsmLoader` removed, the loader needs nothing
  else — `.mjs`, `"type": "module"`, typeless ESM, `import` of CommonJS, `import()`, top-level await,
  `require(esm)`, JSON import, `import.meta.*` equal Node; stops: nanoid 5
  (`runtime-js/esm-import-binding-asi`, every host by source), ESM diagnostics text (direction F),
  `data:` imports (every host). `-e` ES modules are separate work (`runtime-js/node-cli-esm-eval-context`).
- `URL` source (`sources-native`): whatwg-url 15.1.0's parser 0/886 WPT, 0/278 setters vs Node, but its
  host IDNA (tr46 6.0.0) differs from Node's ada on 308/6 357 IdnaTestV2 17.0.0 hosts, all Bidi
  (`idna-url-host.cjs`) — the host step needs a port of Node's `ada::idna` (implementation thread of
  PR #444's estimate: 82–97 KB gzip, 53 KB with ICU NFC). core-js 51 WPT differ; a host bridge was
  rejected (no faster, outside the isolate's memory limit, amends ADR-0557 §6).
- Cost: core-js `URL` first +2.5 ms on a 13 ms empty `runCode`; whatwg-url eager +3.8 ms, its tr46
  table deferred +0.8 ms (no `ada::idna` port measured).

## Invariants

<!-- Not drafted: the user decides whether this goal runs. -->

## Challenge

challenge: 2026-11-25 — not run (split-out draft carrying measured facts; premise check when the
user opens it)

## Decisions

- 2026-11-25 — user (recorded by the manager in goal `isolate-guest-web-api` Decisions): `URL`/
  `URLSearchParams` and ES modules leave that goal for this one; whether to do it now — later.
