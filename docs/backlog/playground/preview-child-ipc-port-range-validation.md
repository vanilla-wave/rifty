---
area: playground
status: draft
title: Validate preview child IPC ports against the TCP port domain
created: 2026-07-15
why: sibling child-message guards accept invalid port values, so corrupt child IPC can publish impossible preview routes instead of failing at the owner boundary
user_story: As a playground user running a Node or dev server, I want corrupt child port announcements rejected loudly so the UI never advertises an impossible preview URL as live.
sources: [ADR-0150, ADR-0155]
code: [apps/playground/src/glue/node-child-ipc.ts, apps/playground/src/glue/dev-server-ipc.ts]
---

## Context

Review of PR 136 found an unrelated pre-existing `corrupt-input` +
`sibling-drift` class. `isNodeChildMessage` accepts every JavaScript number,
including `NaN`, infinities, fractions, zero, and negatives.
`isDevServerChildMessage` requires integers but still accepts values outside the
TCP port domain. Either path can feed an impossible port into preview state.

This is outside PR 136's owner-correlated readiness work; do not point-fix one
guard there.

## Options or Next

- Define one shared exact port predicate for child IPC (`1..65535`, safe integer).
- Add RED corrupt-frame cases for ready and port-set messages across Node and
  dev-server siblings, including `NaN`, infinities, fractions, zero, negatives,
  and values above `65535`.
- Verify valid boundary ports and ordinary multi-port announcements still pass.

## Reversibility

REVERSIBLE — internal IPC validation only; invalid child frames become loud
rejections before they reach the preview registry.
