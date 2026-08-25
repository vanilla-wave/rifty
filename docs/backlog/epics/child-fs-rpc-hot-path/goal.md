---
kind: epic
status: draft
title: Child fs sync-RPC hot path — remove enumerated wire slowdowns, Node-strict freshness
created: 2026-08-26
value: Frequent guest fs ops from a kernel-spawned COI child stop paying avoidable double hops + JSON framing over the owner sync-RPC — vite build / CLI cold start move toward in-realm speed without any child-side cache.
user_story: As a dev running `vite build` or an express CLI in the product child, I want frequent `readFileSync`/stat over sync-RPC cheap, but today a small read costs TWO ~18 µs hops (statOrNull + readChunk) vs ~1 µs in-realm — the identical 2180-module build self-reports 1.63 s in the product vs 1.13 s in-realm (1.44×).
tier: robust
---

## Outcome

Guest fs hot path (small reads + stat/exists probes) over the owner sync-RPC
ring costs the enumerated minimum wire shape: one hop per small read, no JSON
encode/decode on the hot request path. No numeric multiplier target (user
decision 2026-08-26): the epic closes when the enumerated slowdowns are gone
and before/after numbers for both anchors are recorded. Strict Node freshness
throughout — every fs op observes the owner's latest committed state
(ADR-0150 owner-SSoT); no child-side content/stat cache, no RPC bypass.

## User scenario

Product playground (COI): spawn `vite build` of the 2180-module fixture in a
kernel-spawned child reading the owner store over sync-RPC; read vite's own
`built in Xs` self-report. Second anchor: cold start of an express server
(`require('express')` walk) in the same child shape, time to listening.
Both compared against the same guest source in a single in-realm worker.

## Invariants

<!-- Evidence, each false on main 1dcc59e00 (2026-08-26):
     I1 — sync-rpc-fs.ts:38 readFileBytesSync = statOrNull hop + readChunk
     hop(s); size sweep 0 B ≈ 18 µs (1 hop), 1 KiB ≈ 36 µs (2 hops) — spike
     branch t3code/prototype-no-coi-agent-cycle
     prototype/no-coi-agent-loop/FINDINGS.md §2b.
     I2 — fs requests are JSON-framed (sync-rpc.ts FRAME_JSON; binary frame
     carries only readChunk-style replies); JSON framing measured 3.1 µs of an
     18 µs hop (same §2b).
     I3 — no committed rig: spike harness is throwaway
     (prototype/ absent on main); numbers exist only on the spike branch. -->

- I1. A guest `readFileSync` of a file < `FS_RPC_CHUNK` completes in ONE
  sync-RPC round-trip (≈ cost of a bare `statSync`), not two.
- I2. Hot-path fs requests (stat/exists/read) cross the ring with no JSON
  encode/decode on the request side.
- I3. A committed perf lane measures both anchors (vite build 2180 modules,
  express cold require-walk) product-vs-in-realm on one rig; ledger records
  before/after for every landed slice.

## Decisions

- 2026-08-26 — fork A (anchors): vite build 2180-module + express cold
  require-walk; large-file (>256 KiB) O(N²) and guest install writes excluded
  (stay in `perf/fs-rpc-chunk-perf` / eddy epics) — user.
- 2026-08-26 — fork B (bar): no numeric multiplier; scope = remove enumerated
  obvious wire slowdowns, no new cache-like mechanisms; before/after recorded —
  user (verbatim: «убрать очевидные замедления без внедрения новых механизмов
  типа кэша»).
- 2026-08-26 — fork C (coherence): strict Node freshness; child-side
  cache/bypass excluded; escalation would be its own ADR + re-fit — user.
- 2026-08-26 — fork D (tier): robust — user.
- 2026-08-26 — fork E (CLI anchor): express — user.
- signoff: pending FIT (final invariant wording; forks + tier answered above).
