---
area: runtime-js
status: draft
title: node:stream runs Node v24.16.0's generated stream core: wired, internal consumers moved, the hand-written core removed
created: 2026-11-25
why: rifty's hand-written stream core differs from Node on every lifecycle, member, Transform and pipeline row measured (m1 0/14, hook matrix 10/76, zlib-diff 26/45); Node's own files over the same modules equal Node there (route B)
epic: node-streams-as-in-node
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/backlog/epics/node-streams-as-in-node/reference/results/summary.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-zlib-diff.txt]
---

## Context

Unit 8c «Core wiring» of goal node-streams-as-in-node (map item 8c, ADR-0575 §7). Stands on 8a, 8b, the
bindings 1–2, AL (`runtime-js/stream-core-abort-listeners-host-event-target`) and 7 (the isolate's pipeline rows; `results/ownership.txt`).

Scope:
- wire the generated core into `@riftydev/io` and `node:stream`;
- move the internal consumers: `ServerResponse.write` → `false` + `'drain'`; the stream shape that
  `finished(req.socket)` needs; io's `onDestroy`;
- remove the hand-written `packages/io/src/streams`, its unit tests and ADR-0353's callable
  constructors.

Acceptance:
- 8b's rows stay green;
- plain-stream rows of `m1`–`m3`, `m6`–`m8` and the hook matrix = Node in the isolate and Chromium;
- parity `cases/stream` 66/66 and each absorbed draft's repro (map §Absorption, 21 drafts);
- `check:es-floor` lists extended with `AbortSignal.any`, `Symbol.dispose`/`asyncDispose` and
  `Promise.withResolvers`, and/or the Chromium 108 lane on those rows;
- identifier renaming changes 1 of 105 parity cases run (5 more skipped on both builds:
  stdin/eval/esm kinds; `results/route-b-minify.txt`): `stream/from-web-options`, whose V8 `TypeError`
  text names Node's `signal` inside `abort_listener` (variant A). The Workbench consumer bundle renames,
  so 8c either keeps identifiers in the module there or declares the row; a guard row runs
  `from-web-options` on that bundle. AL's variant can change this.

- the bundle caps: if `pnpm test:client-bundles` crosses a cap, the PR recomputes it by
  `tools/checks/client-bundle-budget.mjs`'s rule (cleaned size × 1.5, rounded up to 1000 B), with the new
  measurement and its cause in that file, and publishes the breakdown of the growth; the cap is not a
  stop condition (map §Open questions, the caps).

zlib unit 3 starts after this unit.

Row to close (PR #462 review N4): `new Readable({ encoding: 'UTF-8' }).readableEncoding` — Node keeps the option
value (`'UTF-8'`, `'Binary'`; also Duplex/Transform), rifty normalises (`utf8`): `callable-constructor.ts`
routes the option through `setEncoding`. Node's `ReadableState` sets `encoding = options.encoding`.

## Open findings (review round 4)

Carried verbatim from the manager's review of PR #450, round 4 (2026-11-25); owner = this unit. They close when the unit is taken into work, by its own contract and review.

- S1 (owner 7/8c): «isolate-строки: Node сам создаёт `AbortController` в `pipeline.js:195`, `duplexify.js:213`, `operators.js:252`, `:62`»; «правила isolate заданы по именам, а не из данных (S1: регулярка `/pipeline/` теряет m7 «async gen stage throws»; `w1` pipeline в isolate → `['9r']` вместо 7, 8c, 9r) — либо добавь колонку isolate маршрута B из продуктового прогона, либо запиши как известный предел». Round 4 recorded it as a known limit (`reference/ownership.mjs`).
  Unit 7's share (PR #472): its isolate rows `m7`/`m9`/`m10` measured on rifty's current stream and pinned (`packages/isolate-host/tests/abort-event-target.test.ts`); `m7` 0/11, `m9` 3/5, `m10` rows 1 and 3 are this unit's (8c); the route-B isolate column and `w1` stay open here.
- S7 (owner 8c): «isolate-строки 8c in-process дифференциалом не прогнать; 8c не упоминает свои m9-строки».
- B5 (owner 8c): «в окнах исход меняется на 6 строках (окно 8c: `c-unzip-stored`, `c-pipeline-asyncgen`, m4 `Readable.from(fs.ReadStream)`, `w1` `promises.pipeline`; …). Формула: «закреплены на исходе своего окна (колонка окна), изменения относительно сегодняшнего перечислены и объявлены»».

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
