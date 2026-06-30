---
area: playground
status: draft
title: dev-server-ready marker intermittently never reaches the terminal (CI flake)
created: 2026-06-30
why: dominant CI e2e flake — inflates wall-clock (retry tax), occasionally reddens, and gates raising chromium-light --workers
user_story: As a rifty user running a dev server, I want its "[vite] dev server ready" line to reliably appear in the terminal, but intermittently (under load) it — and the preceding rifty log lines — never show, even though Vite's own banner does
epic:
blocked_by: []
sources: []
code:
  - apps/playground/src/workers/dev-server-boot.ts
  - apps/playground/src/workers/owner-child-dev-server.ts
  - apps/playground/src/workers/dev-server-child-bootstrap.ts
  - apps/playground/src/glue/pty-client.ts
  - apps/playground/src/adapters/terminal-manager.ts
  - apps/playground/src/components/TerminalPanel.tsx
---

## Context

CI-only e2e flake, NOT reproducible locally. The rifty readiness marker `[vite] dev server ready on port 5174` (dev-server-boot.ts:339) intermittently never lands in the terminal buffer the test polls → `expect.poll` timeout (30–60s). Retry-masked (CI ×2) so runs stay green, but it inflates wall-clock (a lane jumps from ~3m to ~7m when hit) and occasionally exhausts retries → red. Affected specs: `ts-language-service.spec.ts:551`, `m7-preview-sw.spec.ts:95`, `owner-editor-write-exec-read.spec.ts:38`, `m1-terminal-shell.spec.ts:42` (every terminal-buffer readiness assertion).

**Hard CI evidence (3 matrix runs, 2026-06-30):** the failing buffer is always SHORT —
`"·\n>··\n>··\n  VITE v7.3.6  ready in N ms\n> "`. Vite's OWN banner is present, but BOTH rifty stdout lines emitted right after it (`[real-vite/worker] vite is listening` :336 and the marker :339) are ABSENT. Same `proc.stdout` stream, in order [banner → 336 → 339] → **the final rifty writes never reach xterm.**

**Ruled out:**
- xterm async write→serialize race (snapshot before parse). A REAL such race exists (deterministic experiment + RED-checked unit test), fixed via `RiftyTerminal.snapshotBufferSettled` (commit b0bb7565) — but the CI flake PERSISTED unchanged. So that fix is orthogonal correctness only, NOT this bug.
- "owner stops draining child stdout on `rifty:dev-ready`" — DISPROVEN by code: `outputClosed` (owner-child-dev-server.ts:149) flips only in `stop()`, not on dev-ready; the stdout listener stays attached.
- terminal-buffer mirror debounce starvation (prior `createBufferRefreshScheduler` maxWait fix) — flake persisted.

**Live hypotheses (need the probe to disambiguate):**
1. Transport-drop: the 336/339 chunks are dropped somewhere on `proc.stdout` → IPC → owner `handle.stdout()` → `writeLog` → `opts.log` → `ctx.stdout.write` → pty:chunk → page → `terminal-manager.write` → `term.write`.
2. Vite `clearScreen` (its default) emits a clear between the banner and the rifty lines, wiping them from the serialized buffer.

**Defined first step (the probe — all 7 prior diagnostic cycles routed through the terminal, the suspected layer, so were invisible):** instrument the PAGE side (`pty-client.onFrame` pty:chunk receiver + `terminal-manager.write` + `TerminalPanel.attach`) with tagged `console.warn('[DEBUG-marker] …')` (captured by Playwright trace, unlike worker/terminal output), and change `.github/workflows/ci.yml` artifact upload from `if: failure()` to `if: always()` (today a flaky-but-green job uploads nothing). One flaky run's trace then shows whether the marker chunk reaches the page and `term.write`, localizing hypothesis 1 vs 2.

**Wall-clock cost is large and gates further parallelization.** Each flaked test burns its full readiness-poll timeout (30–90s) × 2 CI retries before recovering — minutes per flaky test. This dominates e2e wall-clock variance. It gates BOTH remaining speedup levers, because each only redistributes (not removes) the flake:
- **chromium-light --workers** — more workers ⇒ more concurrent dev-server boots on one runner ⇒ higher flake rate.
- **Sharding the light lane** — measured net-negative (2026-06-30): the flaky dev-server specs cluster into one shard, whose retries inflate it to ~9.8m (worse than the ~6.7–8m whole lane), since a 29-test shard amortizes the fixed per-flake timeout cost over fewer tests. Reverted.

So FIX THIS FIRST; only then do shard/--workers pay off. (The verified matrix lane-split speedup is unaffected — it doesn't concentrate the flake.) See [[e2e-vite-readiness-flake]] memory.

<!-- draft: root mechanism not yet localized (open decision below). The probe above is the defined path to `ready`. -->

## Acceptance

- The four affected specs run non-flaky (zero retries consumed on the readiness wait) across ≥3 consecutive CI runs.
- A DETERMINISTIC regression test at the localized seam, RED-checked (revert the fix → it fails), exercising the real failure pattern (marker is the final stdout line, emitted under the same conditions). If the only seam is too shallow to replicate the real chain, that is itself recorded.
- Raising the readiness-poll timeout is NOT an acceptable fix (masks, doesn't fix).

## Parity cases

- A child process's stdout lines reach the consuming terminal in emission order with no drop — specifically, a line written immediately after Vite's banner appears in the terminal buffer just as the equivalent real-Node child's stdout line would (no silent drop, no reorder relative to the preceding banner).

## Out of scope

- Changing the marker string or the readiness contract (the e2e suite + UI depend on it).
- The separate `m1-terminal-shell.spec.ts:113 "tabs switch between their own buffers"` flake (short-buffer symptom too, likely same transport family but distinct trigger) — track separately if it recurs.
- The orthogonal `snapshotBufferSettled` mirror-correctness fix (already landed, commit b0bb7565) — not part of closing this.

## Decisions

- OPEN: the exact mechanism (transport-drop vs Vite clearScreen vs other) — to be localized by the page-console trace probe FIRST; the fix follows the finding. (This is why the item is `draft`, not `ready`.)
- The probe instrumentation is temporary `[DEBUG-…]`-tagged and removed before merge; the `if: always()` artifact upload may stay (cheap, aids future flake triage).
