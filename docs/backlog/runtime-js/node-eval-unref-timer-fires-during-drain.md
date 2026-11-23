---
area: runtime-js
status: draft
title: node -e unref'd timer fires while the drain confirms the loop is idle
created: 2026-11-18
why: Node exits as soon as only unref'd handles remain; rifty's drain keeps the realm alive a few ms and runs them.
sources: [docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/builtins/timers.ts]
---

## Context

Sandbox (ADR-0568): a member of the lifecycle class, compat ⚠️ (row "A run's lifecycle and exit status", measured in `reference/isolate-host-sandbox-lifecycle-class.md`). Owner: runtime-js. Trigger: the next change to the drain's idleness check, or a sandbox consumer finding files from an `unref()`'d timer.

Node v24.16.0: `node -e "setInterval(() => console.log('fired'), 1).unref()"` → no
output, status 0. Isolate host (ADR-0557) prints `fired` 2–3 times (10/10
runs @ 09337abe3); `setTimeout(f, 5).unref()` no longer fires there. Found by
the isolate-host Final+GREEN review; the drain's macrotask idle confirmation is
the owner.
`docs/public/compat/process.md` claims `unref` ✅. Reproduce on the browser
`node -e` path to scope it.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
