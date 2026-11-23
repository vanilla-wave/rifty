---
area: runtime-js
status: draft
title: Timer callbacks run with `this` other than the Timeout handle
created: 2026-11-18
why: Node calls a setTimeout/setInterval callback with `this` = its Timeout, so `clearInterval(this)` stops the interval; rifty passes another object.
sources: [docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/builtins/timers.ts]
---

## Context

`node -e "let n=0; setInterval(function(){ n++; console.log(this.constructor.name); clearInterval(this); if(n>2) process.exit(3) }, 1)"`
→ `Timeout`, status 0. Isolate host (ADR-0557) → `Object` ×3, status 3: the
interval is not cleared. Found by the isolate-host Final+GREEN review; the
`KeepaliveTimerHandle` wrapper owns the call (`Object.fn` frame), so the browser
path likely shares it — reproduce there.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
