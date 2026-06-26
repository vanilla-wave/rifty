---
area: playground
status: active
title: `vite` loads the user's real `vite.config.*` (or loud-throws)
created: 2026-06-26
why: build/preview/dev run with `configFile: false` (build-boot.ts:176/204, ADR-0173) — the user's vite.config.ts/js (plugins, resolve.alias, server.proxy, define) is silently ignored; ADR-0173 deferred config loading without a backlog record.
user_story: As a developer with a vite.config.ts (an alias, a plugin, server.proxy), I want `vite` / `vite build` to apply it like real Vite, but today config is hardcoded `configFile:false` and my config is silently ignored.
sources: [ADR-0173, ADR-0137, docs/backlog/shell/node-modules-bin-execution.md, docs/backlog/playground/honest-vite-command-umbrella.md]
code: [apps/playground/src/workers/build-boot.ts, apps/playground/src/workers/owner-child-vite-command.ts, apps/playground/src/workers/real-vite-bootstrap.ts]
---

## Context

The curated handlers pass `configFile: false` + programmatic options derived from
`templateId`. Vite's real config resolution (`loadConfigFromFile`) esbuild-bundles
`vite.config.ts/js`, imports it through the module loader, merges `defineConfig`. None
of that runs — a user-edited config is a no-op with no signal. Gap 2 of the honest-vite
umbrella.

## Options or Next

1. **Real load.** Run Vite's config resolution against the owner store: esbuild-bundle
   the config (the esbuild-WASI shim is already used by the build path), import via the
   node-entry loader, feed the resolved config to `createServer` / `build`. Loud-throw on
   a config feature we can't honor (e.g. a plugin needing an unsupported API) — never a
   silent partial-merge.
2. **Interim honesty (doable now).** While #1 is in progress, detect a present
   `vite.config.*` the curated path can't honor → loud-throw
   `NotImplementedError('vite.config-loading')` + compat ❌, so config is never silently
   ignored. Bare default-config projects unaffected.

## Done when (no partial delivery)

- A fixture project with a non-trivial `vite.config.ts` (resolve.alias + one plugin +
  server.proxy) boots/builds with that config applied, parity vs real Vite on the
  observable effect (alias resolves, plugin transform fires, proxy routes); OR
- (interim) a present config the curated path can't honor loud-throws; default-config
  projects unaffected — AND #1 stays tracked, not silently dropped.
- Regression/parity test pinning the shipped behaviour.

## Reversibility

REVERSIBLE residual. Builds on ADR-0137 loader + ADR-0173 build path. The supported
config-feature scope/limits, once settled, may warrant an ADR note.
