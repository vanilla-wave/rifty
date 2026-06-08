---
area: opencode
status: active
title: F06 — headless Server.listen boot (BOOT gate PASSED; ADR-0058 resolved no-op)
created: 2026-06-08
why: headless server boot; ADR-0058 draft resolved with no new builtin surface; downstream gates still open
sources: [TASKS M12 F06, docs/backlog/opencode/reference/README.md §BOOT gate, decisions.md ADR-0058, Q-2026-05-30-110/111/112, audit-digest]
---
## Context
Boot `Server.listen({port,hostname,mdns:false})` headless and serve real routes. README: BOOT gate ✅ PASSED (2026-06-01, zero walls). Eager `Layer.buildWithMemoMap` built the full ~40-layer DAG; the real `@effect/sql-sqlite-node` + `drizzle-orm/node-sqlite` ran 6 boot PRAGMAs + ~24 migrations against the sql.js shim under `Effect.orDie`; `NodeHttpServer.layer` bound rifty `node:http` into the port registry. `GET /global/health` → 200 (typed Effect HttpApi handler), `GET /doc` → 200 (306 KB OpenAPI). Nothing stubbed; predicted `ptyConnectApi` stub NOT needed (`Pty.defaultLayer` builds without a native pty — lazy per-connection).
## Options / Next
ADR-0058 (builtin-surface additions) RESOLVED 2026-06-01 as a no-op: boot called no unimplemented builtin/method, so recommendation A (harness-local `process.env` only) held — NO public builtin surface added, no on-disk ADR. Decision: if a future route surfaces a concrete missing builtin, open a fresh specific ADR for that named method — do NOT reopen 0058. Staged success markers (Q-111) localize regressions to shim/bridge/harness; trivial no-storage route via `dispatchToPort` (Q-112); mDNS-off via env (Q-110). Next downstream of boot: DB-READ done; Phase 3 live LLM remains.
## Reversibility
IRREVERSIBLE contingency (public builtin surface) NOT triggered → no ADR ratified; ADR-0058 closed as no-op. Q-110/111/112 reversible (fixture-local), await end-of-M12 review.
