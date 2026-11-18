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

Node v24.16.0: `node -e "setTimeout(() => console.log('fired'), 5).unref()"` → no
output, status 0. Isolate host (ADR-0557) prints `fired`;
`setInterval(…, 1).unref()` fires several times before exit. Found by the
isolate-host Final+GREEN review; the no-settle mutant fires too, so the drain's
macrotask idle confirmation is the owner, plus the isolate host's settle turns.
`docs/public/compat/process.md` claims `unref` ✅. Reproduce on the browser
`node -e` path to scope it.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
