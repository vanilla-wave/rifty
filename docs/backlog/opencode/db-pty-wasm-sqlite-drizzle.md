---
area: opencode
status: active
title: F03/F04 — #db/#pty + WASM-SQLite (sql.js) node:sqlite shim + drizzle path
created: 2026-06-08
why: DB/PTY layer for the eager boot DAG; ADR-0055/0056 drafts superseded by ratified ADR-0065; gated on Spike C
sources: [TASKS M12 F03/04, docs/opencode/decisions.md drafts 0055/0056, ADR-0065, Q-2026-05-30-102/103, audit-digest]
---
## Context
Features 03/04 supply the #db / #pty layer Spike C pulled to P2. Per README the sql.js `node:sqlite` `DatabaseSync` shim is BUILT, GREEN, WIRED: `packages/net/src/sqlite/` (engine/database-sync/statement-sync/register-builtins), parity-tested vs Node 24, RangeError-overflow-hardened, registered via `@riftydev/io` `registerBuiltin('sqlite', …)` (ADR-0035, zero reverse imports), proven by `sqlite-loader-roundtrip` conformance + `sqlite-opencode-boot` gate. ADR-0065 erratum: `drizzle-orm/node-sqlite` IS wired over the same `DatabaseSync` at the SHA, so the shim satisfies drizzle too (same surface) — the separate drizzle adapter (draft 0056) is VOID. #pty stays a throw-on-create stub (native PTY hard blocker).
## Options / Next
Decision (ADR-0065, RATIFIED): sql.js in-memory-first; corrects bun:sqlite→node:sqlite (the #db import map is stale; rifty resolves under `node` condition). Supersedes decisions.md drafts ADR-0055 (engine) + ADR-0056 (drizzle adapter). tier-A throw-on-USE registration is harness-local/shadow-registry, scoped to opencode load (Q-2026-05-30-102), NOT always-on. Remaining open under this concept: OPFS durable persistence (in-memory→durable) is DEFERRED — see sqlite-opfs-persistence item (net area, Q-2026-05-31-301). Registration module path is reversible (net area, Q-2026-05-31-302). The shim itself is no longer a boot blocker.
## Reversibility
IRREVERSIBLE (new dep sql.js + public builtin) → ratified ADR-0065. #db condition-delivery vehicle = ADR-0054 draft (see adr-0054-resolution-conditions). Q-2026-05-30-102/103 reversible, await end-of-M12 review.
