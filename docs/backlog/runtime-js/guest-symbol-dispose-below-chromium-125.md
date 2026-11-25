---
area: runtime-js
status: draft
title: A guest on Chromium below 125 has no Symbol.dispose (below 127 no Symbol.asyncDispose), where Node 24 has both
created: 2026-11-25
why: ADR-0469's tier floor is Chromium 108; rifty defines neither symbol in the guest realm, so on browser hosts below 125/127 a rifty member keyed by them sits under the string 'undefined' and lowered guest `using` does not recognise it
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/public/compat/process.md, docs/backlog/runtime-js/stream-core-node-sources.md, docs/backlog/epics/node-streams-as-in-node/reference/route-b/product/bindings.ts]
code: [packages/runtime-js/src/builtins/events.ts]
---

## Context

- `@mdn/browser-compat-data` 8.1.10 (2026-11-19): Chrome `Symbol.dispose` 125, `Symbol.asyncDispose` 127,
  `using`/`await using` 134. Node v24.16.0 has both symbols natively; Node 20 defined them itself
  when V8 lacked them (v20.10.0 `lib/internal/process/pre_execution.js` `setupSymbolDisposePolyfill`:
  non-writable, non-configurable `Symbol.dispose`/`Symbol.asyncDispose` from primordials
  `SymbolFor('nodejs.dispose')`/`SymbolFor('nodejs.asyncDispose')`).
- rifty defines neither in the guest realm (`git grep -n "Symbol.dispose\|asyncDispose" -- ':(glob)packages/*/src/**'`,
  2026-11-25: uses only), and `check:es-floor` does not know them.
- Hosts: browser hosts below Chromium 125/127 only; in-process and isolate run Node 24's V8.
- The stream core's reach is already owned: ADR-0575 §2 («the bindings supply them or the core waits
  on a floor shim») and unit 8c (`runtime-js/stream-core-node-sources`: `check:es-floor` lists, floor
  lane). This item is the guest-realm side: what guest code reads as `Symbol.dispose`.
- First browser call site: `events.addAbortListener` (PR #455) returns `{ [Symbol.dispose]() {} }`.
  Without the symbol the key is the string `'undefined'` (`Reflect.ownKeys(d)` → `['undefined']`);
  derived from the language, not run on a Chromium below 125 (PR #455 review).

Who it reaches (below the floor):
- `events.addAbortListener`'s `Disposable` (compat `process.md` row `events.addAbortListener`): a
  direct `d[Symbol.dispose]()` works only because both sides read `'undefined'`; `Reflect.ownKeys(d)`
  is `['undefined']`;
- Node's stream core from Node's sources: the probe's bindings take primordials `SymbolDispose`/
  `SymbolAsyncDispose` from `Symbol.dispose`/`Symbol.asyncDispose` (`reference/route-b/product/bindings.ts:198-200`),
  so `[SymbolDispose]` and `[SymbolAsyncDispose]` members land on one key `'undefined'`, the last wins;
  a binding-private symbol (8c's option) would leave guest `r[Symbol.asyncDispose]` absent;
- guest `using` lowered for an older target: esbuild's helper falls back to `Symbol.for('Symbol.dispose')`
  and throws «Object not disposable» on rifty's object (esbuild 0.28.0 `--target=es2020`, review);
  TypeScript's `__addDisposableResource` throws `TypeError: Symbol.dispose is not defined.`
  (`packages/runtime-js/src/module-loader/generated/typescript-browser.js`);
- a guest polyfill that defines its own `Symbol.dispose` does not see rifty's `'undefined'`-keyed members.

## Question

Owner: the user (tier floor behaviour). Options seen:
- define `Symbol.dispose`/`Symbol.asyncDispose` in the guest realm at startup when absent, as Node 20 did;
- declare the gap below Chromium 125/127 per member (compat ⚠️/❌).

## Challenge

challenge: 2026-11-25 — finding capture; no premise critic (README §Challenge)
