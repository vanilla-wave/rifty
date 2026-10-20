# Map — esbuild-upstream-twin

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

0. `npm-client/esbuild-upstream-twin-carrier` — **carrier** — I1/I2/I5;
   executable install + stock build + complete tarball-byte comparison, RED.

1. `npm-client/esbuild-upstream-range-install` — **range-install** — I1/I4/I5;
   explicit installer tier + range template + byte/offline/no-COI proof.
2. `npm-client/esbuild-upstream-twin-cutover` — **cutover** — I1, I2, I4,
   I5, I6; depends on range-install; carries the version-agnostic differential suite,
   the no-COI split, the COI Vite gate removal, the DEC-2 ADR and the compat
   pages.

## Open questions

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
