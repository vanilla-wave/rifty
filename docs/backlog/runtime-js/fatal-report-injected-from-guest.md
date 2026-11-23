---
area: runtime-js
status: draft
title: "Node's fatal report is injected by the isolate guest, not bundled into every runtime"
created: 2026-11-23
why: After the browser-host rollback (ADR-0445 2026-11-23) `builtins/fatal-report.ts` and its eval-source/decoration bookkeeping ship in every browser bundle but only run in the isolate guest
sources: [docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/backlog/runtime-js/reference/pr-421-browser-fatal-matrix.md]
code: [packages/runtime-js/src/builtins/fatal-report.ts, packages/runtime-js/src/builtins/process-lifecycle-events.ts, packages/runtime-js/src/builtins/node-entry.ts, packages/runtime-js/src/module-loader/loader.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Context

PR #421 external review round 6 (2026-11-23): on the no-COI and COI hosts the
formatter never prints (`installNodeFatalReport()` is called only by the
isolate guest's entry), yet `setFatalEvalSource` (node-entry) and
`markFatalDecorated` (loader's `-e` projection) run unflagged and
`fatal-report.ts` (+ `fatal-source.ts`) is bundled: 7,334 bytes minified, 3,248
gzip, per browser bundle that carries runtime-js (esbuild `--bundle --minify`,
acorn / `@riftydev/*` / sibling modules external; measured 2026-11-23).

## Question

Should the isolate guest pass the formatter in (`installNodeFatalReport(format)`)
so the browser bundles drop it and its bookkeeping, keeping one switch? Owner:
runtime-js; trigger: a bundle-size pass or the next change to the fatal path.
Not rebuilt in PR #421 (manager decision).

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
