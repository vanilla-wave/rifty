---
area: playground
status: draft
title: Two-tab / two-owner over one OPFS project — behavior is undefined
created: 2026-07-06
why: Two tabs on the same OPFS project spawn two owner workers with concurrent VFS writes of undefined outcome — a silent-corruption risk that contradicts the fidelity mission; the only defined single-owner path today is the explicit-port BroadcastChannel claim (ADR-0186). Needs discovery before it can be made loud/safe.
user_story: As a user who duplicates the tab (or opens a shared preview URL while the playground is open), I want each tab to either work or refuse loudly, but today two tabs mean two owner workers over one OPFS project, concurrent writes with undefined outcome, and a preview that 503s with no explanation.
sources: [ADR-0165, ADR-0186, ADR-0150]
code: [apps/playground/src/App.tsx, apps/playground/src/glue/realVite.ts]
---

## Context

Discovery-first (replaces the premature `multi-tab-story` epic, deleted for being an empty umbrella). Only **explicit-port claim** is single-owner today: `listen(port)` broadcasts a bind-claim on the per-port BroadcastChannel and the loser gets Node-shaped `EADDRINUSE` (ADR-0186); the SW preview refuses to guess between two windows on one port (503). Everything else is undefined: two owner workers on one OPFS project, concurrent VFS writes, duplicated dev servers, session restore racing. ADR-0165 §3 keeps a single owner only WITHIN one tab (switch = sequential teardown+respawn; "two concurrent owners on the singleton syncMirror OPFS backend = emnapi pthread crash"); ADR-0150 routes child writes through the one owner — neither covers two BROWSER TABS. Silent-corruption contradicts the fidelity mission; "refuse loudly" is fine, "undefined" is not.

Two live items defer TO this gap and need it owned: `docs/backlog/vfs/iso-git-ref-torn-write-rows.md` ("Multi-tab concurrent commits to one repo — separate concern") and `docs/backlog/playground/reload-crash-consistency-fault-e2e.md` ("Multi-tab concurrent crash semantics — single-tab rows only").

## Options or Next

- Discovery FIRST: document today's actual two-tab behavior (do OPFS sync-access-handle exclusive locks already fail one owner? does the second owner boot at all? what does the SW route?). Evidence before design.
- Then decompose into items, e.g.: Web Locks single-owner-per-project claim; read-only second tab with a visible badge; honest takeover UX; cross-tab preview routing story.
- Whatever the design: no path may lead to silently interleaved OPFS writes or a preview that stops responding without diagnosis.

## Reversibility

REVERSIBLE — a backlog record + discovery task; no code, API, or disk-format change until decomposed (an IRREVERSIBLE single-owner mechanism choice would get its own ADR then).
