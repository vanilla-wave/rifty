---
area: runtime-js
status: draft
title: "A timer handle's `refresh()` re-arms it with its delay as in Node"
created: 2026-11-22
why: rifty's `setTimeout`/`setInterval` handle has no `refresh`; calling it throws `TypeError: t.refresh is not a function`, Node restarts the timer
sources: [PR-421-external-review-round-1]
code: [packages/runtime-js/src/builtins/timers.ts]
---

## Context

Found by the PR #421 external review (round 1), outside goal
`node-file-entry-parity`. Reproduced by this capture:

```
$ node -e 'const t=setTimeout(()=>console.log("fired", Date.now()-s>=40),30);const s=Date.now();console.log(typeof t.refresh, t.refresh()===t);setTimeout(()=>t.refresh(),20)'
function true
fired true                                   # v24.16.0
runCode('const t = setTimeout(() => {}, 1); t.refresh()')   # isolate-host dist, 2026-11-22 21:14
→ exit 1, stderr "TypeError: t.refresh is not a function\n    at [eval]:1:38\n\nNode.js v24.0.0"
```

The handle class in `timers.ts` has `ref`/`unref`/`hasRef`/`Symbol.toPrimitive`,
no `refresh` — shared runtime code, so every host lacks it (browser hosts read,
not run). Not a loud named gap: an absent member (`typeof t.refresh` is
`undefined`), no compat row (process.md lists `.unref()/.ref()/.hasRef()` ✅).
Debounce/idle-timeout code (`socket.setTimeout`-style helpers, keep-alive
timers) calls it. Fault class: missing surface without a loud throw.

## Acceptance

1. Parity (parity-runner + isolate corpus): `refresh()` returns the handle
   and restarts a pending `setTimeout`'s delay from the call (measured above).
   Open fork, measure on Node at pickup: `setInterval`, a fired or cleared
   handle, an unref'd handle's ref state. → scenario

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
