---
area: runtime-js
status: draft
title: "`clearTimeout` of a string id or a plain object with `_onTimeout` acts as Node's"
created: 2026-11-23
why: "`clearTimeout(String(id))` stops the timer but keeps `_onTimeout` and the run ends with no natural exit; a plain object's truthy `_onTimeout` is left as is. Node nulls `_onTimeout` in both and exits 0"
sources: [docs/backlog/runtime-js/reference/pr-425-final-green.json]
code: [packages/runtime-js/src/builtins/timers.ts]
---

## Context

Found by the PR #425 Final review (round 2), present on main 23ed6b445. Node
v24.16.0 `lib/timers.js` clearTimeout: `if (timer?._onTimeout) {
timer._onTimeout = null; unenroll(timer); return; }`, then for a `number` or
`string`, `knownTimersById[timer]` is nulled and unenrolled. rifty's
`clearTimer` follows this for a `Timeout` handle and a numeric id only: a
string id goes to the host clear (the callback does not run, `_onTimeout`
stays, the isolate run ends with `exitCode` null), a plain object with a
truthy `_onTimeout` is passed to the host clear unchanged. Compat: process.md
"`clearTimeout` / `clearInterval` of a string id or a plain object".

Owner: runtime-js (timers). Trigger: a package clearing timers by string id
(ids read back from storage or a message), or the next change to `clearTimer`.

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
