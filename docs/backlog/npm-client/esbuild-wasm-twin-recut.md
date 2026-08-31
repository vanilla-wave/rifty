---
area: npm-client
status: draft
title: Recut esbuild delivery to the exact esbuild-wasm twin — or re-state the asset chain's forcing constraint
created: 2026-08-29
why: the runtime-asset seam is N=1 since ADR-0308; the rollback hook is recorded (ADR-0361) but carries no work item — an asset-only CAS/port/kernel-capability chain (~1.2k LOC + kernel API) stands for one 13.9 MB wasm with its forcing constraint stated nowhere
user_story: As a rifty maintainer touching install/admission code, I want esbuild's wasm delivered by the smallest honest mechanism, but today a full Pattern-2 chain (CAS store, bespoke MessagePort protocol, kernel capability ports, owner/child wiring) exists for exactly one asset and no record says why it must.
sources: [docs/adr/npm-client/0361-lock-replay-admits-the-attested-recipe-pin-request-admission-unchanged.md, docs/adr/npm-client/0344-exact-sass-twin-exposes-named-positive-surfaces-gaps-require-observed-unsupported-behavior.md, docs/adr/npm-client/0321-keep-shadow-asset-port-correlation-package-local.md, docs/adr/kernel/0313-one-shot-opaque-worker-entry-capability-ports.md, docs/adr/playground/0320-define-instant-restore-runtime-asset-availability.md, docs/adr/distribution/0311-registry-owned-esbuild-runtime-removes-the-host-asset-url.md, docs/process/fault-classes.md]
code: [packages/npm-client/src/internal/shadow/manager.ts, packages/npm-client/src/internal/shadow/port.ts, packages/npm-client/src/internal/shadow/planner.ts, packages/npm-client/src/internal/shadow/source.ts, packages/kernel/src/worker-entry.ts, packages/workbench/src/workers/owner-shadow-assets.ts, packages/workbench/src/workers/workbench-runtime-adapters.ts, tools/shadow-registry/src/internal/catalog-source.ts]
---

## Question

Does the esbuild runtime-asset chain still have a forcing constraint? If none
survives re-statement (`fault-classes.md` §Class-kill: ported = new, constraint
gone → deletion), recut esbuild delivery so the wasm arrives like every other
substitution ships its bytes — an exact `esbuild-wasm` registry twin in the
installed tree (Pattern 1, the Sass/LightningCSS shape) — and delete the chain.
If a constraint does survive, record it in a superseding ADR so the N=1 hook
stops being carrier-less. Either exit closes the grandfather gap.

## Context

**The chain, all for one asset.** Catalog `assets` has exactly one entry:
`esbuild-wasm@0.28.0/package/esbuild.wasm` (member 13,918,738 B, tarball ≤
3,845,798 B — `catalog-source.ts`). Serving it:

- `npm-client/src/internal/shadow/` asset-only set (~1k LOC prod): `manager.ts`
  527 (verified CAS: pointer→receipt→objects, storage classes, retention),
  `port.ts` 387 (bespoke ready/read/cancel MessagePort protocol — the ninth
  correlation engine, ADR-0321: "explicit design debt"), `source.ts` 100
  (tarball member fetch), plus the asset-plan projection inside `planner.ts`.
  `planner.ts`/`admission.ts` substitution machinery is shared with Sass and
  LightningCSS installs and stays either way;
- kernel `capabilityPorts` on `WorkerEntryDescriptor` (ADR-0313) —
  `SHADOW_ASSET_PORT_CAPABILITY` is the only real capability name repo-wide;
- workbench wiring: `owner-shadow-assets.ts`, serve/attach in
  `owner-package-state.ts`, child consume in
  `node-entry-runtime-preparation.ts`, adapter in
  `workbench-runtime-adapters.ts`.

**Hook recorded, work never filed.** ADR-0361: "The runtime-asset seam remains
N=1 until a real second Pattern-2 consumer lands." Lineage ADR-0308 (removed):
generalization "withdrawn until a second Pattern-2 package (e.g.
sharp/libvips-wasm) lands — recorded as a hook, not a promise." No second
consumer landed; Sass and LightningCSS deliberately ship as Pattern-1 registry
twins with "no runtime asset, binding, MessagePort server, Workbench adapter,
or manager/store operation" (ADR-0344); Vite 8's esbuild plan is empty
(ADR-0317). The mechanism itself was ported from the #160 quarry (ADR-0308);
no active record re-states why the wasm must live out-of-tree — the
grandfather gap this item closes.

**Observable today** (ADR-0320): wasm sits in a shared per-profile verified
CAS, outside every project tree and archive; instant snapshots don't carry it;
cold Vite 7 boot makes exactly 2 registry requests
(`/npm-registry/esbuild-wasm` + the 0.28.0 tgz); warm CAS = 0 requests; cold
offline fails admission loudly (`ShadowAssetError`).

**Observable after a Pattern-1 recut** (candidate, not prescribed): the wasm
rides the installed tree — ~13.9 MB per esbuild-using project (OPFS
write-through, durability drain, project copy cost), baked snapshot/replay
tarball cache grows ≤ ~3.8 MB compressed; cold offline instant starts working
(tree restore already contains the bytes); per-profile dedup across projects is
lost. Direct `require('esbuild')` and Vite 7 keep one runtime path either way
(ADR-0311 invariant).

**Candidate exits** (carrier choice is compile-time ADR territory,
decision-workflow rule 4 — ≥2 radically different candidates, minimal
interface named):

