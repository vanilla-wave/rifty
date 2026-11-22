---
area: runtime-js
status: draft
title: "A synchronous uncaught throw's fatal report carries Node's `<file>:<line>` header"
created: 2026-11-22
why: Node heads the report with V8's throw site; rifty prints none for a synchronous throw (goal node-file-entry-parity amend 2026-11-22), so an agent reads file:line only from the first frame
sources: [docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/fatal-report.ts]
---

## Context

V8's message location for a synchronous throw is the propagating `throw`
statement; no frame, CallSite or source records it, and three source-inference
rule sets printed wrong headers (PR #421 reviews, ADR-0445 2026-11-22). Needs
a source of the throw site, not an inference from the creation site: e.g. a
host that exposes V8's message (Chromium's `ErrorEvent.lineno/colno` for a
realm-uncaught error, an isolated-vm hook), checked one-sided against live Node
like `fatal-header-generator.test.ts`.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
