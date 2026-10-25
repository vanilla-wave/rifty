---
area: runtime-js
status: draft
title: Node Fetch classes install pulls the whole builtins registry into the kernel host bundle (+472 KB) — install belongs to the guest child bundles
created: 2026-10-21
why: ADR-0541 §Bundle measurement — quickjs-kernel-worker-host 199,125 → 671,590 bytes (+143,150 gzip) on first page load and every spawn; ~107 KB is undici classes, the rest a second builtins registry copy no kernel-host realm uses
user_story: As a user opening the playground or spawning `node`/`.bin`/dev-server on a cold cache, I want the kernel host to carry only kernel code, but today it downloads+parses ~140 KB gzip of builtins used solely to build Fetch classes the guest later gets from its own bundle
sources: [docs/adr/runtime-js/0541-run-node-fetch-classes-over-the-browser-i-o-boundary.md, docs/backlog/toolchain-build/worker-bundle-shared-runtime-dedup.md, docs/backlog/perf/lazy-builtin-registration-at-boot.md]
code: [packages/runtime-js/src/builtins/fetch/install.ts, packages/runtime-js/src/builtins/fetch-keepalive.ts, packages/runtime-js/src/builtins/index.ts, packages/workbench/src/workers/kernel-worker-entry.ts, packages/workbench/src/workers/node-entry-bootstrap.ts, packages/workbench/src/workers/dev-server-child-bootstrap.ts, packages/workbench/src/workers/worker-runtime-globals.ts]
---

## Context

