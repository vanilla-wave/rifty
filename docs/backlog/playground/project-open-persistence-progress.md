---
area: playground
status: draft
title: Show real persistence progress during first project opening
created: 2026-09-10
why: first opening a heavy snapshot project exposes only a delayed preparing spinner although the owner already reports actual persistence progress
user_story: As a developer opening a heavy Vite starter for the first time, I want to see that browser persistence is advancing instead of wondering whether project preparation has stopped.
sources: [docs/adr/playground/0359-durability-drain-progress-as-a-health-event-kind-on-the-workbench-owner-port.md, docs/backlog/playground/reference/fs-dirty-stamp-findings-disposition.md]
code: [packages/workbench/src/workers/workbench-owner-runtime.ts, packages/workbench/src/workbench/open-workbench.ts, packages/workbench/src/workbench/health.ts, apps/playground/src/adapters/playground-app.tsx, apps/playground/src/components/Launcher.tsx]
---

## Context

The owner forwards real `{persisted,total}` operation counts before a project
token exists. `open-workbench.ts:271` discards that health event; the public
health snapshot carries issues only. Playground's first-open UI currently shows
a delayed `Preparing instant project` spinner, not the actual drain counts.
This is an observed API/UI gap, not a claim that all feedback is absent.

## User scenario

Choose a heavy snapshot starter. While its first opening waits for persistence,
the public route used by Playground exposes genuine progress and the UI shows
that saving is advancing. The indication ends with the real operation result;
it must not present a completed flush as a completed whole open while more work
remains. No fictitious time estimate or whole-open percentage.

## Boundaries

- Reuse real producer evidence. Counts are persistence operations, not file or
  byte counts; presentation must not relabel them. Unknown phases stay honest.
- Observe before the first project session exists; bind display lifetime to the
  corresponding open so previous/background work does not appear as its progress.
- Preserve terminal stdout/stderr, current snapshot commit/durability/recovery
  guarantees, and existing operation-failure behavior. No automatic retry or
  new cancel/recovery policy is requested.
- This delivers observability, not a latency reduction promise. The user explicitly
  left profiling and optimization to separate work; no performance task is added
  or changed in this refinement.

## Decisions

- 2026-09-10 — pickup: ADR-0413; owner existing opId/health stream reuse; no new coordination mechanism.

- 2026-09-10 — user: «Да, оформить прогресс (рекомендую)» to the explicit separate visible-first-open-progress question; raw source in `reference/fs-dirty-stamp-findings-disposition.md`.
- 2026-09-10 — user: «ничего не нужно, со скоростью отдельно разберемся(вроде даже есть ПР с планом)»; latency investigation/optimization excluded, progress remains selected.
- 2026-09-10 — exact public API and UI carrier are agent-owned; ADR-0359's owner-port-only reach requires the appropriate DEC-2 revision before implementation. No separate progress coordinator is prescribed.

## Challenge

challenge: 2026-09-10 — clear; selected observability outcome reused; DEC-2 alternatives in ADR-0413.

2026-09-10 — fresh read-only `/root/audit_refine_frontier`:

> Public SDK явно отбрасывает их: `open-workbench.ts:271`. ADR-0359 прямо выбирает owner-port-only.

> Playground показывает лишь отложенный spinner «Preparing instant project»: `playground-app.tsx:677`, `Launcher.tsx:99`. Утверждение «вообще нет feedback» устарело; численного drain progress действительно нет.

This is a newly chosen observable surface, not a mechanical regression repair.
Probe UI/public reach and counters at pickup; old drain timings are not its RED.

## Acceptance

1. Public Workbench health and Playground show real persistence operation counts before a first snapshot project has a session; source files actually persist. → scenario
2. Unknown phases remain preparing; one completed drain never means a completed open. The display clears on the actual success/failure/close. → scenario
3. Background/previous operation progress is excluded using the existing open lifetime; stdout/stderr, snapshot commit and recovery retain their baseline. → scenario

## Fault matrix

- observable-order × first open | real pre-session counts, then settled result | `public-project-open-progress.spec.ts` → scenario
- concurrent-same-key × old/background drain | no progress attributed to a different open | owner opId + public lifecycle regression → scenario
- quota-perm-fail / peer death × open | existing rejection; progress clears, no successful-open indication | public lifecycle regression + existing snapshot failure suites → scenario

## Out of scope

Latency profiling/optimization; synthetic percentages/ETA; new recovery policy.
Unsupported storage/runtime capabilities retain loud failures.
