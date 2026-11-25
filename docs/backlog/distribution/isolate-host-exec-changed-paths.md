---
area: distribution
status: draft
title: A sandbox `exec` reports the paths its run created, changed or deleted, with their sizes
created: 2026-11-25
why: `ExecResult` is `RunCodeResult` + `stateRefused` — the host cannot tell what to publish and the model what came out without guessing a path or walking `list` (requirements «Найдено дополнительно»).
sources: [/Users/vanilla-wave/ai/rifty-requirements/2026-11-24-server-sandbox-requirements.md «Найдено дополнительно», docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/README.md]
code: [packages/isolate-host/src/sandbox.ts]
---

## Context

Requirements «Найдено дополнительно»: «`exec` (или `sandbox.changes()`) возвращает пути и размеры,
изменённые прогоном, включая удаления». Carried by the template layer draft (its I6, probe S: the
list compared with a walk of live Node's tree before and after the same run); left out of the
template goal's simple form (template goal, closed by PR #460, 2026-11-25: not in requirements §1, independent of the
template). User, 2026-11-25: «в бэклог» to the manager's «Список изменённых путей в результате exec: в этой
цели или в backlog?». Consumer: `epics/isolate-host-agent-tools` (`run_node`'s text names the changed files).

Today a run's end state replaces the consumer's FS whole (ADR-0568 §3), so the list is a diff of the
old and new FS in the consumer — a change is kind or bytes differing (times alone are not), a
deleted directory once.

Owner: distribution (isolate host). Trigger: `epics/isolate-host-agent-tools` FIT, or a consumer
asking for it.

## Challenge

challenge: 2026-11-25 — none yet (capture)
