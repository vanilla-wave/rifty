---
area: runtime-js
status: draft
title: Guest Node code sees browser-only globals (`DOMMatrix`, `XMLHttpRequest`, `importScripts`, `self`, …) that Node 24 lacks
created: 2026-11-17
why: environment detection by global presence (`typeof XMLHttpRequest`, `typeof importScripts`, `typeof DOMMatrix`) picks browser/worker branches that real Node never takes
sources: [docs/adr/runtime-js/0529-count-host-task-async-node-surface-requests-in-child-realm-keepalive.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/ipc/worker-realm-compat.ts]
---

## Context

REV-12 discovery of the process brand fix (cross-review of PR #399): pdfjs-dist
in Node mode polyfills `DOMMatrix`/`Path2D` from `@napi-rs/canvas` only when
`globalThis` lacks them; in rifty they are already present, so its no-COI text
output matches Node without the canvas package (`tests/no-coi/no-coi-pdf-text.spec.ts`).

Scratch no-COI spec (Playwright 1.60.0 Chromium, `createSandbox` no-COI
toolchain, `node g.cjs` printing `typeof globalThis[name]` per name) vs native
Node v24.16.0 (`node -e` with the same list):

```
DOMMatrix Path2D OffscreenCanvas ImageData importScripts FileReader XMLHttpRequest
  rifty "function" · Node "undefined"
indexedDB caches self   rifty "object"   · Node "undefined"
window document         rifty "undefined" · Node "undefined"
```

These are native `WorkerGlobalScope` members (`WorkerGlobalScope` itself is
visible too); rifty adds none, it only re-defines `self` as writable.
rifty itself relies on several: a writable `self` for emnapi
(`ipc/worker-realm-compat.ts`), `importScripts` as a worker-scope signal
(`builtins/vm/quickjs-loader.ts`), the native `XMLHttpRequest` for no-COI
child sync calls (`ipc/no-coi-child-transport.ts`), so hiding them constrains
rifty's own boot. ADR-0529 already names `indexedDB`/`caches`/`scheduler`
"out of the Node surface" for keepalive accounting; no item decides whether
guests should see them. Not checked: COI kernel Worker children (same Worker
global scope expected).

## Question

Which browser-only globals may a guest Node program observe, and which must be
hidden or replaced? Hiding is observable both ways (pdfjs's text path relies
on the present `DOMMatrix` today; axios 1.x — code reading, not run — tries
adapters `['xhr', 'http', 'fetch']` and takes xhr when `XMLHttpRequest` is
defined). Needs an inventory against Node 24's global list and a policy
decision before any carrier.

## Next

Owner runtime-js. Trigger: a guest package that picks a browser/worker branch
by global presence (axios adapter selection, a `self`/`importScripts`
worker check), or a Node-parity failure traced to such a global.
