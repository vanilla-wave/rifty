---
area: npm-client
status: ready
title: Lockfile replay traverses entry optionalDependencies with the live cpu gate
created: 2026-08-16
why: npm-authored locks keep platform siblings under entry optionalDependencies; the lockfile source hardcodes `{}`, so replay silently drops every wasm/WASI binding and the failure surfaces at first build blaming npm (issue #254)
user_story: As an SDK embedder seeding an npm-authored lock with vite@8 pinned, I want the wasm32 rolldown binding materialized like a live install would, but today the restored tree has no `@rolldown/binding-*` at all and `vite build` dies with rolldown's "Cannot find native binding" npm-bug message
epic: faithful-npm-lock-replay
blocked_by: []
sources: ["https://github.com/vanilla-wave/rifty/issues/254"]
code:
  - packages/npm-client/src/installer.ts
  - packages/npm-client/src/installer-lockfile-reader.ts
---

## Context

`ResolvedPin.optionalDependencies` is documented live-resolve-only
(`installer.ts:364`): rifty's writer folds succeeded optionals into
`dependencies` and drops failures, so `createLockfileSource.resolve` returns
`optionalDependencies: {}` (`installer.ts:2775`) and the walk's optional loop
(`installer.ts:2305`) iterates nothing on replay. That invariant is
`frozen-assumption`: it holds only for rifty-written locks. npm ≥7
(`npm install --package-lock-only`) keeps the siblings under entry
`optionalDependencies` — one portable lock for every platform — so replay drops
ALL of them, including the wasm32 one the live path would have kept via
`assertNativeSupported` (`installer.ts:2816`).

Mechanics for the implementing agent — reuse, don't build:

- Reader (`installer-lockfile-reader.ts`): surface `optionalDependencies`,
  `cpu`, `os` from v3 entries (entry `dependencies`/`peerDependencies` are
  already surfaced — `installer.ts:2771,2773`).
- Source: return `entry.optionalDependencies ?? {}` at `installer.ts:2775`;
  rewrite the stale doc comments at `:364` and `:2774` (rifty-lock-only
  invariant, keep it stated for the writer).
- cpu gate at resolve time: apply the SAME predicate `assertNativeSupported`
  uses (absent/empty cpu, `wasm`/`wasm32` member, or any `!`-negation → admit)
  to entry `cpu`. One shared predicate function — a second copy is
  `sibling-drift`. Inadmissible optional → throw `ENATIVEUNSUPPORTED` from
  resolve; the existing optional-boundary machinery (`installer.ts:2246-2268`
  await-before-recurse, warn-and-skip, claim rollback; catch at `:2309-2314`)
  already turns that into skip-with-warning. The tarball-manifest gate stays as
  the backstop chokepoint.
- Missing lock entry for an optional edge (npm dropped a failed optional at its
  write): resolve throws `EBROKENLOCK missing-entry`, the optional catch
  warns-and-skips — must NOT abort the install. Non-optional missing entries
  keep today's loud `EBROKENLOCK`.
- Acquisition needs no change: lockfile-origin ordinary pins already go through
  `fetchAndUnpackToCache` (cache-first, network fallback, `installer.ts:2132`)
  with the entry's `resolved`/`integrity`; only shadow-registry pins use the
  replay cache.
- Record cpu-skipped entries (name + install path) on the walk result — the
  `unreached-entry-gate` item consumes that set.
- rifty-authored locks carry no entry `optionalDependencies` → behavior
  byte-identical; pin with a regression test.

## User scenario

Issue #254 repro (observed 2026-08-12; npm version pin lands with the pickup
probe): `package.json` with `devDependencies: { "vite": "8.0.16" }`;
`npm install --package-lock-only --ignore-scripts` writes a lock whose
`node_modules/rolldown` entry lists 15 `@rolldown/binding-*` under
`optionalDependencies` and pins
`node_modules/@rolldown/binding-wasm32-wasi { "cpu": ["wasm32"], "optional": true }`.
Seed into `install({ vfs, cwd, registry })`: today the tree gets `rolldown` +
`@rolldown/pluginutils` only and `vite build` dies in
`rolldown/dist/shared/binding-*.mjs` with "Cannot find native binding. npm has
a bug related to optional dependencies". Expected: `@rolldown/binding-wasm32-wasi`
+ its `@emnapi/*`/`@napi-rs/wasm-runtime`/`tslib` closure materialize, native
bindings are skipped with a warning each, `vite build` completes.