1. Registry twin (Pattern 1): `esbuild-wasm` acquired as an ordinary in-tree
   package; the ADR-0226 derived runtime + adapter read the wasm from the tree;
   delete the `internal/shadow` asset-only machinery (manager/port/source +
   asset projection), kernel `capabilityPorts`, owner serve/consume wiring
   (each removal supersedes its ADR: 0311/0313/0318/0320/0321 clauses).
2. Constraint survives re-statement (e.g. per-profile dedup / out-of-tree
   trees is judged load-bearing): superseding ADR records it as the seam's
   forcing constraint; chain stays; this item exits via §Declined concepts row.

**Dedup** (2026-08-29 sweep): no existing item proposes removal or recut;
`docs/adr/README.md` §Declined concepts has no matching row. Related:
`playground/correlated-broadcast-bridge-helper` (ADR-0321 names it
consolidation owner of `port.ts:251-343` — exit 1 deletes that ninth engine and
shrinks its scope); `process-meta/documentation-debt.md` row referencing the
removed `npm-client/esbuild-substitution-strategy-reconciliation` item — this
item is the successor carrier. §Class-kill inventory (capture gate 4): no new
mechanism proposed — a removal; the port engine is already inventoried in
ADR-0321 + the consolidation item.

## Challenge

challenge: 2026-08-29 — 2 problems
- Cost sizing inflated ~2x: the "~3k LOC" / "~2.5k LOC prod" chain counts shared substitution machinery — planner.ts (1122 of the dir's ~2.3k prod LOC) and admission.ts carry the recipe/substitution pipeline Sass and LightningCSS installs also flow through (installer.ts imports shadow admission/planner for every substitution; installer-sass-embedded-substitution.contract.test.ts exercises internal/shadow) — so exit 1's actually deletable asset-only set (manager 527 + port 387 + source 100 + asset projection + kernel/workbench wiring) is roughly half the claimed size, weakening the "all for one asset" premise.
- User-experience trade listed but never weighed: exit 1 charges the flagship ROADMAP scenario (real Vite in-process on registry-attested esbuild-wasm) ~13.9 MB in-tree OPFS per esbuild-using project plus lost cross-project dedup, while the gained cold-offline instant start is backed by no evidenced user demand anywhere in the doc — the deltas are quantified per-copy but unsized against real usage (project counts, quota, install-latency), yet the framing leads with "recut … and delete the chain" as the default exit.

(problem 1 sizing corrected in Context after the verdict; verbatim text stands per §Challenge)

## Decisions

- refine 2026-08-29, fork "exit": user picked exit 1 (recut to registry twin) —
  the in-tree cost (13.9 MB per esbuild project, snapshot +≤3.8 MB, lost
  per-profile dedup) is accepted. Challenge problem 2 (unweighed trade) was
  surfaced verbatim in the ask; the user chose recut with it on the table.
- refine 2026-08-29, user scaling requirement: the delivery scheme must scale to
  dozens of dependencies per project "without hacks and excess overhead" — the
  recut is not a one-off deletion but establishes the single pattern:
  - one delivery pattern for every substituted dependency: Pattern-1 registry
    twin, bytes ride the installed tree as an ordinary package (sass and
    lightningcss-wasm already do); a new wasm-bearing native dependency = one
    catalog recipe (data), zero new runtime mechanism. Substitution stays the
    exception for native packages; ordinary JS deps never touch the catalog.
  - network cost at scale is already amortized by the shared acquisition
    layers every npm package uses (registry proxy cache headers ADR-0176,
    replay tarball cache ADR-0346, eddy ADR-0182/0194); twins add no separate
    path.
  - disk cost at scale: per-project `node_modules` is the real-Node norm
    (Fidelity); cross-project byte dedup, if quota becomes a measured pain,
    belongs below the observable surface (content-addressed backing inside the
    OPFS persistence layer, ADR-0072/0358 territory) — fork resolved below.
  - consumer bundle cost at scale (refine 2026-08-29, user-raised): the catalog
    rides the `@riftydev/npm-client` bundle whole via
    `@riftydev/shadow-registry` — data-only, 18 KB today (recipes: triggers,
    integrity, inline facade files); wasm bytes never bundle (network-acquired
    either way). Published footprint likewise: `@riftydev/shadow-registry`
    ships data-only (`files: [dist]`, ~50 KB JS; src fixtures excluded) — a
    rifty consumer's `node_modules` never receives substituted packages' bytes,
    only the recipe dictionary. Scheme invariant: a recipe carries provenance/integrity data
    only, never runtime bytes; a twin's implementation JS rides the installed
    tree (sass precedent), so per-dependency cost to every consumer's bundle
    stays O(recipe data). Demand isolation (refine 2026-08-29, user-asked): a
    small esbuild-only project receives the whole catalog as data (KB) but
    bytes only for its own tree — recipes for uninstalled packages trigger
    zero requests (today: ADR-0320 cold Vite 7 = exactly 2 requests; unchanged
    by the recut — a twin installs only on demand like any dependency). Inline
    recipe content stays stub-sized; anything larger must be an
    acquisition reference, never inline. The one standing exception is the
    135 KB ADR-0226 derived esbuild-runtime.js in the workbench worker bundle
    (shipped to all workbench consumers, esbuild-using or not); whether the
    recut moves it in-tree with the twin or keeps it as a recorded bundle
    exception is a carrier fork for the compile-time ADR — a second derived
    client in the bundle would break the invariant and is refused.
- refine 2026-08-30, fork "cross-project OPFS dedup": user accepts per-project
  duplication of heavy wasm deps (13.9 MB × N esbuild projects) — no dedup in
  the recut contract and no separate perf item now, by explicit user call
  (surfaced trade-off: the no-carrier risk was named). If it ever hurts, the
  expected shape is a pnpm-style package-manager store, decided then. This
  decision line is the knowledge carrier.
