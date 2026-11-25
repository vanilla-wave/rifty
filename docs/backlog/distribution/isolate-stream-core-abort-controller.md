---
area: distribution
status: draft
title: The isolate guest's stream core gets Node's AbortController/AbortSignal from Node's sources, so Node's pipeline and helpers keep working
created: 2026-11-25
why: Node's pipeline creates an AbortController per call and passes its signal to function stages; AbortController/AbortSignal are ceiling globals in the isolate guest, and rifty's pipeline works there today
epic: node-streams-as-in-node
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/backlog/epics/node-streams-as-in-node/map.md]
---

## Context

Unit 7 of goal node-streams-as-in-node (map), ADR-0575 §6.

Why it is needed:
- `lib/internal/streams/pipeline.js:195` creates `new AbortController()` on every call;
- `operators.js:65,252` pass `{ signal }` to user functions;
- `web-shim.ts:355` lists `AbortController`/`AbortSignal`/`EventTarget`/`Event` as isolate ceilings;
- on the product build, the isolate gives `m7` 5/11 and `AbortController2 is not a constructor`
  (`results/route-b-product-programs.txt`).

The sources: Node's `internal/abort_controller.js` + `event_target.js` + `webidl.js`, about 31 KB min /
9 KB gzip (`results/route-b-size.txt`). They need stubs for `internalBinding('messaging')`, and the
`MessageChannel` transfer path becomes a named gap.

Globals: answered — recorded by the manager. `AbortController`, `AbortSignal`, `EventTarget` and
`Event` become ordinary isolate globals from these sources; the «private to the core» option is
dropped, and the former 7g (guest globals) is part of this unit. So `signal instanceof AbortSignal`
works, and the isolate `m9`/`m10` rows are this unit's (`results/ownership.txt`). In the isolate the
`EventTarget` is Node's own, so the browser-host abort-listener question
(`runtime-js/stream-core-abort-listeners-host-event-target`) does not apply here.

This unit comes before 8c: the isolate's pipeline rows need it, and `pipeline` works there today.

Shared with goal isolate-guest-web-api (its scope: `Blob`/`File`, `TextDecoder` encodings and these
globals). One owner delivers it; which goal: to be settled by the manager.

## Open findings (review round 4)

Carried verbatim from the manager's review of PR #450, round 4 (2026-11-25); owner = this unit. They close when the unit is taken into work, by its own contract and review.

- S1 (owner 7/8c): «isolate-строки: Node сам создаёт `AbortController` в `pipeline.js:195`, `duplexify.js:213`, `operators.js:252`, `:62`»; «правила isolate заданы по именам, а не из данных (S1: регулярка `/pipeline/` теряет m7 «async gen stage throws»; `w1` pipeline в isolate → `['9r']` вместо 7, 8c, 9r) — либо добавь колонку isolate маршрута B из продуктового прогона, либо запиши как известный предел». Round 4 recorded it as a known limit (`reference/ownership.mjs`).
- S4 (owner 7, P): «у 7 и P ноль строк, у P нет Acceptance».

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
