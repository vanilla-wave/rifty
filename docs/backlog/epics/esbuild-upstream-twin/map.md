# Map — esbuild-upstream-twin

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

1. `runtime-js/process-stdio-write-callback` — **stdio-cb** — I3; the stock
   entry's first deadlock; independent (the end surface stays in
   `runtime-js/process-stdio-writable-end-surface`, not this goal).
2. `runtime-js/child-process-ref-unref` — **child-unref** — I3; independent.
3. `runtime-js/fs-stdio-fds` — **fd-0-2** — I3; independent.
4. `runtime-js/fs-stats-node-fields` — **stats** — I3; independent.
5. `runtime-js/worker-threads-unsupported-workerdata-no-silent-hang` —
   **sync-loud** — I2 `*Sync` clause; independent.
6. `npm-client/esbuild-upstream-twin-cutover` — **cutover** — I1, I2, I4,
   I5, I6; blocked by 1-5; carries the version-agnostic differential suite,
   the no-COI split, the COI Vite gate removal, the DEC-2 ADR and the compat
   pages.

## Open questions

- Install shape behind the `esbuild` name (bcrypt-style redirect vs a thin
  facade re-exporting `esbuild-wasm`; `require('esbuild/package.json')`,
  `.bin/esbuild`; Node's equivalent is an npm alias whose `name` is
  `esbuild-wasm` — rifty refuses `npm:` aliases, `installer-request.ts:211`)
  and the per-tier install (COI resolves the range; no-COI keeps main's 0.28.0
  recipe) — owner: agent — cutover pickup, ADR.
- Older Node entries on the verified set: 0.21.x redefines `globalThis.crypto`
  and builds `performance` from `process.hrtime`, `crypto` from
  `randomFillSync` (evidence §Older entries); the spike ran 0.28.0 only —
  owner: agent — probe 0.21.x/0.25.x at cutover pickup; a new gap becomes a
  child item.
- Offline oracle capture for the verified set in CI (Node + esbuild-wasm
  tarballs from registry fixtures; TTY stdout for CLI rows, evidence §Stock
  entry) — owner: agent — cutover pickup.
- Surfaces Node's esbuild-wasm supports that rifty may not match on the first
  run (`context().watch()`, `serve()`) — owner: agent — the differential
  settles; each miss is a named loud gap + compat ❌ + backlog row.
- Stock-path cost on the Vite 7.3.6 lanes (extra Worker + pipe + 13.9 MB
  compile per service start) — owner: agent — measured at cutover; lane
  time-outs are not silently raised.
- Reconcile `npm-client/guest-package-adaptation-inventory-classes` (PR #373:
  esbuild ids as `substitution-environment`, kill none) with I4 — COI rows
  deleted, the no-COI client one `platform-gap` row — owner: agent — whichever
  of the two lands second.

## Out of scope

- Real `*Sync` — `runtime-js/worker-threads-prompt-start-atomics-wait`,
  `runtime-js/worker-threads-kernel-workerdata-structured-clone`,
  `receiveMessageOnPort` (user 2026-10-16: loud only).
- No-COI child processes that load `node_modules` —
  `runtime-js/no-coi-child-process-node-modules` (user 2026-10-16: old runtime
  stays there meanwhile).
- Lockfile migration across catalog changes (user 2026-10-16).
- Verified lanes for Vite other than 7.3.6/8.x (user 2026-10-16: "⚠️ not
  verified").
- Rollup, LightningCSS, Sass twins.
- `@esbuild/wasi-preview1` WASI showcase (ADR-0316) — unchanged.