Read-only analysis at 40837803b (PR #381). Measured facts: ADR-0541 §Bundle
measurement (base 7f8d0e8d7 → #381, `pnpm build:playground`, Python gzip
level 9 mtime 0): `quickjs-kernel-worker-host` 199,125 → 671,590 bytes
(+472,465; gzip 56,947 → 200,097, +143,150); generated undici classes ≈107 KB.
Other entries grew 4–6 KB.

Cause (source, unmeasured split): `fetch/install.ts` `installNodeFetch()`
calls `ensureRuntimeJsBuiltinsRegistered()`; `builtins/index.ts:2-43`
statically imports every builtin factory (`:63-137`), so the registry rides
any bundle that imports the Fetch install. Production drops the module's own
self-call (`:139`) because `packages/runtime-js/package.json:18` marks `src/`
side-effect-free — ADR-0541 §Decision 6 "production boot RED" added the
explicit activation. `kernel-worker-entry.ts:45` runs `installFetchKeepalive()`
at module top level → `fetch-keepalive.ts:16` `installNodeFetch()` → registry
now in the kernel host (`quickjs-kernel-worker-host.ts:5` imports that entry).
At 7f8d0e8d7 the keepalive imported only `@riftydev/io` + ceilings; the
kernel host carried no registry.

Realm facts: guests never resolve builtins from the kernel-host copy. Each
`kind:'url'` child bundle (`node-entry-bootstrap`, `dev-server-child-bootstrap`)
is self-contained and `import()`ed after the pre-entry hook
(`packages/kernel/src/worker-entry.ts:271-272,359`); its loader resolves
builtins from its own registry copy (`module-loader/resolver.ts:136`). Hence
the registry in the kernel host serves one consumer: `createFetchClasses`.

Side effect (dual-copy hazard, same class as
`worker-runtime-globals.ts:38-47` / `toolchain-build/worker-bundle-shared-runtime-dedup`):
guest Fetch classes are built from the kernel-host copies of
Buffer/stream/events/util, not the guest `require()` copies.

Ruled out by analysis: Node-style lazy accessors (`exposeLazyInterfaces`
getter → data property on first touch) save no bytes — a synchronous getter
still needs classes + registry statically bundled; ESM evaluates every
registry import at load. They would only defer `createFetchClasses` + ~10
factory calls per realm (CPU, unmeasured) and improve descriptor fidelity —
a separate parity concern, not this item.

No size pin covers the kernel host: `tools/checks/client-bundle-budget.mjs:18-23`
budgets SDK client artifacts only; `esbuild-legacy-retirement.mjs:93,253-256`
is a 2 MB per-file ceiling.

Dedup: no match in backlog titles/`code:`, goal maps, `traps.md`
(`worker-entry-chunk-graph` is the inverse leak), `docs/adr/README.md`
§Declined concepts. Related, not same: `perf/lazy-builtin-registration-at-boot`
(boot-eval CPU inside a realm that needs builtins; names-only resolver split),
`toolchain-build/worker-bundle-shared-runtime-dedup` (class identity across
bundles; this item removes one instance of that hazard).

## Question

Which realm owns `installNodeFetch()`? Candidate direction (observable, not
decided — amends ADR-0541 §Decision 6 "install through the existing
Fetch/web-global bootstrap before guest code" → new short ADR citing it):

- kernel host keeps `HOST_FETCH` capture (`install.ts:17-23`),
  `installFetchPlatformBindings()` (must run before any `Response` shadowing,
  `platform.ts:30`), WebAssembly streaming ceilings (`fetch-keepalive.ts:15`),
  and a call-time thunk for `NODE_NETWORK_FETCH`
  (`packages/io/src/host-fetch.ts:12-15`);
- Fetch classes install moves into the guest-running bundles
  (`node-entry-bootstrap`, `dev-server-child-bootstrap`; runtime-js
  `worker-entry.ts:52` web globals and no-COI toolchain paths already carry
  the registry) before `prepareNodeEntryRuntime`/preloads
  (`node-entry-bootstrap.ts:127-141`), reading `publicNodeProcess()` at
  materialization.

Expected (estimate, unmeasured): kernel host ≈199 KB + 10–20 KB; child
bundles +≈107 KB classes + network/install glue, no registry growth; one
Buffer/stream copy for guest Fetch bodies.

Open before pickup:

- Do owner (`workbench-owner-bootstrap`), `ts-lsp-worker-entry`, WASI realms
  ever need Node Fetch classes? Owner npm/resource fetches use `fetchHost`;
  infra bare `Response`/`Headers` (`packages/net/src/http/response.ts:213,237`,
  `packages/net/src/cross-realm/preview-port.ts:258`) must be checked per
  realm against the ADR-0541 platform-bindings order.
- Where does a `kind:'url'` child that skips `node-entry-bootstrap` (any
  realm running guest code without those two bootstraps) get its install?
  Inventory before cutting.

## Challenge

<!-- Direction challenge at PICKUP (README §Challenge). Factual capture, no early critic. -->

## Acceptance

<!-- Candidate RED targets; traced to the scenario above and ADR-0541. -->

1. `apps/playground/dist/assets/quickjs-kernel-worker-host-*.js` sourcemap
   `sources` lists no `packages/runtime-js/src/builtins/*` module except
   `fetch/platform.ts`, `fetch-keepalive.ts` and `fetch/install.ts`'s
   `HOST_FETCH` capture (or their split-out equivalents); the generated undici
   class module absent → scenario
2. Measured per ADR-0541 "Reproduce" (separate clones at base + candidate,
   `pnpm build:playground`, Python gzip level 9 mtime 0): kernel-host bytes and
   gzip reported; delta vs `671590`/`200097` recorded in the ADR amendment;
   child-bundle deltas reported alongside → ADR-0541
3. `tests/browser-unit/node-fetch-guest.spec.ts` + Fetch e2e-prod lanes green
   in every guest realm (COI node entry, dev-server child, standalone
   runtime-js worker, no-COI toolchain) with no re-registration path added →
   ADR-0541
4. Inside the child realm the Fetch classes resolve the same builtin copies
   the guest's `require()` returns: a Buffer produced by the Fetch body path
   satisfies `require('buffer').Buffer.isBuffer`, and a Node-stream body
   adapter satisfies `instanceof require('stream').Readable` → scenario

## Out of scope

- Lazy Node-style Fetch global accessors (descriptor fidelity) — separate
  parity item if ever raised; saves no bytes.
- A kernel-host size pin/budget — only if the delta measurement motivates one.
- Chunk-level dedup of `@riftydev/io` across worker bundles —
  `toolchain-build/worker-bundle-shared-runtime-dedup`.

## Decisions

- 2026-10-21 — capture only; direction stays a question until the realm
  inventory above is answered and the ADR-0541 §6 amendment is drafted.
