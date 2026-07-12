# ADR 0242: Generated esbuild diagnostic provenance and target errno normalization

Status: Accepted
Date: 2026-07

> TL;DR: extend ADR-0226 with two generated diagnostic adapters only: recover exact Node validator locations from pinned sources, and normalize exact service-owned target errno spelling. Never rewrite user/plugin text.

## Context

Real `esbuild-wasm@0.28.0` over guest VFS matches native execution but exposes two target-runtime drifts. The browser client omits Node's `readFileSync`, so async option/plugin validation loses `lib/main.js:534/540` locations. The exact WASM binary emits `Not a directory` where the exact native binary emits `not a directory`. ADR-0226 D1's patch list was exhaustive and otherwise leaves channel/results source-owned, so both observable adapters need an explicit boundary.

## Decision

### D1 — Validator provenance has one generated owner

One private generated `WeakMap` tags errors at hash-pinned `getFlag` and `checkForInvalidFlags` construction sites. After upstream `extractErrorMessageV8`, one chokepoint fills an absent location only for those exact tagged origins. File, line, column, and line text derive from exact `esbuild@0.28.0/lib/main.js`; text, detail, plugin name, notes, and phase remain upstream-owned. Stack/function-name/line-number and message-text classification are forbidden.

### D2 — Target errno spelling has one service boundary

One generated chokepoint after upstream detail-stash materialization maps the exact WASM terminal `ENOTDIR` phrase to the exact native spelling only for service-origin diagnostics without plugin/detail/location provenance. It must sweep read/stat/readdir/mkdir/open/write/rename and result/onEnd aliases. Raw packet sentinels, global replacement, and rewriting user/plugin messages are forbidden.

### D3 — Both adapters are derived policy

Each adapter gets one semantic policy ID, exact browser/Node anchors, mutation tests, manifest hunks, differential rows, and negative user-text cases. Patching the WASM binary, weakening the native fixture, or adding an API/result facade is rejected.

## Consequences

- Native diagnostics match without copying channel, plugin, result, or lifecycle behavior.
- Source/WASM drift fails generation instead of silently changing classification.
- Only these two proven diagnostic differences narrow ADR-0226's source-owned rule; all other results remain untouched upstream output.
