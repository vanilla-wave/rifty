---
area: runtime-js
status: draft
title: setTimeout/setInterval accept a non-function callback instead of Node's ERR_INVALID_ARG_TYPE
created: 2026-11-18
why: Node validates the callback before anything else; rifty's timer builtin boxes the callback into its own function first, so a non-function never throws and a BigInt delay's TypeError wins.
sources: [docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/builtins/timers.ts]
---

## Context

Isolate host (ADR-0557) @ 454d20504 against `node -e` v24.16.0:
`for (const args of [[5, 1n], [5, 1], [undefined]]) { try { setTimeout(...args) } catch (e) { console.log(e.name, e.code, e.message.split('.')[0]) } }`
→ Node prints `TypeError ERR_INVALID_ARG_TYPE The "callback" argument must be of type function`
three times; host prints `TypeError undefined Cannot mix BigInt and other types, use explicit conversions`
once (`setTimeout(5, 1)` and `setTimeout(undefined)` do not throw). The shim's
own callback check never sees the guest's value: `timers.ts` wraps it in a box
function (self-ref timeout pattern) first. Shared with the browser realms
(unprobed there). Found by the PR #405 landing verify.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
