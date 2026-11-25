---
area: runtime-js
status: draft
title: Node's stream core attaches its abort listeners to a host EventTarget, which ignores Node's kResistStopPropagation and kWeakHandler
created: 2026-11-25
why: a guest abort listener that stops propagation hides the abort from pipeline/finished/addAbortSignal (m9), and reduce/map listeners are not weak on a host EventTarget; the derived-signal fix of round 3 reorders listeners against Node (m10) and was recalled
epic: node-streams-as-in-node
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/backlog/epics/node-streams-as-in-node/reference/results/abort-variants/m9-abort-stop-propagation.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/abort-variants/m10-abort-order-leak.txt]
---

## Context

Unit «abort-слушатели ядра Node на хостовом `EventTarget`» of goal node-streams-as-in-node (map).
Node's core attaches abort listeners with `kResistStopPropagation` (`internal/events/abort_listener`)
and, in `operators.js:62,252` (`map`, `reduce`), with `kWeakHandler`. Node's own `EventTarget` honours
both; a host `EventTarget` (browser hosts) does not. In the isolate the `EventTarget` is Node's own
(unit 7), so the problem is the browser hosts' only. The root is one: Node's core expects Node's
`EventTarget`.

Variants:
- (A) the direct listener, as in the source (`abort_listener.js` whole); the host ignores the symbols;
- (B) a derived signal: the binding listens on `AbortSignal.any([signal])`;
- (C) one patch point in the guest realm: `EventTarget.prototype.addEventListener` understands Node's
  two internal symbols;
- (D) Node's `AbortController`/`AbortSignal`/`EventTarget`/`Event` as guest globals on the browser
  hosts too.

Default candidate: (A), if it is not worse than today on any row; differences are declared pinned
rows. The probe (route B product bindings) runs (A) since round 4.

Measured in-process (`reference/results/abort-variants/`, `run.mjs` with `ONLY=m9`/`m10`,
`ROUTE_B_GEN_DERIVED`). Columns:
- today = `rifty-inproc`;
- A = `rifty-inproc-Bp`: the product bindings make their own symbols, so Node's host `EventTarget`
  ignores them, as a browser's would;
- B = `rifty-inproc-Bp-derived` (`ABORT=derived product/generate.mjs`);
- C: not prototyped;
- D, approximated on the Node host by `rifty-inproc-B`: the core over Node's internals, so the symbols
  are Node's own and its `EventTarget` honours them. Chromium not run for any variant.

| row | Node | today | A | B | D (Node host) |
|---|---|---|---|---|---|
| `m9` `promises.pipeline(r, w, {signal})` after a stopping listener | `ABORT_ERR`, destroyed | `TypeError` | hangs, not destroyed | = Node | = Node |
| `m9` `finished(r, {signal})` after a stopping listener | `ABORT_ERR` | hangs | hangs | = Node | = Node |
| `m9` `addAbortSignal(signal, r)` after a stopping listener | error `ABORT_ERR`, destroyed | not destroyed | not destroyed | = Node | = Node |
| `m9` `readable.map(fn, {signal})` after a stopping listener | `ABORT_ERR` | hangs | = Node | = Node | = Node |
| `m9` `readable.reduce(fn, init, {signal})` after a stopping listener | `ABORT_ERR` | = Node | = Node | = Node | = Node |
| `m10` a guest listener added after `pipeline` sees the source destroyed | `true` | `TypeError` | = Node | `false` | = Node |
| `m10` listeners left after 10000 `reduce({signal})` | 10000 (weak) | 0 | 10000 (strong) | 10000 (strong) | = Node |
| `m10` listeners left after 40000 `finished(r, {signal})` | 0 | `TypeError: cb is not a function` | = Node | = Node | = Node |

Reading against today:
- (A) is not worse on 6 rows. Two rows differ:
  - `promises.pipeline` with a signal: today throws `TypeError` on every call (`m10` row 1, no
    stopping listener). (A) works on that path and hangs only after a guest listener that stops
    propagation. A loud error on every call becomes a silent hang on a rare path: a declared row.
  - `reduce` listeners: today registers none; (A) keeps 10000 strong listeners where Node's are weak
    (the count cannot show weak vs strong; memory not measured here).
- (B) equals Node on `m9` but reorders `m10` row 1 (B3), and the review measured its leak (S5).
- (D) on browser hosts joins the user's globals question (owner: user, below).

Open fork — owner: user, with the isolate `AbortController` globals question (map §Open questions):
whether (D) — Node's classes as guest globals on browser hosts too — is acceptable.

## Open findings (review round 4)

Carried verbatim from the manager's review of PR #450, round 4 (2026-11-25); owner = this unit.

- B3: «производный `AbortSignal.any([signal])` срабатывает **после** всех слушателей исходного —
  гостевой слушатель, зарегистрированный после `pipeline`, видит `r.destroyed === false` (у Node
  `true`)».
- B2, S5: «`reduce`/`map` вешают слушатель прямо на исходный сигнал с `kWeakHandler`/
  `kResistStopPropagation`, которые хостовый `EventTarget` игнорирует, — зависание остаётся, а
  слушатели копятся (10⁴ завершённых `reduce` → 10 000 слушателей; `finished(r, {signal})` ×4·10⁴ →
  +13,9 MiB против +0,3 у Node)». The MiB numbers are the review's measurement of 25.11 on variant B;
  `m10` counts listeners only.
- S6: «дыра 108–115» — Chromium 108–115 has no `AbortSignal.any`, so (B) has no path there.
- The manager's framing: «Корень один: ядро Node рассчитано на собственный `EventTarget` Node. В
  isolate он и будет собственным (единица 7) — там всё точно; проблема только в браузерных хостах.»

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
