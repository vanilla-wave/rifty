---
area: runtime-js
status: ready
title: `vm.runInThisContext` / `Script` honour `lineOffset` and `columnOffset`
created: 2026-09-15
why: vitest's module evaluator (and vite-node 3) evaluate every transformed test module with `vm.runInThisContext(wrapped, { filename, lineOffset: 0, columnOffset: -N })`; rifty throws `NotImplementedError('vm.runInThisContext.columnOffset')` for any non-zero offset, so no test file can execute
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vm-run-in-this-context-offsets-evidence.md, docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/adr/runtime-js/0450-project-vm-script-offsets-through-one-owned-stack-hook.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/vm/index.ts, packages/runtime-js/src/module-loader/source-maps.ts, tools/node-parity-runner/cases/vm, tests/browser-unit/vm-script-offsets.spec.ts]
---

## Context

Node v24.16.0 (evidence P1–P7) shifts every line of a vm script by
`lineOffset` and only physical line 1 by `columnOffset`, never clamping:
`throw new Error("boom")` with `{lineOffset: 0, columnOffset: -20}` renders
`/virtual/mod.js:1:-13`; with `{lineOffset: 10, columnOffset: 5}` a line-1
frame is `11:12`, a line-2 frame `12:16`. CallSite getters return null for a
shifted value ≤ 0; rendering omits a zero line/column. Execution is unchanged.
This corrects the goal evidence §Oracle reading ("clamps at 1", `12:21`).

vitest 4.1.11 evaluates each test module with `columnOffset:
-prefix.length`; vite 8.0.16's module runner assigns its own
`Error.prepareStackTrace` and reads CallSite getters for its source-map lookup.
Rifty's host-realm script is an indirect `eval` (no origin offsets); Chromium
freezes `CallSite.prototype` and has no embedder stack callback. Carrier:
ADR-0450.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Acceptance

1. `vm.runInThisContext(code, options)` and `new vm.Script(code, options).runInThisContext()` accept any int32 `lineOffset` / `columnOffset` (negative included), execute exactly as without them (completion value, `var` becomes a global, `this === globalThis`) and never throw `vm.runInThisContext.lineOffset|columnOffset` or `vm.Script.lineOffset|columnOffset`; vitest 4.1.11's module-evaluator shape (`'use strict';async (…)=>{{` + code, `columnOffset: -prefix.length`) returns its function — parity `vm/run-in-this-context-offsets` (`exec`), `vm/run-in-this-context-offsets-callsites`, unit `script-offsets.test.ts` → I4, I6
2. Every frame of an offset script — top level, functions it defines called during or after evaluation, `Error.captureStackTrace` targets — renders in `err.stack` as in Node: line + `lineOffset` on every line, column + `columnOffset` on physical line 1 only, unclamped (negatives printed, a zero line or column omitted); frames of other scripts are unchanged; async frames (`at async …`) included — parity `vm/run-in-this-context-offsets`, `vm/run-in-this-context-offsets-async` + browser-unit `vm-script-offsets.spec.ts` (Chromium default rendering) → I6 + ADR-0450
3. Offsets belong to the script: the same filename evaluated with other offsets or none keeps its own positions; a `vm.Script` keeps its constructor offsets across runs and `Script#runInThisContext` options carry none; an omitted filename renders as Node's `evalmachine.<anonymous>` with the offsets — parity rows `per-script`, `Script-*`, `default-filename` → I6 + ADR-0450
4. A guest `Error.prepareStackTrace` hook — assigned before or after the script is evaluated, cloning CallSites through their prototype's own names — receives CallSites whose `getLineNumber` / `getColumnNumber` / `getEnclosingLineNumber` / `getEnclosingColumnNumber` carry the offsets (null for a shifted value ≤ 0), whose `getFileName() || getScriptNameOrSourceURL()` is the real filename (spaces included) and whose `toString()` matches Node; the callsites save/restore pattern and re-assigning the originally read hook keep the offsets in default rendering (vitest 4.1.11 module evaluator under vite 8.0.16 `interceptStackTrace`) — parity `vm/run-in-this-context-offsets-callsites` + browser-unit spec → I4
5. `lineOffset` / `columnOffset` are validated as Node's int32 (`ERR_INVALID_ARG_TYPE` / `ERR_OUT_OF_RANGE`, exact messages; `lineOffset` first, `compileFunction` `columnOffset` first as in Node — evidence P9) on `runInThisContext`, `Script`, `runInContext`, `runInNewContext` and `compileFunction`, before any loud gap — parity `validate …` rows, unit `script-offsets.test.ts` → ADR-0450
6. Once an offset script ran, `Error.prepareStackTrace` has one owner: ADR-0136 source-map windows opened after or around an offset script keep both remaps, restore the value they read and never remove the owner; a formatter that bypasses the owner never shows an unshifted `filename:line:col`, and the next offset script projects again; this holds from Chromium's unset start hook too — `script-offsets-stack-hook.fault.test.ts` (Fault matrix) → ADR-0450
7. `docs/public/compat/modules.md` `node:vm` row states host-realm offsets as honoured and lists the Out of scope gaps and the ADR-0450 divergences as ❌; `packages/runtime-js/CHANGELOG.md` records the change; ADR-0450 is indexed → ADR-0450

