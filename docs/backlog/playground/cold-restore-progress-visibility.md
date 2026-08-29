---
area: playground
status: draft
title: Cold snapshot restore progress visibility — «restoring project dependencies…» wiring lost in PR #167
created: 2026-08-29
why: PR #167 (merge 7828b058, claimed mechanical/behavior-preserving) dropped the only prod wiring of the restore progress line; cold 3.2–18MB gz snapshot restore now runs with zero terminal feedback and the loss was never recorded in CHANGELOG/backlog.
user_story: As a developer opening the playground on a cold cache or slow network, I want visible progress while project dependencies restore, but today the terminal shows nothing until the restore finishes.
sources: [PR #167 (merge 7828b058), commit 682ec23e4 (progress line), commit 246a40e25 (per-run deps gate), tests/browser-unit/owner-shell-routing.spec.ts:247 (assert flipped to not.toContain in the same PR)]
code: [packages/workbench/src/workers/pty-server.ts, apps/playground/src/glue/slow-progress.ts, apps/playground/src/adapters/playground-app.tsx, tests/browser-unit/owner-shell-routing.spec.ts]
---

## Context

Baseline (built by 682ec23e4 + 246a40e25): per-run `beforeRun` deps gate in
pty-server; when snapshot restore overlapped a run >250ms, the run's stdout
streamed a grey `restoring project dependencies…` line; e2e pinned
`expect(ls.out).toContain('restoring project dependencies')`.

PR #167 «refactor: mechanically extract sealed workbench» removed the only prod
wiring — `beforeRun: (emit) => withSlowProgress(devConfigReady, { onSlow: () =>
emit('\x1b[90mrestoring project dependencies…\x1b[0m\r\n', 'stdout') })` in
`apps/playground/src/workers/real-vite-bootstrap.ts` (file since deleted) — and
flipped the e2e assert to `not.toContain` (owner-shell-routing.spec.ts:247, new
rationale comment: sealed companion publishes the project only after a valid
snapshot restore, so no pre-session progress is relabelled as later command
output). No CHANGELOG/backlog record of the observable loss.

Today on main:

- the string exists only in tests + CHANGELOG; no prod source emits it;
- `pty-server.ts` `beforeRun` dep (line 148, consumed line 412) has zero prod
  callers — tests only;
- `slow-progress.ts` terminal path is gone; one live use remains: launcher
  instant-prepare label (`playground-app.tsx:680` → `Launcher.tsx:99`, >250ms,
  launcher transitions only), plus a SWITCHING pill during transitions;
- cold restore payloads: vite 3.2MB, typescript 10.3MB, vite8 18MB gz
  (`apps/playground/public/snapshots/`).

Sizing (challenge-verified): first visit necessarily enters the launcher, so
the dominant cold path shows the spinner; direct reload into a persisted
project skips the snapshot fetch when the slug-keyed OPFS stamp holds
(`project-deps.ts` priority 1). Truly silent restore paths are the residual
ones: reload where the localStorage catalog survived but the OPFS stamp was
evicted, and a closed-launcher deep-link into an unstamped starter — frequency
not established.

Architectural note: publish-after-restore means a command can no longer overlap
a restore, so the exact pre-#167 observable (grey line mid-run, gated echo) is
not reproducible without re-opening pre-publish sessions — restoring visibility
requires choosing a new observable shape. Active-baseline change ⇒ user-owned
fork; resolved in refine 2026-08-29, see `## Decisions`.

## Challenge

challenge: 2026-08-29 — 3 problems
1. Impact oversized: the headline scenario ("developer opening the playground on cold cache… terminal shows nothing") already has visible feedback — first visit necessarily enters via the launcher, where the surviving `withSlowProgress` wiring (playground-app.tsx:680) shows a "Preparing instant project" spinner (Launcher.tsx:99-111) and transitions show a SWITCHING pill; "zero feedback" holds only for the narrow residual paths, unsized in the doc.
2. The 3.2–18MB "slow network = seconds of dead terminal" evidence attaches to the covered path: project-deps.ts priority 1 (slug-keyed OPFS stamp) makes direct reload into a persisted project skip the snapshot fetch entirely, so the truly silent paths (localStorage catalog survives while OPFS stamp gone; closed-launcher deep-link into unstamped starter) pay the cost only in an eviction-divergence scenario the doc gives no occurrence evidence for.
3. Framing/fork padding: by the draft's own architectural note no terminal session exists during restore post-#167, so "silent terminal" (title, `terminal/` area) misnames a pre-session boot-feedback/UI gap, and fork option "exact pre-#167 per-run gate semantics" re-opens the landed sealed-companion decision the same paragraph admits it contradicts — a dead option inflating the refine.

## Decisions

- refine 2026-08-29 (user-owned, active-baseline fork): contract = **visibility,
  not a pinned line** — every path where a snapshot restore actually runs
  >250ms shows visible progress, including the residual paths (stamp-evicted
  reload with surviving catalog; closed-launcher deep-link into unstamped
  starter). Carrier per path is agent-owned (launcher spinner where open;
  terminal boot line or equivalent where not). Publish-after-restore stands —
  no re-open of the sealed-companion decision.
- Declined in the same interview: pinning the grey terminal line as the e2e
  contract; accepting the loss with a record only.
- Loss record: this item is the record of the #167 observable loss; CHANGELOG
  line rides the implementing PR.
- Carrier cleanup rides the implementing unit: dead `beforeRun` prod param
  (pty-server) and the orphaned slow-progress terminal path are re-wired or
  removed by the chosen carrier, never left as dead machinery.
- On restore failure the indicator yields to the existing error surface — no
  new fault machinery in this item.
