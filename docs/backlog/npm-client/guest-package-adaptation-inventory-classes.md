---
area: npm-client
status: draft
title: Every guest-package adaptation in the ADR-0384 inventory — executable patches and catalog substitutions — carries its class, authority, drift anchor and kill condition; a platform-gap row links its platform item
created: 2026-10-15
why: ADR-0384 made the registry own all adaptations and listed them, but the inventory names no class or authority per adaptation, so a patch that compensates a rifty gap (the Vite CAC hook; the esbuild client's Node-entry stand-ins) and a declared twin environment read the same — the honesty debt is invisible
user_story: As a maintainer reading `registry-package-adaptations-evidence.md`, I want each of the 13 esbuild patch ids, the 3 Vite policies, the emnapi backport, the Vite 8 napi-WASI manifest override, the launch-env preparation, the nested-lockfile dispatch and the catalog substitutions (esbuild, LightningCSS, Sass, Rollup, bcrypt) to state what kind of thing it is and what proves it, but today the table lists owners only
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

Classification established by the refine (evidence file §Probe 1, §Root):

| adaptation | class | authority | kill condition |
|---|---|---|---|
| esbuild `inline-worker-startup`, `node-callback-fs`, `channel-has-fs`, `runtime-default-wd`, `transform-temp-fs`, `native-validation-provenance`, `runtime-service-refs` | **`platform-gap`** (corrected 2026-10-16) | each stands in for what upstream esbuild-wasm's Node entry gets from Node (`spawn('node', bin/esbuild)`, `fs`, `process.cwd()`, `os.tmpdir()`, `readFileSync`, `child.ref()/unref()`); that entry is blocked by rifty gaps (stdio write callback, `ChildProcess#ref/unref`, fs on fd 0, `fs.Stats` fields; no-COI same-realm `require`) — `docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md` §Discriminating layers, §Today's cost | COI: `epics/esbuild-upstream-twin` cutover; no-COI: `epics/no-coi-child-processes` |
| esbuild `gate-sync-family`, `gate-direct-lifecycle`, `gate-analyze-metafile`, `gate-context-watch-serve`, `gate-one-shot-build-write` | `substitution-environment` (named gates) | ADR-0226 D1/D4, compat `esbuild-js-api.md` | COI: `epics/esbuild-upstream-twin` cutover (stock entry; `*Sync` loud via its own item); no-COI: none until `epics/no-coi-child-processes` |
| esbuild `native-target-errno` | `substitution-environment` (native-esbuild oracle emulation over wasm; upstream esbuild-wasm on Node shows the wasm text) | ADR-0242, ADR-0226 oracle | COI: `epics/esbuild-upstream-twin` cutover (user oracle = esbuild-wasm on Node, 2026-10-16); no-COI: as the client |
| Vite CAC action hook (`viteCliActionPatchPolicy`) | **`platform-gap` / dead** | none; probe 1 | `npm-client/vite-cli-action-keepalive-hook-removal` |
| Vite root-watch (`viteRootWatchPatchPolicy`) | `upstream-edge` | real Node 24.22.0 + Vite 7.3.6 at `/`: phantom `vite.config.js changed, restarting server…` + spurious `[file change]` for untouched files, then OOM — evidence file §Root runs 2-3 (ADR-0433 had only the isolated function; rifty symptom `de26804b1`) | deleted by `epics/project-location-independence` (user 2026-10-15: Node-exact at `/`, default `/home/project`); until then re-prove on each admitted Vite/chokidar version |
| Vite root-URL (`viteRootUrlPatchPolicy`) | `upstream-edge` | real Node 24.22.0 + Vite 7.3.6 + plugin-react 5.2.0 at `/`: `/src/App.jsx` imports `"/@id//@react-refresh"` while the preamble uses `"/@react-refresh"`; control at `/home/node/app` uses one URL — evidence file §Root run 5; ADR-0433 | same as above |
| emnapi 1.10.0 readable/minified backport | `backport` | upstream fix version (to be cited from the preparation source) | emnapi release carrying the fix admitted |
| Vite 8 napi-WASI manifest override, launch-env preparation | `substitution-environment` | ADR-0384 D3, ADR-0336 D2/D3 | none |
| nested lockfile dispatch | to classify at pickup | ADR-0384 D3 | — |
| catalog substitutions: esbuild (ADR-0226/0316; becomes the upstream `esbuild-wasm` twin in COI by `epics/esbuild-upstream-twin`), LightningCSS, Sass (ADR-0344), Rollup, bcrypt | `substitution-environment` | their ADR + `docs/public/compat/` page (`lightningcss` page: `honest-substitution-signals` I3) | none — declared twins; a twin without a compat page is a missing-authority row |

Acceptance shape expected at pickup: the inventory table in
`registry-package-adaptations-evidence.md` gains `class`, `authority`,
`anchor` (loud on drift: yes/no + where) and `kill condition` per row; every
id in `esbuild-runtime-policy.json` `patches` and every exported policy in
`vite-cli-install-policy.ts` and every catalog recipe has exactly one row;
every `platform-gap` row links its platform item and kill condition; ADR-0384
gains a dated note pointing at the principle (a pointer, not a DEC-2
correction — its Decision is untouched). No machine gate (goal §Decisions);
review enforces.

Dedup: `registry-package-adaptations-evidence.md` is the owner doc (updated
in place); no title/`code:`/map/declined match.

## Challenge

<!-- finding capture — no premise critic at draft (README §Challenge) -->

## Out of scope

- A public compat-page "Adaptations" section — user decision 2026-10-15
  («Только внутренний инвентарь»).
- A machine check over the inventory — the user chose principle-in-rules
  (2026-10-15); review enforces.
- Fixing a divergence a `platform-gap` row points at — its own item; inside
  this epic only by user amendment.

## Decisions

- 2026-10-15 — user: «записать в правила проекта как принцип. С остальными
  правилами как будто работает» — principle in `AGENTS.md` + `fault-classes.md`,
  no ADR, no gate; this unit classifies the inventory.
- 2026-10-15 — agent: catalog substitutions included (user's framing names
  every substituted package); `platform-gap` = declared interim debt per
  `fault-classes.md` §Guest-package adaptations.
- 2026-10-16 — agent: 7 esbuild Node-entry stand-in ids (incl.
  `runtime-service-refs`) reclassified `platform-gap` on the
  `esbuild-upstream-twin` spike evidence (four Node-surface gaps shimmed →
  unmodified esbuild-wasm gives Node-identical output under COI); the 5
  `gate-*` ids and `native-target-errno` stay `substitution-environment`
  with kill = that goal's cutover in COI.
