---
area: npm-client
status: draft
title: Ordinary registry-twin co-demand can erase a substitution by dependency order
created: 2026-08-31
why: the install walk deduplicates an ordinary twin and its recipe-backed public package by acquisition identity before it records the substitution fact, so package.json key order can remove the public facade from an otherwise successful install
user_story: As a browser-IDE user whose dependency graph directly or transitively contains both esbuild and esbuild-wasm, I want npm install to preserve both requested package surfaces, but today one dependency order silently omits esbuild and makes require('esbuild') fail.
sources: [PR-289, docs/process/fault-classes.md]
code: [packages/npm-client/src/installer-walk.ts]
---

## Context

PR #289 changed the builtin `esbuild@0.28.0` substitution from a synthetic
acquisition to the ordinary `esbuild-wasm@0.28.0` registry identity. A
Final+GREEN tail probe installed the same two direct dependencies in opposite
manifest orders:

```text
{"esbuild-wasm":"0.28.0","esbuild":"^0.28.0"}
facade:false twin:true substitutions:0 bindings:0

{"esbuild":"^0.28.0","esbuild-wasm":"0.28.0"}
facade:true twin:true substitutions:1 bindings:1
```

Both installs returned success. In the first order, `resolvedPinIdentity()`
maps both requests to the same `esbuild-wasm@0.28.0` acquisition tuple and the
scheduled-package return runs before the later request can attach its recipe
fact. The installed tree therefore lacks `node_modules/esbuild`, its bin,
trace, and runtime binding solely because object key order changed.

The boundary model includes this as `lossy-aggregate` / `provenance-lie`: an
acquisition may deduplicate bytes, but it cannot collapse distinct requested
package surfaces. Dedup found no matching backlog title, `code:` owner, goal
map child, or declined-concepts row. No new coordination mechanism is implied;
the carrier choice remains for pickup.

## Observable gap

For direct and transitive co-demand, both dependency orders must produce the
same effective tree and replay facts: one ordinary exact twin plus every
admitted public facade/bin/trace/binding. An unsupported collision must throw
loudly before publication; successful install cannot silently choose one
surface.

## Challenge

challenge: 2026-08-31 — 5 problems

The user-value claim rests on one two-key `esbuild@0.28.0` probe, with no evidence that direct/transitive co-demand occurs in the roadmap’s target projects.

Impact is not sized: prevalence, affected versions, transitive graph examples, and whether this is confined to the builtin esbuild substitution are unspecified.

The draft does not establish why the existing requested-package surface/install contract is insufficient as the direct authority, so this may duplicate a PR regression/parity obligation.

The UX contract leaves “unsupported collision” and “loudly” undefined, including when failure occurs and what users should observe; the current failure is especially misleading because install succeeds.

Although adjacent to M10 esbuild, the item has no M11 linkage and may have lower adoption leverage than the roadmap’s explicit M9 fixtures, live-registry, postinstall, and M11 ergonomics work.
