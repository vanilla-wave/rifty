---
area: distribution
status: draft
title: A sandbox keeps one live isolate for an agent turn instead of a fresh isolate per `exec`
created: 2026-11-25
why: ADR-0568 runs every `exec` in a fresh isolate that restores the whole state, template included (template goal, user 2026-11-25); a live isolate per sandbox would pay the template once per turn — at the price of memory held by every open turn.
sources: [ADR-0568, ADR-0572, docs/backlog/distribution/reference/isolate-host-sandbox-lifecycle-probes/README.md, /Users/vanilla-wave/ai/rifty-requirements/2026-11-24-server-sandbox-requirements.md §3]
code: [packages/isolate-host/src/sandbox.ts, packages/isolate-host/src/pool.ts, packages/isolate-host/src/child/main.ts]
---

## Context

User, earlier: «Изолейты - быстрые короткоживущие(один ход агента) рантаймы. Но давай на цифры
посмотрим, мб передумаем»; 2026-11-25: «Как будто можно начать с самого простого и дальше
оптимизировать…» and «ок» to «слой шаблона и живой изолят уходят в backlog следующими ступенями»
(template goal Decisions). Today's lifecycle stays ADR-0568's: a fresh isolate per `exec`, the state
= bytes held by the consumer.

Ready material: `docs/backlog/distribution/reference/isolate-host-sandbox-lifecycle-probes/`
(PR #454; README = the comparison, no recommendation). Arms v1 (today), v1w
(pre-warmed spare), v1b (lazy template), v2s / v2bs (one isolate per sandbox, the FS in context A,
a fresh context per `exec` over a primitives-only boundary; template copied / lazy), v3 (FS in the
worker). Round 5–6 add the template goal's form: v1f (files in the state, fresh isolate per
`exec` — main) warm `exec` empty / pdf / docx / pptx / xlsx 198 / 383 / 353 / 481 / 642 ms; at
`memoryLimit` 256 rare capture refusals, 288 and 320 0 / 40; v2f (files in a live isolate) 8.8 /
157 / 138 / 276 / 354 ms, create 214–240 ms, idle RSS +247–268 MiB per sandbox; v2f with a restore
point empty / pdf / xlsx 94 / 250 / 450 ms against 9.6 / 168 / 366 without, plus 87.8 MB in the
consumer. A kill inside a `rename` of the live realm loses a file in every form with the FS inside
the isolate, once in 50–210 kills (v2s at the 209th, v2f at the 142nd of 600); v1 rolls back whole
runs. An out-of-memory run loses the whole sandbox without a restore point. The earlier arms use the layered
template of ADR-0572: macOS warm `exec` v1 → v2bs — empty 29.6 → 8.0 ms, pdf 210 → 159, docx 180 →
135, pptx 315 → 282, xlsx 459 → 355 (Linux arm64 VM: 41 → 10, 273 → 202, 219 → 170, 382 → 362,
573 → 464); first `exec` of a sandbox not reliably faster; v2bs memory grows with each open turn
(after GC 22–34 MiB after one generator, 55–74 after four; RSS +105–112 after four); its correctness
needs a restore point, a rebuild path and a guard against dead realms (§haunt); the boundary's
attack rows (§escape) 0 foreign objects for v2s/v2bs, not a proof.

Contract stability (template goal Decisions): this step cannot keep `exec`'s per-call
`memoryLimitMb` as it is — today it bounds that run's own fresh isolate (ADR-0568 §6); a live
isolate holds the sandbox's files and every run under one limit fixed at its creation
(isolated-vm); and «an idle sandbox holds no process or isolate» (live-sandbox I6, ADR-0568 §2)
cannot hold — a live isolate is held between runs by definition. User forks for this step, before
its contract.

## Question

Strategy — owner: user — open, deferred «until real load» (the manager's words, 2026-11-25): is an isolate a runtime for one agent turn
(a live isolate per sandbox) or for one `node` run (a fresh isolate per `exec`, today)? Trigger:
whichever hurts the consumer first — `exec` latency (this item, or the template layer
`distribution/isolate-host-sandbox-template-layer`, which also cuts it) or memory held by open
turns (stays with fresh isolates). The template goal's README cost table is the baseline to compare
against.

Owner: distribution (isolate host).

## Challenge

challenge: 2026-11-25 — none yet (user-deferred capture)
