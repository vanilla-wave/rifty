# ADR 0200: Persistent ESM transform cache across dev-server child boots

Status: Rejected — refuted by measurement (2026-07-07)
Date: 2026-07

> TL;DR: an OPFS-backed cross-boot `transformEsm` cache was built, wired into every loader realm, PROVEN to hit (15/16 entries on a reload boot) — and produced ZERO end-to-end win (interleaved A/B, 8+8 reload boots: warm median 2705 ms vs cold 2712 ms). Do not re-propose without new evidence; closes Q-2026-05-30-202 as won't-do.

## Context

`esmAstCache` (acorn parse+rewrite) is per loader instance; a fresh loader per
dev-server child boot re-parses the vite dist. Unit-level cost is real: 2.8 MB
of vite dist = 263 ms of `transformEsm` in node V8, ~0 ms cached. The
hypothesis (Q-2026-05-30-202, backlog runtime-js/persistent-esm-transform-cache)
was that a persistent content-validated store repays 0.5–1.5 s per boot.

## What was built (and reverted)

Loader hook `persistentEsmTransformCache` (sync get/put, loader-side exact
source-equality validation), lazy-fill OPFS JSON store (format-versioned,
corrupt/oversized/torn → discard + one warn; write-fail → disable + warn),
wired in the dev-server child, node-entry child, owner bin executor; fault
tests for every axis. Mechanically CORRECT: the store round-tripped (v1.json,
4.1 MB, 15 vite-dist entries) and a reload boot HIT 15/16 entries.

## Why rejected

- **Interleaved A/B on the real path** (typescript-ls preset, warm profile,
  8 warm-store vs 8 wiped-store reload boots, same context): warm median
  2705 ms / mean 2715 vs cold median 2712 / mean 2705 — Δ ≈ 0. The acorn
  parse of vite 7's dist (15 LARGE bundled chunks) is not a material serial
  cost of an in-browser boot.
- **The other dependency graphs don't qualify:** express/koa/hono-class server
  deps are CJS — `transformEsm` never runs for them (a full express-sqlite
  boot produced zero cacheable entries).
- Cost side was fine (lazy-fill ≈ 0 added latency) — but a cache with a
  measured zero win is speculative complexity, against Fidelity.

## Consequences

- Backlog item runtime-js/persistent-esm-transform-cache deleted (closed by
  refutation); Q-2026-05-30-202 resolved as won't-do.
- Re-proposal bar: demonstrate an ESM dependency graph whose `transformEsm`
  time is a measured serial component of a user-visible boot (e.g. a future
  many-small-ESM-module preset), not a unit-level parse number.
- Kept from this investigation: the bench `viteReadyMs` stage marker fix
  (rifty-authored ready line died in PR #109; the marker is now real vite's
  own ready banner).
