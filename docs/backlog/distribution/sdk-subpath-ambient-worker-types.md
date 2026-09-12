---
area: distribution
status: draft
title: SDK subpath declarations compile without incompatible ambient realm libraries
created: 2026-09-07
why: Published sdk/vfs and runtime-js/builtins/process declarations pull the kernel/service-worker barrel into a DOM-only consumer, where ServiceWorkerGlobalScope and Client are undefined.
user_story: As a TypeScript SDK consumer, I want to import the VFS subpath with strict library checking, but today unrelated service-worker ambient names prevent compilation.
sources: [ADR-0070, docs/backlog/distribution/reference/sdk-packaging-evidence.md]
code: [packages/rifty/src/vfs.ts, packages/runtime-js/src/builtins/process.ts, packages/service-worker/src/index.ts, tools/publishing/sync-publish-config.mjs]
---

## Context

Observed while preparing PR #313's disposable compiler probe. The existing
SDK main/worker fixture passes strict TypeScript; adding imports of
`@riftydev/sdk/vfs` and `@riftydev/runtime-js/builtins/process` exposes this
separate subpath declaration graph. Runtime JS boot/compiler behavior does
not need those host-side imports; its probe now uses the real runtime Worker.

Repro: run `node tests/integration/workbench-packed-consumer.mjs --surface-only
--keep`; in the installed consumer add the two imports above to a `.ts` file
included by its tsconfig, then `npm run typecheck`. TypeScript 5.9.3,
`lib: [ES2022, DOM]`, `skipLibCheck: false`: 20 TS2304 errors from published
service-worker `index.d.ts` (`ServiceWorkerGlobalScope`, `Client`).
WebWorker-only probe instead conflicts with transitively referenced `lib.dom`;
adding both libraries is not a fix. No declaration/library-check bypass applied.

Fault class: sibling-drift, published declaration realm boundary. ❌ strict
subpath consumer; source/SDK main consumer unaffected. No solution prescribed.

## Decisions

- 2026-09-07 — owner: distribution; trigger: next published-subpath declaration pickup; manual refine before adopting a plan.
- 2026-09-07 — dedup: searched backlog titles/code/context, goal maps, traps and ADR index for ambient worker/subpath/skipLibCheck; no matching item or declined route.
- 2026-09-07 — outside no-coi-client-bundle I3: I3 owns unused runtime bytes and worker entry retention, not expansion of the strict declaration consumer surface.
