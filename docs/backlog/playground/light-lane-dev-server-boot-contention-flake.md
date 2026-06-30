---
area: playground
status: draft
title: chromium-light lane intermittently fails — dev server produces NO terminal output under parallel load (contention, "Pattern A")
created: 2026-07-01
why: pre-existing CI flake that reds the chromium-light lane (distinct from the now-fixed dev-server-ready marker rid-drop); blocks reliable green CI + gates raising light parallelism
user_story: As a rifty maintainer I want the chromium-light e2e lane to pass reliably, but intermittently a random spec's dev server produces NO terminal output at all (empty buffer) under the lane's parallel load, timing out the readiness poll
epic:
blocked_by: []
sources: []
code:
  - apps/playground/src/workers/real-vite-bootstrap.ts
  - apps/playground/src/workers/owner-child-dev-server.ts
  - playwright.config.ts
  - package.json # test:e2e:light worker count
---

## Context

CI-only, `chromium-light` lane. Intermittently a dev-server spec's terminal buffer stays EMPTY — serialized `·` / `> ` only, NO Vite banner, NO `starting dev server`, nothing — and the readiness poll times out. Accompanied by owner RPC timeouts (`[scm] read failed git owner RPC … timeout after 15000ms`) + SW `503`s: the owner is unresponsive for ~15s. A RANDOM set of specs fails each run (seen: m1/m7/owner-editor/owner-shell-prettier-eslint/owner-snapshot/scm-file-manager and pre-merge m2/m4/m0/terminal-persistence/vite7) → resource CONTENTION, not a per-test bug.

**DISTINCT from the dev-server-ready marker rid-drop** (that flake: Vite banner PRESENT, only the `[vite] dev server ready` line missing; fixed via `pty-client` trailingSink, CHANGELOG). THIS flake: NOTHING reaches the terminal (banner absent too) → the owner / dev-server never gets going under load.

**PRE-EXISTING — NOT a merge regression** (verified 2026-07-01): pre-merge PR#94 runs `28473349546` + `28473965157` (sharded) already failed the light lane with the IDENTICAL empty-`·` signature; the "green" pre-merge lights were lucky samples. Candidate merge commits ruled out (all measured / inspected benign): SCM git-status feed (`serveGitStatusFeed` → `publishOwnerState`; measured 13ms/test, 5×, debounced 200ms), `scm-file-manager.spec.ts` (the lone added spec; concurrency is `--workers`-bounded, not spec-count), `678aad3d` (sid threading), `3528fc7c` (optional `previewScope` field).

This is the backlog-predicted contention: "chromium-light `--workers` — more workers ⇒ more concurrent dev-server boots ⇒ higher flake rate" (see [[e2e-vite-readiness-flake]]). A GitHub runner (~2 cores / 7 GB) likely cannot reliably bring up ≥2 concurrent Vite-WASI dev servers (each = owner + dev-server child + Rolldown WASI pthread pool + optional LS).

## Open — needs the probe (draft until localized)

The marker probe ([DEBUG-mk]) showed **0 owner `emitChunk`** for these failures → the owner never emits dev output. Unknown: is the OWNER worker CPU-starved, or blocked on a sync barrier for 15s, or does the dev-server CHILD never boot? Localize WHERE the owner/boot stalls under forced contention — a CI run instrumented at the boot/owner-RPC seams, or a local repro by oversubscribing `--workers` ≫ cores (the marker rid-drop did not repro locally, but this one is resource-bound and may).

## Candidate fixes (decide after the probe)

- Cap `chromium-light` parallelism (`--workers` 2 or 1). Simplest; slows the long-pole lane. NOW UNBLOCKED — the marker flake that gated `--workers`/shard tuning is fixed.
- Shared dev-server boot fixture (one boot reused across specs) — backlog "P1 shared-boot fixture (high fidelity risk)".
- Make the owner survive contention — don't block/time-out for 15s; yield the thread.

## Out of scope

- The dev-server-ready marker rid-drop (separate, FIXED — `pty-client` trailingSink + `pty-client.test.ts` regression).
