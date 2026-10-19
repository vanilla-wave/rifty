# Map — esbuild-upstream-twin

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

0. `npm-client/esbuild-upstream-twin-carrier` — **carrier** — I1/I2/I5;
   executable install + stock build + complete tarball-byte comparison, RED.

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
- Vite-side preparation still version-specific in COI after the gate goes
  (I6): the CAC hook (ADR-0530) and root policies (ADR-0533) are gone on
  main; the CLI mode grammar is still copied from 7.3.6 (`vite-cli-prep.ts`,
  "copied from vite 7.3.6") — owner: agent — cutover pickup proves I6 holds
  for Vite 5/6/7 (grammar probes); narrowing I6's "any" goes back to the
  user.
- Starter pin: playground seeds pin `vite@7.3.6` (`vite-project-policy.ts`,
  `vite-version.contract.test.ts`), inventory row `platform-gap`, owned by
  `npm-client/vite-7-3-7-from-scratch-esbuild-refusal` (kill: starters
  declare `^7` and lanes pass) — owner: agent — in COI the refusal that item
  reports goes with I6 at the cutover; the pin's retirement stays that item's
  proof.
- Oracle host: the file-stdout quirk and every CLI row were observed on
  macOS Node 24.16.0 only; CI captures the oracle on Linux — owner: agent —
  cutover pickup re-captures on the CI host before freezing rows.
- `honest-substitution-signals` I2 (esbuild facade `types` = the twin's
  `lib/main.d.ts`) must hold for every installed version after the cutover —
  owner: agent — whichever of `npm-client/esbuild-facade-typescript-declarations`
  and the cutover lands second carries it.

## Out of scope

- Real `*Sync` — `runtime-js/worker-threads-prompt-start-atomics-wait`,
  `runtime-js/worker-threads-kernel-workerdata-structured-clone`,
  `runtime-js/worker-threads-receive-message-on-port` (user 2026-10-16: loud
  only).
- No-COI child processes that load `node_modules` — separate goal
  `epics/no-coi-child-processes` (user 2026-10-16: old runtime stays there
  meanwhile).
- Lockfile migration across catalog changes (user 2026-10-16).
- Verified lanes for Vite other than 7.3.6/8.0.16 (user 2026-10-16: "⚠️ not
  verified").
- Rollup, LightningCSS, Sass twins.
- `@esbuild/wasi-preview1` WASI showcase (ADR-0316) — unchanged.
