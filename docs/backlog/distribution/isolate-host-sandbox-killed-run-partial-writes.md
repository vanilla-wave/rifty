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

## Challenge

challenge: 2026-11-23 — none yet (factual capture at the isolate-host-live-sandbox CLOSE)
