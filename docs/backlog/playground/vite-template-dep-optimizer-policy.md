---
area: playground
status: ready
title: Prove or keep the visible Vite template dep-optimizer opt-out
created: 2026-07-08
why: the wrapper-level optimizer force is gone and esbuild-wasm now provides the real JS API, but the default seeded Vite template still writes `optimizeDeps.noDiscovery: true`; that visible policy should be proven removable or documented as a template performance choice.
user_story: As a developer starting from rifty's default Vite template, I want the template's `vite.config.js` to contain only policy I can understand and safely delete, but today the dep-optimizer opt-out remains after the platform gained real esbuild.
blocked_by: []
sources: [ADR-0189, ADR-0192, docs/backlog/npm-client/esbuild-substitution-strategy-reconciliation.md]
code: [apps/playground/src/templates/vite.ts, apps/playground/src/templates/vite8.ts, apps/playground/src/workers/esbuild-host.ts]
---

## Context

PR #125 moves template-specific Vite knobs into visible seeded
`vite.config.js`. The default Vite 7 template still seeds:

```js
optimizeDeps: { noDiscovery: true, include: [] }
```

The original reason was to avoid starting esbuild for a zero-dependency starter
and to avoid wrapper-level hidden policy. ADR-0192 now makes the guest-visible
`esbuild` JS API real via `esbuild-wasm`, so this opt-out is no longer a
platform incapability by itself. It may still be a valid template performance
choice, but it needs proof and wording.

The Vite 8 template also carries `noDiscovery` because its Rolldown optimizer
path is separately constrained; that stays tied to Vite 8 items unless this work
proves a shared policy.

## User scenario

A developer opens the default Vite 7 template, adds a dependency that Vite would
normally pre-bundle, and edits/removes the seeded `vite.config.js`. Rifty should
either behave like Vite on Node, or the template file should make clear that the
opt-out is a visible starter optimization, not hidden runtime behavior.

## Acceptance

- RED first: remove `noDiscovery` from the default Vite 7 template and run a
  browser Vite dev/HMR case that would exercise dependency discovery and
  pre-bundling through real `esbuild-wasm`.
- If the case passes with acceptable startup cost, delete the default-template
  opt-out and update tests that pinned it.
- If the opt-out stays, document it as a visible template performance policy,
  not a platform limitation, and prove a user project can remove it and still
  run a dependency-prebundle case through the real CLI path.
- Keep Vite 8 optimizer policy explicitly separated unless the same proof covers
  its Rolldown path.

## Parity cases

- Real Node Vite 7 with no `optimizeDeps.noDiscovery` discovers and pre-bundles
  a dependency imported by the app.
- Rifty Vite 7 with the opt-out removed observes the same app behavior, or
  fails loudly with a documented platform ceiling.
- Rifty's shipped default template either has no dep-optimizer override or
  carries a visible config comment/test proving why the override exists.

## Out of scope

- Vite 8 Rolldown build/preview and HMR; tracked in Vite 8 backlog items.
- Replacing esbuild package substitution strategy; tracked in
  `npm-client/esbuild-substitution-strategy-reconciliation`.
- Hidden CLI/env optimizer gates. Those are already deleted and must not return.

## Decisions

- Visible seeded `vite.config.js` is allowed template policy. Hidden wrapper or
  env policy is not.
- Default Vite 7 policy should be removed unless the measured cold-start or
  browser behavior proves it still earns its place.
