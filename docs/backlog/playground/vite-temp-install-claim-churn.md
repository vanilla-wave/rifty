---
area: playground
status: ready
title: Keep Vite config-loader temp writes outside the attested dependency tree
created: 2026-07-16
why: live Vite repeatedly writes node_modules/.vite-temp after npm install, correctly revoking the whole-tree claim, marking a fresh Scratch UNSAVED, and forcing the next project reopen to reacquire an otherwise usable dependency tree
user_story: As a playground user, I want an untouched Vite project to stay visibly clean and switching back to remain fast and offline-capable, without weakening dependency-tree trust.
sources: [M11, PR-136-recut, ADR-0261, ADR-0279, Vite-v8.0.16]
code: [apps/playground/src/glue/package-mutation-executor.ts, apps/playground/src/workers/package-acquisition-authority.ts, apps/playground/src/workers/vite-cli-prep.ts, apps/playground/src/workers/workbench-project-vfs.ts]
---

## Context

Vite v8.0.16's bundle config loader creates
`node_modules/.vite-temp/vite.config.*.timestamp-*.mjs`, imports it, and removes
it. Classifying those ordinary `node_modules` mutations as dependency-tree
changes is correct: ADR-0261 permits no path whitelist or trust publication over
a tree changed after promotion. Today the resulting revoke also marks a fresh
Scratch dirty; switching A→B→A then safely but unnecessarily reacquires the
whole dependency tree.

## User scenario

On a fresh Chromium profile, a user opens the Vite Starter, waits for install
and LIVE preview, and makes no edit. Scratch remains clean. They switch to a
second Starter, disable registry/snapshot network, and switch back. The Vite
project reuses its exact installed dependency tree and reaches LIVE without a
second acquisition; its JS/TS config behaves exactly as under unmodified Vite
v8.0.16 on Node v24.16.0.

## Deferred implementation

The first cache redirection patch was rejected after adversarial review: a
complete fix needs an authenticated, chunked capability shared by every Vite
entry path in both legacy and Workbench owners, plus differential proof against
unmodified Vite. Keep this item open; no partial path or synthetic loader closes
the contract below.

## Acceptance

- The acquisition-time Vite preparation redirects only the installed Vite
  config loader's generated module backing to a generation-scoped,
  owner-private disposable cache outside `<projectRoot>/node_modules`. The
  original bundle/transform/import/remove algorithm still executes.
- The disposable cache has one owner and one ingress capability. Ordinary page,
  terminal, runtime-fs, Git, archive, and package writes cannot enter it. Cache
  writes neither call dependency demote/revoke nor mark Scratch dirty; this is
  provenance-based, not a path-wide exception for guest mutations.
- The owner mints an unforgeable per-run admission before child launch. Raw
  kernel sync calls cannot open, enumerate, or reuse a cache generation; knowing
  a generation id grants no authority. Config bytes use a bounded chunked
  protocol below the sync-ring frame limit, with real-dispatcher coverage at the
  maximum accepted bundled-config size.
- The prepared artifact remains usable through `vite`, direct
  `node node_modules/vite/bin/vite.js`, and Vite's programmatic API in both the
  legacy and Workbench owners. Cache URLs preserve `pathToFileURL` escaping for
  config names containing `#`, `?`, `%`, spaces, and non-ASCII text.
- Real Vite v8.0.16 browser proof: initial open reaches LIVE and keeps
  `scratch.dirty === false`; A→B→A with all acquisition network disabled performs
  zero install/snapshot/registry work, retains exact added dependencies, and
  reaches LIVE. Editing any ordinary project file still marks Scratch dirty.
- A control mutates `node_modules/.vite-temp` and another arbitrary
  `node_modules` path through normal guest fs. Both still revoke the install
  claim and mark Scratch dirty; reopen reacquires. Re-promoting after those
  mutations is forbidden.
- Differential config-loader tests run the parity cases below against
  unmodified Vite v8.0.16 on Node v24.16.0 and the prepared browser package.
  Bundle-anchor drift rejects preparation loudly before claim promotion. A fake
  config loader, a `.vite-temp` whitelist, or only counting fewer installs
  cannot close the item.

