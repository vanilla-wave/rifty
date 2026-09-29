---
area: runtime-js
status: draft
title: Chromium 108 SDK import rejects synchronous main-thread WASM compilation
created: 2026-09-28
why: measured floor build cannot import the SDK before sandbox boot; the CJS lexer synchronously compiles a WASM module exceeding the browser main-thread limit
sources: [docs/backlog/runtime-js/reference/chromium108-sdk-wasm-import.json, ADR-0469, ADR-0477]
code: [packages/runtime-js/src/module-loader/cjs-static-exports.ts, apps/playground/browser-support.js, tools/floor-lane/run.mjs]
---

## Context

Finding, browser-support-floor I7 record-only discovery. Run
`floor-chromium-2026-09-27T22:57:03.755Z`, source revision
`850eeee2640aae0793c5c629994acd20821cbf95` plus PR #362 working tree,
Playwright 1.28.1, Chromium **108.0.5359.29**, macOS arm64.

Opening the headerless `/browser-support.html` fails at `sdk-import`, before
support/boot/install. Native `RangeError`:
`WebAssembly.Compile is disallowed on the main thread, if the buffer size is larger than 4KB. Use WebAssembly.compile, or compile on a worker thread.`

Raw artifact retains the stack: Vite dependency chunk `initSync` → transformed
`packages/runtime-js/src/module-loader/cjs-static-exports.ts:17:1`.
Source has top-level `initSync()` from `cjs-module-lexer`; this is an actual
product import graph, not a failed browser launch. Which public re-export brings
the lexer to this page, the affected version range, and the repair remain unproven.

User path: open the supplied protocol page on Chromium 108; SDK module import
fails before pressing Run. Carrier recipe: `tools/floor-lane/README.md`, Chromium
pin in ADR-0477; native failure captured verbatim in the source JSON.

Compat: measured Chromium108 floor **❌ sdk-import**, not a claim about Chromium109
or an alternative SDK build. Matrix owner: `docs/public/compat/browsers.md`.

## Executed command

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/rifty-floor-node18 node tools/floor-lane/run.mjs --engine chromium --runner /tmp/rifty-browser-floor-data/node_modules/playwright-108 --url http://127.0.0.1:5611/browser-support.html --output /tmp/pr362-floor108-final.json
```

Browser came from the official Playwright1.28.1 archive, extracted under
Node18.20.8 after the Node24 extractor produced a truncated executable.

## Canonical default-run confirmation

Raw artifact: `docs/backlog/runtime-js/reference/chromium108-sdk-wasm-import-canonical.json`. Same product outcome reproduced with automatic pinned
runner/browser installation, without runner/executable overrides:

```sh
node tools/floor-lane/run.mjs --engine chromium --url http://127.0.0.1:5611/browser-support.html --output /tmp/pr362-floor108-canonical.json
```

sdk-import: same native main-thread WASM >4KB RangeError; Chromium108.0.5359.29, runner1.28.1.
Runtime sources were at `850eeee2640aae0793c5c629994acd20821cbf95`; runner repairs
were still uncommitted after that revision. The earlier override-based artifact
remains history. This confirms the observation, not a root cause or broader
version range.

## Classification

Browser native WASM admission × product import boundary; `false-fallback` /
`provenance-lie` (computed prerequisites do not establish runnable import).
No transport fault, cache key or new coordination mechanism established.
No fake lexer, parity weakening or speculative fallback proposed.

Dedup 2026-09-28: backlog titles/code + traps + declined concepts searched for
`4KB`, `initSync`, `cjs-static-exports`, Chromium108; no matching finding.

## Decisions

- 2026-09-28 — capture only; I7 records product reds, no expansion of this epic into old-browser fixes. Owner: runtime-js; trigger: pickup of Chromium108 execution support. No implementation selected.
