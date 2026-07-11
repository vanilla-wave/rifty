---
area: kernel
status: draft
title: Worker-per-process residuals — pull-mode process.stdin + browser conformance
created: 2026-06-08
why: ADR-0230 shipped ordered flowing stdin into supervised children, but pull/pipe/async Readable APIs remain loud and the generic SAB worker conformance still lacks a default browser run
user_story: As a developer using pull-mode `process.stdin` or generic `child_process` worker behavior, I want Node-compatible reads and browser conformance; today flowing `data`/`setEncoding` works, while pull surfaces throw and generic worker suites remain browser-gated.
sources: [TASKS M6, ADR-0045, ADR-0011, ADR-0230]
---
## Context
ADR-0230 completed the owner→child boundary for supervised Node and `.bin`
children. Ordered chunks reach the MessagePort-backed, non-TTY `process.stdin`;
flowing `data` listeners, `setEncoding`, `resume`, and `pause` work. The public
workbench Chromium acceptance covers that route. Two residuals remain:

- **Pull-mode Readable surface:** `readable`, `read`, `pipe`, and async
  iteration remain loud `NotImplementedError` ceilings. Raw mode and Ctrl+D/EOF
  stay in the terminal backlog, not this item.
- **Generic `child_process` browser conformance:** SAB-only suites
  (`child_process-stdin`, `*-worker`, `exec-sync-worker`) gate on
  `crossOriginIsolated && getKernelWorkerUrl()` and are skipped under Node. The
  generic worker branch therefore still needs an explicit browser CI lane.
## Options / Next
1. Add pull/pipe/async Readable behavior atop the existing MessagePort-backed
   stdin; pair flow control with `binary-stdio-messageport-backpressure`.
2. Run the generic SAB suites in the browser harness as a required CI gate, or
   provide a Node Worker harness that honestly satisfies the SAB contract.
## Reversibility
REVERSIBLE — additive pull-mode behavior + conformance harness; ADR-0230's
flowing stdin contract remains unchanged.