## Reference contract

- Oracle: Node v24.16.0 (V8 13.6.233.17-node.49) `node:vm` `runInThisContext` / `Script` with `lineOffset` / `columnOffset`; Node's `prepareStackTraceCallback` and default `Error.prepareStackTrace` (`ErrorPrepareStackTrace` calling `defaultPrepareStackTrace`); `validateInt32` (evidence P1–P8).
- Mechanism: V8 script-origin offsets surfaced by CallSite getters (null ≤ 0) and CallSite serialization (0 omitted). Rifty keeps V8's CallSites of its indirect-eval carrier and projects them through one owned hook (ADR-0450); ADR-0136's source-map window is reused unchanged in behavior.
- Consumers: vitest 4.1.11 `dist/module-evaluator.js:192-206`, `dist/chunks/base.B6Opl8PE.js:151-154`; vite 8.0.16 `dist/node/module-runner.js:824-829,940-982` (evidence §Consumers).
- Platform: Chromium 148.0.7778.96 (evidence §Chromium).

## Parity cases

1. Line-1 negative column, unclamped: `throw new Error("boom")` `{filename: '/virtual/mod.js', lineOffset: 0, columnOffset: -20}` renders `/virtual/mod.js:1:-13` (case row `line1-negative-column`; evidence P1 A) → I6 + ADR-0450
2. Offsets split by physical line: `line1-positive` `b.js:11:12`, `line2-positive` `c.js:12:16`, `fn-line1-called-line2` `d.js:11:27 | d.js:12:10`, `fn-line3-called-line1` `e.js:13:9 | e.js:11:6`, `lineOffset-only` `i.js:4:9`, `columnOffset-only` `j.js:1:16` (evidence §Parity case outputs) → I6 + ADR-0450
3. Non-positive shifted positions: `negative-line` `f.js:-2:7`, `zero-line` bare `zl.js` twice, `zero-column` `zc.js:1 | zc.js:1:17`; getters `boundary col1` `1,1,1,null`, `boundary line0-col0` all null, `boundary negative-line` `null,9,null,2` (evidence P4–P6) → I6 + ADR-0450
4. `vm.Script`: `Script-line2` `s.js:6:9`, `Script-line1` `s2.js:5:16`, `Script-run-options-ignored` `s3.js:1:7`, `Script-reused` `reused.js:7:31` on both runs → I6 + ADR-0450
5. Per script and default filename: `per-script` `same.js:101:24 || same.js:201:74 || same.js:1:24 || same.js:101:24`; `default-filename` `evalmachine.<anonymous>:7:9` → I6 + ADR-0450
6. Deferred and captured frames: `deferred-line2` `late.js:4:35`, `deferred-line1` `late1.js:3:51`, `captureStackTrace` `cap.js:2:136 | cap.js:2:169` → I6 + ADR-0450
7. Execution unchanged: `exec 42 7` → I6
8. Validation: 15 option sets × {`runInThisContext`, `Script`} (`validate …` rows; evidence P3) → ADR-0450
9. vitest/vite hook shape: `vite-hook line1` `/virtual/my project/src/sum.test.ts,1,28,1,1,atLine1 [atLine1 (/virtual/my project/src/sum.test.ts:1:28)]`, `vite-hook line3` `…,3,9,2,32,atLine2 […:3:9]`, `callsites-pattern` `…,4,56,4,30,sites`, `late-hook 1:28`, `restored typeof function`, `restored default line1` `…:1:28`, `restored default line3` `…:3:9` → I4
10. Chromium realm: cases 1–9 and 11 print the same stdout in a fresh Chromium module worker (`Error.prepareStackTrace` initially undefined) as the parity runner's `runInNode` — `tests/browser-unit/vm-script-offsets.spec.ts` → I4
11. Async frames (`vm/run-in-this-context-offsets-async`): `async-default` `at inner (/virtual/async.js:13:46) | at async outer (/virtual/async.js:12:15)`, `async-line1` `…async1.js:4:90 | at async outer1 (/virtual/async1.js:4:30)`, `async-hook` `false,inner2,13,47,… | true,outer2,12,15,async outer2 (/virtual/async2.js:12:15)` (evidence §Parity case outputs) → I4 + ADR-0450

## Fault matrix