## Reference contract

- Oracle: unmodified Vite v8.0.16 config loading on Node v24.16.0.
- Mechanism: Vite's own bundle/transform/import/remove config-loader path; the
  prepared package redirects only its generated-module storage through an
  owner-private disposable-cache capability.

## Parity cases

1. Default and explicit `--config` load `vite.config.js`, `.mjs`, `.cjs`, and
   `.ts` with the same exported config, mode, command, cwd, and root as the
   oracle under both `type: module` and `type: commonjs` package contexts and
   through package-bin, direct-Node, and programmatic entry paths.
2. Config-relative imports and package imports resolve from the original config
   and project `node_modules`, not from the disposable cache location. Dynamic
   import and top-level await preserve Vite v8.0.16 behavior.
3. `vite`, `vite build`, and `vite preview` observe the same config side-effect
   order and output. A thrown config error names the user's config source and
   line; the private cache path does not replace it in user-visible diagnostics.
4. Repeated config evaluation after editing the config never reuses a prior
   generated module. Two run generations cannot see or delete each other's
   cache entry.
5. With no user mutation, the config-loader mkdir/write/import/remove sequence
   changes neither the trusted install claim nor Scratch dirty state. The same
   sequence performed through ordinary guest fs revokes trust and dirties
   Scratch.

## Fault matrix

The shared mutable state is the disposable Vite config cache. Its complete
writer set is the prepared Vite config loader; `OwnerVfsAuthority` owns
admission, generation identity, cleanup, and exclusion of every ordinary writer.

| Fault | Required outcome |
|---|---|
| `torn-state` × owner/child crash during write/import/remove | Project bytes and install claim stay unchanged; next generation removes only its own stale cache and evaluates config afresh. |
| `concurrent-same-key` × overlapping/retiring Vite generations | Unique generation keys; old cleanup cannot remove or satisfy the current generation. |
| `stale-state` × late write after session fence | Reject the retired generation; do not dirty the new project or create a reusable cache entry. |
| `quota-perm-fail` × cache materialization | Vite command fails finitely with storage provenance; no fallback into `node_modules`, no claim revoke, no false LIVE. |
| `poisoned-cache` × leftover generated module | Generated modules are never trusted across generations; re-evaluate from the current user config. |
| `sibling-drift` × dev/build/preview or Vite bundle upgrade | Every bundled config-loader entry uses the one capability; missing/duplicate patch anchors loud-fail before promotion. |
| `provenance-lie` × ordinary guest write to the old `.vite-temp` path | It remains an ordinary attested-tree mutation: revoke + dirty + reacquire. |

## Out of scope

- Arbitrary Vite/plugin/user writes anywhere under `node_modules`, including a
  user-created `node_modules/.vite-temp`, remain dependency mutations. They
  revoke trust and dirty Scratch; no filename or directory whitelist exists.
- Caches from Vitest, Jest, ESLint, Rollup plugins, or other tools are not routed
  through the Vite capability. They retain ordinary mutation behavior until a
  separately refined owner exists.
- An installed Vite bundle without the exact single config-loader patch anchor
  throws `NotImplementedError('playground.vite-config-temp-cache')`, remains
  compat ❌, and never falls back to a mutable attested tree.

## Decisions

- Preserve ADR-0261 whole-tree trust exactly. Do not whitelist `.vite-temp`,
  classify it as harmless after the fact, hash only part of `node_modules`, or
  mint a new claim after an uncoordinated mutation.
- Keep Vite's bundle config loader because its CJS/ESM/TS behavior is the oracle.
  Runner/native loaders that change supported config semantics are rejected.
- Prepare the exact installed Vite artifact before claim promotion, following
  the existing `vite-cli-prep` loud-anchor discipline. Artifact identity covers
  the prepared bytes.
- Cache placement/capability is private Playground ownership and reversible:
  no public API, external dependency, claim schema, or attested set changes.
