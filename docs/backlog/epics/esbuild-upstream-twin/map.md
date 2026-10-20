# Map — esbuild-upstream-twin

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

0. `npm-client/esbuild-upstream-twin-carrier` — **carrier** — I1/I2/I5;
   executable install + stock build + complete tarball-byte comparison, GREEN;
   independent final verification pending.

1. `npm-client/esbuild-upstream-twin-cutover` — **cutover** — I1, I2, I4,
   I5, I6; carries the version-agnostic differential suite,
   the no-COI split, the COI Vite gate removal, the DEC-2 ADR and the compat
   pages.

## Open questions

- Linux CI live stock oracle and final HEAD checks — owner: agent — await
  browser-unit and whole-PR CI after the cutover repair commit.
- Independent Final+GREEN/CLOSE — owner: agent — verify the repaired tree,
  full gate and packed consumer. Accepted obligations remain on this map.

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
