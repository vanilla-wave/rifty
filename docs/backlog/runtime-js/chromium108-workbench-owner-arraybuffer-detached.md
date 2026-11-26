---
area: runtime-js
status: draft
title: On Chromium 108 the COI Workbench owner exits at boot, reading ArrayBuffer.prototype.detached (Chrome 114+)
created: 2026-11-26
why: ADR-0469's floor is Chromium 108; there the Workbench owner dies before any project opens (`message-port-ref: no native detached getter`), and `check:es-floor` passes with the read in the tree
user_story: As a user on Chrome 108–113, I want `openWorkbench` to boot a project, but today its owner exits with code 1 at startup
sources: [docs/backlog/runtime-js/reference/chromium108-workbench-owner-boot-evidence.md, ADR-0469, docs/public/compat/browsers.md]
code: [packages/runtime-js/src/internal/message-port-ref.ts, tools/checks/es-floor.mjs]
---

## Context

Finding of the node-streams carrier's Chromium 108 run (evidence: `reference/chromium108-workbench-owner-boot-evidence.md`).

- On Chromium 108.0.5359.29, COI, the Workbench owner boot fails: `Workbench owner exited unexpectedly
  (code 1, signal null)` / `Error: message-port-ref: no native detached getter`, thrown by
  `nativeGetter` (`packages/runtime-js/src/internal/message-port-ref.ts:77-79`; the stack's `:35` is
  the dev server's transformed line).
- The read is `nativeGetter(ArrayBuffer.prototype, 'detached')` (`message-port-ref.ts:192`); with no
  getter `nativeGetter` throws (`:79`). It came with `71be444c1` (2026-09-23, «Count referenced
  MessagePorts as child-realm keepalive handles», ADR-0447).
- `@mdn/browser-compat-data` 8.1.8 (`npm pack`, `data.json` `javascript.builtins.ArrayBuffer.detached`):
  Chrome, Edge, Chrome Android 114; Firefox 122; Safari 17.4. So Chrome 108–113 lack the getter, under
  ADR-0469's Chrome floor of 108; by the same data, Firefox 114–121 too (non-COI Firefox floor 114),
  unmeasured.
- `check:es-floor` lists `ArrayBuffer.prototype.detached` (`tools/checks/es-floor.mjs:67`), yet it
  passed in this PR's `pnpm pr:check` with the read in the built bundles. By reading the guard: it
  matches member expressions (`es-floor.mjs:79,85,499`); here the property name is a string argument
  to a helper that calls `Object.getOwnPropertyDescriptor(target, key)`, so no callsite names it.
  What it should catch: a listed intrinsic reached by name, e.g. a string literal equal to a listed
  member's key with that member's intrinsic receiver in the same call
  (`getOwnPropertyDescriptor(ArrayBuffer.prototype, 'detached')`, `Reflect.get`, a wrapper like
  `nativeGetter`).
- Compat: `docs/public/compat/browsers.md` COI rows carry `❌108 owner-boot` (executed, this run), a
  different failure from the SDK import one (`runtime-js/chromium108-sdk-sync-wasm-import`); the
  computed floors are not moved. Chromium 109–113 not measured.

Open, not measured:
- `installMessagePortReference` runs in every runtime-js process realm
  (`packages/runtime-js/src/ipc/install-process.ts:135`), so on 108 more than the owner may die;
- which other floor reads take a name as a string (the guard's blind spot);
- the matrix rows to correct.
