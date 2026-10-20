# Map — esbuild-upstream-twin

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

## Open questions

- CLOSE cleanup and landing verdict — owner: agent — all accepted obligations
  proven at c8eab80c; independent end-to-end review accepted.
- Final HEAD CI — owner: agent — PR-6 delivery condition before handoff.

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
