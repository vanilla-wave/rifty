---
area: toolchain-build
status: draft
title: Browser tests that npm-install resolve version ranges in the live registry, so a third-party publish order can turn CI red
created: 2026-11-25
why: run 45584384135 (PR #452) went red on `e2e-chromium (heavy 2/2)` with no rifty change in the path — `tldts@7.5.6` was published before the `tldts-core@^7.5.6` it requires
sources: [tests/e2e/vitest-run.spec.ts, distribution/build-module-count-pins-over-live-transitives]
code: [tests/e2e/vitest-run.spec.ts]
---

## Context

Observed 2026-11-25, PR #452 head `aa625324d`, CI run 45584384135 attempt 1. In
`tests/e2e/vitest-run.spec.ts:214` («unclaimed modes fail loudly with a named ceiling, never a
silent pass») the in-browser `npm install` (helper `:113`) failed with
`npm: install failed: No matching version for tldts-core@^7.5.6`, on the first try and both
retries. The fixture's top-level versions are exact (`jsdom: '30.0.1'` among them); the transitive
ranges (jsdom → tough-cookie → `tldts@^7`) resolve live. From the npm registry's `time` field:
`tldts@7.5.6` was published at 2026-11-25T09:27:21Z, `tldts-core@7.5.6` at 09:32:15Z, and the test
ran at about 09:29. Attempt 2, a re-run of the failed jobs with no change, was green.

The same spec also relies on live resolution on purpose: `:221-226` drops the vite pin and expects
the latest Vite to fail loudly (`Not implemented: lightningcss.version`), and
`runtime-js/reference/vitest-run-acceptance-final-green.json:269` records that step as
deliberate. So `vitest-run` mixes a deliberate live step with an accidental live transitive.

It is the same mechanism as `distribution/build-module-count-pins-over-live-transitives` (a
pinned module count over live transitive resolution); the failure here is an install error, not
a count. No other backlog item, trap or declined concept names it: searched `live registry`,
`registry.npmjs`, `publish race`, `tldts` in `docs/backlog`, `docs/process/traps.md` and
`docs/adr/README.md`. `toolchain-build/committed-lockfile-registry-host-guard` covers lockfile
hosts, not range resolution.

The files below run `npm install` against a registry, found by grep
(`'npm install|"npm install|npm i |npm install'|` + "\`npm install"), not investigated one by one.
Some of them may already be closed: a committed lockfile (`npm-lock-replay`), a fixture registry
(`tests/integration/fixtures/registry/**`), or exact transitive pins.

- `tests/e2e/`: fullstack-demo, http-close-command-drain, m0-curious-first-15min,
  manual-vite-install, npm-bin-collision-diagnostic, npm-lock-replay, npm-override-bare-version,
  owner-shell-cowsay, owner-shell-prettier-eslint, owner-shell-responsive,
  owner-snapshot-restore-exec, preset-deep-link, react-vite-preset, storage-layout-notice,
  vitest-run, workspace-archive (`.spec.ts`)
- `tests/browser-unit/`: advanced-ipc, child-fs-product-lane, esbuild-network-measurement,
  esbuild-upstream-twin, esbuild-vite-contract, host-async-keepalive, local-npx,
  message-port-ref-keepalive(.fault), nested-worker-retirement, node-fetch-finalization,
  node-fetch-guest, node-file-parity, owner-node-process-lifecycle, owner-node-stdio-control,
  owner-preview-provenance, owner-shell-routing, project-location, registry-package-ownership,
  sass-network-measurement, sass-vite-contract, saved-project-access,
  saved-project-interrupted-install, url-legacy, vite-at-root, vite-build-failure-containment.fault,
  vite-cli-upstream-bytes, vite6-upstream-cli, workbench-playground-companion,
  worker-handle-keepalive, worker-stdio-exec-argv, zlib-scenario (`.spec.ts`)
- `tests/no-coi/`: agent-npm-install, no-coi-pdf-text, no-coi-sandbox-build-loop,
  npm-update-parity, registry-error-control-flow (`.spec.ts`)
- `tests/integration/`: esbuild-declarations, express-live.opt-in, npm-shell-command,
  npm-shell-eddy-glue, npm-shell-prefix-parity, npm-shell-save-parity, npm-shell-update-parity
  (`.test.ts`); no-coi-snapshot-browser-proof, reference-host-browser-proof (`.mjs`)

## Question

Which tests should keep resolving ranges in the live registry (a test of the resolution itself, or
of installing whatever is current), and which should fix their whole tree while the registry stays
real and only the versions are pinned?

Options raised, not decided:
- (a) a committed `package-lock.json` in the fixture, replayed by rifty's npm against the real
  registry;
- (b) exact transitive pins through `overrides`;
- (c) keep the live ranges and accept rare red runs from publish order, naming the cause when it
  happens;
- (d) npm's `--before <date>`: resolve ranges against the registry as it was at a fixed time. This
  keeps the range-resolution proof and removes the publish-order race, but rifty's npm client does
  not implement it (nothing in `packages/npm-client/src`), so it first needs that feature, faithful
  to Node's npm.

Each changes what the test proves: (a) and (b) stop proving «installs what npm would install
today», which also breaks `vitest-run`'s deliberate live step; (c) keeps CI hostage to third-party
publish order; (d) proves resolution at a fixed date, not today's. Open, too: is the answer per
test, or one rule per lane?

## Challenge

<!-- finding capture — no premise critic at draft (README §Challenge) -->

Final written-result check, 2026-11-25, fresh reviewer: «2 problems (both are things the decider isn't told). The facts and the shape are fine.» (1) the `npm --before` option was missing; (2) vitest-run's deliberate live step (`:221-226`) was not mentioned. Both are now in the draft.