Boundary: owned in-process projection (`fault-classes.md` §Boundary failure
models); transport loss, duplicate and reorder are excluded. Writers of the
`Error.prepareStackTrace` slot: guest code, the ADR-0136 window
(`module-loader/source-maps.ts`), the vm offset owner. Serializing owner: the
ADR-0450 accessor.

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| `sibling-drift` × guest assigns the hook before or after an offset script | the guest hook gets projected CallSites; reading back delegates to it; re-assigning that value restores it | parity `vm/run-in-this-context-offsets-callsites` (`vite-hook`, `callsites-pattern`, `late-hook`, `restored`) + browser-unit spec | → I4 |
| `concurrent-same-key` × ADR-0136 window opened after an offset script, twice | both remaps apply; each restore reads back the pre-window value; no self-recursion | `script-offsets-stack-hook.fault.test.ts` row 1 | → ADR-0450 |
| `concurrent-same-key` × first offset script evaluated inside an ADR-0136 window | the window restore keeps the owner; offset frames still project afterwards | fault test row 2 | → ADR-0450 |
| `concurrent-same-key` × rows 1–2 from Chromium's unset hook (restore writes `undefined`) | the restore clears through the owner, never deletes it; reading back after re-assigning the read value is identical | fault test `from an unset hook` rows | → ADR-0450 |
| `provenance-lie` × formatter bypassing the owner (`delete`, format inside a hook, overflow) | offset frames show a visibly encoded identity, never an unshifted `filename:line:col`; the next offset script re-installs projection | fault test row 3 (`delete`), `inside a stack hook` row; overflow not deterministically drivable (same V8 bypass branch) | → ADR-0450 |
| `provenance-lie` × zero-offset filename shaped like an identity (`rifty-vm://5/5/x.js`) | rendered as that filename at its own position, never decoded as offsets | fault test `shaped like an offset identity` row | → ADR-0450 |

## Out of scope

- `vm.runInContext` / `vm.runInNewContext` with a valid non-zero offset: `NotImplementedError('vm.runInContext.lineOffset' | 'vm.runInContext.columnOffset')` + compat ❌ (vitest's `vmThreads` / `vmForks` pools are outside the goal).
- `Script#runInContext` / `Script#runInNewContext` on a Script built with a non-zero offset: `NotImplementedError('vm.Script.lineOffset' | 'vm.Script.columnOffset')` + compat ❌.
- `vm.compileFunction` with a non-zero offset: `NotImplementedError('vm.compileFunction.lineOffset' | 'vm.compileFunction.columnOffset')` + compat ❌.
- ADR-0450 divergences (a property read cannot throw), each a compat ❌ row: the slot is an accessor once an offset script ran; reading it back after assigning a function yields a delegating wrapper, after a non-function the default; an owner bypass shows the encoded identity; `eval` / `new Function` called inside an offset script show the encoded identity (no position) as their eval origin (Node: `eval at f (file:line:col)`).
- Pre-existing and unchanged (evidence §Discovered 1–4), compat ❌ rows: eval-shaped host-realm frames (`at eval (…)`, `isEval()` true, `getFileName()` undefined); no default `displayErrors` decoration; zero-offset filenames that are omitted or not valid `sourceURL` values lose the filename (`<anonymous>`, Node `evalmachine.<anonymous>`); Chromium's `undefined` default hook before any offset script.

## Decisions

- ready-verdict: 2026-09-23 — Contract+RED @ 75ea85bce3969246d1f3b31bc61f2d95863d937c
- 2026-09-23 — carrier: ADR-0450 (per-script `sourceURL` identity + one owned `Error.prepareStackTrace` accessor projecting CallSites); source prefix, filename map, data-property dispatcher and `CallSite.prototype` patch rejected on evidence.
- 2026-09-23 — Node v24.16.0 re-run replaces the goal evidence §Oracle `vmoff.cjs` reading (no clamp; `columnOffset` on physical line 1 only); Node 24's default `Error.prepareStackTrace` is a function, not undefined (evidence §Correction, P2).
- 2026-09-23 — owner installed at the first offset script, not at realm boot: ADR-0136's scoped footprint holds for programs without offsets; the pre-offset default-hook shape stays a recorded gap (evidence §Discovered 4).
- 2026-09-23 — sandbox entry points keep named gaps: ADR-0142 engines have no script origin; vitest's vm pools are out of goal scope (map §Out of scope).
- 2026-09-23 — frame-shape gaps found at pickup (evidence §Discovered 1–3) are outside this promise; compat ❌ here, backlog routing at land.
- 2026-09-23 — IMPLEMENT: Node v24.16.0 `compileFunction` validates `columnOffset` before `lineOffset` (evidence P9); Acceptance 5 follows Node, not the earlier blanket "lineOffset first". `runInContext` checks its context before options, and a `Script`'s run methods ignore construction options (offsets, `cachedData` & co.), as Node (evidence P9; unit rows).
- 2026-09-23 — IMPLEMENT: Contract+RED concerns taken in place — Chromium-start fault rows, in-hook bypass row, async parity case, runInNewContext / compileFunction order rows, `+ ADR-0450` traces, eval-origin divergence recorded. Stack-overflow bypass stays untested (V8 skips the hook only while the stack is overflowed; not reproducible on demand).
