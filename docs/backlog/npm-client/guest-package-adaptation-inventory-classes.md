---
area: npm-client
status: ready
title: Every guest-package adaptation in the ADR-0384 inventory — executable patches and catalog substitutions — carries its class, authority, drift anchor and kill condition; a platform-gap row links its platform item
created: 2026-10-15
why: ADR-0384 made the registry own all adaptations and listed them, but the inventory names no class or authority per adaptation, so a patch that compensates a rifty gap (the Vite CAC hook) and a patch that is a faithful Node handle mapping (esbuild `runtime-service-refs`) read the same — the honesty debt is invisible
user_story: As a maintainer reading `registry-package-adaptations-evidence.md`, I want each of the 13 esbuild patch ids, the Vite policies, the emnapi backport, the Vite 8 napi-WASI manifest override, the launch-env preparation, the nested-lockfile dispatch and the catalog substitutions (esbuild, LightningCSS, Sass, Rollup, bcrypt) to state what kind of thing it is and what proves it, but today the table lists owners only
epic: honest-guest-package-adaptations
blocked_by: [npm-client/vite-cli-action-keepalive-hook-removal]
sources: [ADR-0384, ADR-0226, ADR-0433, ADR-0152, docs/backlog/npm-client/reference/registry-package-adaptations-evidence.md, docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md]
code: [tools/shadow-registry/esbuild-runtime-policy.json, tools/shadow-registry/src/runtime/vite-cli-install-policy.ts, tools/shadow-registry/tools/esbuild-exact-patcher.mjs]
---

## Context

Finding (2026-10-15). The principle lives in `AGENTS.md` §Fidelity and
`docs/process/rules/fault-classes.md` §Guest-package adaptations (classes
`substitution-environment`, `handle-mapping`, `upstream-edge`, `backport`;
`platform-gap` only as declared interim debt with a linked platform item and
kill condition). This unit applies it to the existing inventory, including
the catalog-level substitutions (inventory row "esbuild, LightningCSS, Sass,
Rollup, bcrypt substitutions/shims") — the user's concern names every
substituted package (handoff §Диагноз), so twins are classified too.

The refine's draft classification (2026-10-15) is superseded by the final-state
sweep of 2026-10-16 (Vite CAC hook gone, ADR-0530; both Vite root policies gone,
ADR-0533); the classified table lives in the owner doc, not here.

Dedup: `registry-package-adaptations-evidence.md` is the owner doc (updated
in place); no title/`code:`/map/declined match.

## Challenge

challenge: 2026-10-15 — clear (goal premise, `epics/honest-guest-package-adaptations` §Challenge)

## Acceptance

Carrier: `docs/backlog/npm-client/reference/registry-package-adaptations-evidence.md`
§Finite inventory (docs unit: no product RED; independent docs review).

1. Every id in `esbuild-runtime-policy.json` `patches`, every facade id in
   `sass-embedded-policy.json`, every substitution-catalog recipe, every
   `internalsShims`/`bakedOverrides` entry and every installed-file preparation
   in `tools/shadow-registry/src/runtime/` has exactly one row stating its
   class, authority, loud drift anchor (where it fails loudly) and kill
   condition; no row names a deleted policy → I3, scenario 3
2. A `platform-gap` row links its platform item and kill condition (none
   remain: the CAC hook is deleted); an `upstream-edge` row cites its real-Node
   artifact at the same version → I3
3. A row whose behavior is broken or whose authority is missing states it and
   links its item instead of claiming a pass; the public compat claim agrees
   (`incompatible-packages.md` `bcrypt`) → I3, scenario 3
4. ADR-0384 carries a dated pointer to the principle and the inventory; its
   Decision is unchanged → I3

## Out of scope

- A public compat-page "Adaptations" section — user decision 2026-10-15
  («Только внутренний инвентарь»).
- A machine check over the inventory — the user chose principle-in-rules
  (2026-10-15); review enforces.
- Fixing a divergence a `platform-gap` row points at — its own item; inside
  this epic only by user amendment.

## Decisions

re-cut: 2026-10-16 — draft → ready at pickup; acceptance rows 1-4; draft table replaced by the owner-doc inventory — trace: none
- 2026-10-16 — pickup sweep (read-only subagent + probes): 13 esbuild ids,
  Sass/LightningCSS/esbuild facades, Rollup shim, emnapi backport, Vite 8
  manifest override, catalog redirects; findings routed: `bcrypt` substitution
  broken (Chromium probe, compat ❌, `npm-client/bcrypt-substitution-install`),
  `NAPI_RS_FORCE_WASI` launch env without a deciding record
  (`npm-client/napi-rs-force-wasi-launch-env`), emnapi policy comment corrected
  (Rolldown WASI 1.1.5 backport, no `@emnapi/core` release carries the guard).

- 2026-10-15 — user: «записать в правила проекта как принцип. С остальными
  правилами как будто работает» — principle in `AGENTS.md` + `fault-classes.md`,
  no ADR, no gate; this unit classifies the inventory.
- 2026-10-15 — agent: catalog substitutions included (user's framing names
  every substituted package); `platform-gap` = declared interim debt per
  `fault-classes.md` §Guest-package adaptations.
