---
area: runtime-js
status: ready
title: `ChildProcess#ref/unref` and child stdio `unref` exist with Node's loop semantics
created: 2026-10-16
why: rifty's `ChildProcess` has no `ref()`/`unref()` and its stdio streams no `unref()`; the child holds the parent's keepalive from construction to `'close'`, so upstream esbuild-wasm's `child.unref()` throws `TypeError` and a long-lived unref'd service child can never let its parent exit
epic: esbuild-upstream-twin
sources: [docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md, ADR-0152]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

Finding (2026-10-16, evidence §Node-surface gaps, §Discriminating layers):

- `const c=spawn('node',['-e','1']);console.log(typeof c.ref,typeof c.unref,typeof c.stdin.unref,typeof c.stdout.unref)`
  → rifty `undefined undefined undefined undefined`; Node 24.16.0
  `function function function function`.
- `require('esbuild-wasm').transform(...)` → `TypeError: child.unref is not a
  function at ensureServiceIsRunning (/node_modules/esbuild-wasm/lib/main.js:2106:9)`.
- A no-op stub is not enough (layer f3): the parent stays alive after the
  result until `^C`; Node exits once the unref'd service is idle
  (esbuild-wasm@0.28.0 `lib/main.js:2103-2118`: `child.unref()`, `stdin.unref()`, `stdout.unref()`,
  per-call `refs.ref()/unref()`).

`ChildProcess` (`child_process.ts:122+`) calls `refEventLoop()` in its
constructor and `unrefEventLoop()` at `'close'` only. ADR-0152 §1 owns the
keepalive count; this is a Node handle class on that chokepoint.

## Challenge

challenge: 2026-10-20 — clear; observed defects, goal premise unchanged.

## Acceptance

1. ChildProcess ref/unref and child pipe ref/unref match Node return and lifetime behavior; output pipes and pending writes retain independently, idle stdin does not. → I3

## Reference contract

Node v24.16.0; `tests/browser-unit/esbuild-node-surfaces.spec.ts` runs the
same supported scenario against Node and Chromium. Named unsupported Sync
results follow goal I2, not Node's success output.

## Out of scope

Other goal units remain linked on the map; no goal closure from this repair.

## Decisions

- 2026-10-20 — RDY-8 observed-defect route: real baseline + executed RED
  before implementation; independent Final+GREEN pending. Carrier: child and pipe ref unref; referenced pipes; child reref; idle stdin.