## Acceptance

- Same npm-authored lock replayed twice: tree equals the live-resolve tree for
  the same manifest modulo nothing — versions, layout, `.bin` links identical.
- Replay tree = the committed npm oracle tree MINUS exactly the entries whose
  `cpu` fails the shared predicate; each exclusion produced one visible warning
  line. No other divergence.
- rifty-authored lock replay: byte-identical lockfile + identical tree vs
  before this change (regression suite).
- A fake (asserting presence of one package name without walking the real
  install core through registry/tarball/VFS boundaries) cannot close this.

## Reference contract

- Oracle: npm 11.17.0 on Node 24.16.0 — pinned by the committed loopback-
  registry probe `docs/backlog/npm-client/reference/npm-11-lockfile-replay-probe.md`;
  the issue-#254 outputs above remain observed real-package evidence.
- Mechanism: npm arborist lock replay — entries install verbatim; platform
  filtering by `cpu`/`os` at reify.

## Parity cases

1. Lock entry `optionalDependencies` with cpu-admissible target (`wasm32`):
   entry + its transitive required closure materialize; lock rewrite preserves
   npm's entry shape.
2. cpu-inadmissible target (`["x64"]`-style, no negation): skipped, one warning
   naming package + cpu, install succeeds, skip recorded for the gate item.
3. Optional edge whose target entry npm dropped (failed optional at write
   time): warn-and-skip, no abort — differential vs npm which also proceeds.
4. `!`-negated cpu (`["!arm"]`): admitted (same predicate as live).
5. Optional entry that is ALSO reachable via a required edge elsewhere:
   installs exactly once, required demand wins (`scheduled` dedup, no
   double-pin).
6. rifty-authored lock (no entry optionalDependencies): tree + lockfile bytes
   unchanged vs main.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| frozen-assumption | replay compared against committed npm oracle tree, not against rifty's own writer | differential fixture from the pickup probe |
| corrupt-input | malformed entry `optionalDependencies`/`cpu` (non-object/non-array) → loud `EBROKENLOCK malformed-entry`, never a guessed shape | lock mutation table |
| poisoned-cache | fetched optional tarball failing integrity → loud, entry not pinned, no partial claim survives (claim rollback `installer.ts:2258-2267`) | integrity-mutation fault test |
| provenance-lie | a skipped optional never reports as installed; warning names package + reason | warn-line assertion in parity cases 2–3 |
| false-fallback | optional failure degrades to skip-with-warning; required-edge failure still aborts | cases 3 vs missing required entry |

## Out of scope

- Traversing `peerDependencies` — `npm-client/lockfile-replay-peer-entries`.
- Post-walk unreached-entry validation —
  `npm-client/lockfile-replay-unreached-entry-gate`.
- Materializing cpu-inadmissible natives (would need `.node` execution) — stays
  skip + warning + compat ❌ per ADR-0051.
- `os`-only filtering changes: keep today's semantics (cpu is the signal),
  surface `os` on the entry for diagnostics only.
- Live-resolve path changes; rifty lock WRITER changes (folded-optionals write
  shape stays).

## Decisions

ready-verdict: 2026-08-17 — Contract+RED @ 1ce0fd6cc97a8543c880db3fb77eacabd74e5866
- Traverse-on-replay chosen over materialize-lock-verbatim: the D-F unified
  walk (one pipeline for replay + live, `installer.ts:16-19`) is a recorded
  decision; a second install path duplicates placement/bin/shadow/progress
  machinery — §Simplicity. Faithfulness gap left by traversal (parentless
  orphan entries) is closed loudly by the gate item, not silently.
- cpu filter applied at resolve from entry `cpu` (fail-before-fetch), with the
  tarball-manifest `assertNativeSupported` retained as the single backstop
  predicate — one chokepoint, two call sites, zero copies.
- Missing optional target entry = warn-and-skip (npm parity), even though the
  same condition on a required edge is `EBROKENLOCK`.
- Evidence gap, blocks `ready`: #254 outputs lack a pinned npm/Node version —
  pickup commits the loopback probe artifact first (§Backlog readiness 4).
