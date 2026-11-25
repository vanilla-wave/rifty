---
area: distribution
status: draft
title: A killed sandbox run keeps the writes it made before the kill, as Node does
created: 2026-11-23
why: A run ended by `timeout` or `memory` (or a lost worker) rolls the sandbox back to its files of before the run (ADR-0568 §3, compat ⚠️); `node` keeps every write made before the kill.
sources: [ADR-0568, docs/public/compat/isolate-host.md, PR-419-external-review]
code: [packages/isolate-host/src/sandbox.ts, packages/isolate-host/src/child/main.ts]
---

## Context

The end state is captured in the guest's realm after the run returns; a killed
isolate cannot be captured, so the sandbox keeps the state of before (whole-run
rollback, never a partial tree). Node's behavior needs the writes to survive the
isolate: a journal of the run's FS operations streamed to the worker, or a
capture taken by the worker from outside the isolate. Both are a wire and trust
change (the bytes stay guest-authored, ADR-0568 §7). A model that loops forever
after writing its output loses that output today.

Owner: distribution (isolate host). Trigger: a consumer needing a killed run's output (a model that loops after writing it), or a worker-side capture becoming available.

Measured route (template goal, 2026-11-24, ADR-0572 §Forks F1 (c);
`reference/isolate-host-sandbox-template-probes/` arm `worker`): the worker owns the run's whole
FS, every guest `fs` call is one sync host call, so a killed isolate leaves its writes in the
worker — keepable (a lost worker still loses them). Its costs: ~11 FS operations exposed to the guest (one dispatcher function in the probe) with
guest-chosen paths and bytes, chunked I/O on the agent's files quadratic across the bridge until
`FsSync` gains ranged operations (8 MiB: 259 vs 64 ms, 541 MB copied), the state cap moving to the
write (`ENOSPC`), an amendment of the live-sandbox Outcome «The files stay rifty's in-memory
filesystem in the guest's own realm».

## Decisions

- 2026-11-25 — user (asked F4 «записи убитого прогона: сохранять как Node или откат + текст инструмента», scenario «генератор записал `out.pptx` и завис → `timeout` → `out.pptx` пропадает»): «Давай запишем бэклок, но пока делать не будем. И оставим как есть. Я понимаю, что сейчас файлы исчезнут?» (the agent's answer: «Да, сейчас файлы такого прогона исчезают. Если прогон убит (`timeout`, память, отмена), песочница возвращается к состоянию до этого прогона. Пропадает всё, что он успел записать, `out.pptx` тоже. Файлы прошлых прогонов остаются.») — rollback stays (ADR-0568 §3, compat ⚠️); `run_node` says the run's writes were rolled back (`epics/isolate-host-agent-tools`); this item stays draft, its trigger unchanged.

## Challenge

challenge: 2026-11-23 — none yet (factual capture, live-sandbox goal, ADR-0568)
