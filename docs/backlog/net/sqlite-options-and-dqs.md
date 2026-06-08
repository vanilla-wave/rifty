---
area: net
status: parked
title: node:sqlite inert options (readOnly/allowExtension/timeout) + DQS toggle made effective
created: 2026-06-08
why: Options accepted-but-inert and DQS can't be toggled in prebuilt sql.js WASM — needs custom rebuild
sources: [ADR-0065, docs/compat/sqlite.md DatabaseSyncOptions + DQS caveat]
---
## Context
⚠️ partial: `DatabaseSync` options `readOnly` / `allowExtension` / `timeout` are accepted (so a real opencode call isn't rejected) but inert in the first cut. `enableDoubleQuotedStringLiterals` is a no-op — the prebuilt sql.js WASM leaves DQS ON and exposes no runtime toggle (`PRAGMA legacy_double_quoted_strings` is inert), whereas Node's `node:sqlite` runs DQS OFF. Cross-engine divergence: `INSERT INTO t VALUES ("x",1)` throws on Node but is silently accepted as a string literal here. Workaround: use single-quoted SQL literals (canonical form) for parity.

## Options / Next
Making `readOnly`/`timeout`/DQS effective needs a custom sql.js WASM rebuild (runtime DQS toggle, read-only/timeout enforcement); out of scope for the in-memory first cut. Next (gated): only when a consumer needs an enforced option; until then documented as accepted-but-inert with the DQS caveat in docs/backlog/net/ (this item).

## Reversibility
IRREVERSIBLE when pursued (custom WASM rebuild for DQS/readOnly/timeout). Parked behind verified need; accepted-but-inert + documented caveat is the recorded scope.
