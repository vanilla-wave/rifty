---
kind: epic
status: ready
title: Honest guest-package adaptations — classified patches, dead Vite hook removed, keepalive gap fixed in the platform
created: 2026-10-15
value: A developer running real Node programs and CLIs in rifty gets Node's process lifetime for pending host-async work, runs Vite from upstream CLI bytes, and the project can read for every remaining adaptation what it is and what proves it — no patch compensates an unrecognized platform gap. Evidence says three independent things, not one story: one real keepalive defect (unrelated to any patch), one dead patch, and patches whose class a real-Node artifact decides.
user_story: As a developer running `node hash.js` whose last work is `crypto.subtle.deriveBits(...)` or `await blob.arrayBuffer()`, and `vite build` on the Vite 7 starter, I want the same output and exit as Node 24 and an installed `vite/dist/node/cli.js` that is the upstream file, but today the hash script exits silently with no result, `cli.js` carries a rifty keepalive rewrite that no platform gap justifies, and the adaptation inventory says nothing about why each patch exists
tier: works
---

## Outcome

Three things are true at once. (1) The child-realm keepalive counts
host-task-async requests of Node-surface APIs (Blob/File body reads,
`fs.openAsBlob`, `WebAssembly.compile`/`instantiate`, WebCrypto, zlib over
CompressionStream, in-guest Response bodies, global `WebSocket`) the way libuv counts threadpool
and platform requests, so a run-to-completion program lives until they settle
— the smallest honest extension of ADR-0152 §1's shape (per-class refs on the
existing `ref()/unref()` chokepoint, no realm-wide census — ADR-0378). (2) The
Vite CAC action hook, an adaptation with no Node handle behind it and no
platform gap it can name, is gone; installed `cli.js` equals upstream bytes.
(3) The ADR-0384 inventory classifies every executable adaptation (class,
authority, loud anchor, kill condition) under the principle recorded in
`AGENTS.md` §Fidelity and `fault-classes.md` §Guest-package adaptations; the
only `platform-gap` row today (the dead hook) is deleted by (2), and any later
one is declared and linked, never silent. Faithful-runtime payoff: silent drops become
Node behavior; upstream bytes run where rifty used to rewrite them; the
remaining patches are declared, not hidden.

## User scenario

1. In the Vite 7 starter terminal the developer runs
   `node -e "const {Blob}=require('buffer');new Blob([Buffer.alloc(64*1024*1024,65)]).arrayBuffer().then(b=>console.log('BDONE',b.byteLength),e=>console.log('BERR',String(e)));console.log('TOP')"`
   (the executed row B line, evidence §Probe 2/3)
   and the same for `fs.openAsBlob`, `WebAssembly.compile` of a large module and
   `crypto.subtle.deriveBits` (PBKDF2, 3 M iterations): each prints `TOP` then
   its DONE line and exits 0, as Node 24.16.0 does (today: `TOP`, silent exit).
2. `vite build` on the same starter completes (`✓ built in …`, `dist/assets`
   written) with `node_modules/vite/dist/node/cli.js` byte-identical to the
   upstream 7.3.6 tarball member, no `__riftyTrackCliPromise` anywhere in the
   realm; `vite dev`/`preview`/`optimize` and the Vite 8 build/preview lanes
   stay green.
3. The maintainer opens
   `docs/backlog/npm-client/reference/registry-package-adaptations-evidence.md`:
   every esbuild patch id, Vite policy, emnapi backport, manifest/launch
   preparation and catalog substitution has a class, authority, anchor and
   kill condition; the two Vite root policies carry their real-Node-at-`/`
   artifact (evidence §Root) or link the platform item that owns the
   divergence.
Done when (1) runs as browser-unit parity against real Node on the default
lane, (2) is the existing Vite lanes plus an installed-bytes identity test,
and (3) is the updated inventory reviewed under the principle.

## Invariants

<!-- Each checked false on main `9645c62bf` (2026-10-15); command + output in
     `docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md`:
     I1 — §Probe 2/3 rows B/W/O/P: rifty prints `TOP` and exits with no DONE line
          and no stderr; Node 24.16.0 prints `BDONE 67108864` / `WDONE 0` /
          `ODONE 33554432` / `PDONE 32`; control B′ (held timer) prints
          `BDONE_HELD`. No keepalive consumer in `buffer.ts`/`fs.ts` openAsBlob/
          `zlib.ts`/crypto. The amended `WebSocket`/zlib/Response clauses have
          no false-on-main row yet — item 1 probes them at pickup (RDY-6
          §Amendments: recheck changed promises).
     I2 — `vite-cli-install-policy.ts:1-8` `viteCliActionPatchPolicy` rewrites
          `this.runMatchedCommand();`; `vite-cli-prep.ts:98-108` refuses an
          unpatched tree; `install-artifact-identity.json` includes the policy.
          §Probe 1: both arms identical, so the rewrite is not load-bearing.
     I3 — `registry-package-adaptations-evidence.md` §Finite inventory has
          columns owner-before / adaptation / owner-after only; no class,
          authority, anchor or kill condition. -->

1. I1. A run-to-completion Node child stays alive until a pending host-task-async
   request of a Node-surface API settles — `buffer.Blob`/`File` body reads,
   `fs.openAsBlob`, `WebAssembly.compile`/`instantiate(bytes)`, `crypto.subtle.*`,
   `node:zlib` over CompressionStream/DecompressionStream, in-guest `Response`/
   `Request` body consumers, global `WebSocket` — printing the same output and
   exit status as Node 24.
2. I2. The installed Vite `dist/node/cli.js` (Vite 7.3.6 and the Vite 8 bundle)
   is byte-identical to its upstream tarball member; no `__riftyTrackCliPromise`
   / `trackKeepalivePromise` exists in the realm or the SDK surface; `vite
   build`, `dev`, `preview`, `optimize` and the Vite 8 build/preview lanes pass
   without it.
3. I3. Every adaptation in the ADR-0384 inventory — executable patches and
   catalog substitutions — has a class (`substitution-environment` /
   `handle-mapping` / `upstream-edge` / `backport` / `platform-gap`), an
   authority, a loud drift anchor and a kill condition; a `platform-gap` row
   links the platform item that owns the divergence; an `upstream-edge` row
   carries its real-Node artifact at the same version and location.

## Challenge

challenge: 2026-10-15 — 4 problems (all resolved below; record:
`docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md`
§Review record)

Fresh read-only critic (general-purpose subagent) over the handoff, the
user's verbatim answers, the evidence file, goal/map/3 children/location
draft, the principle text, ADR-0152/0158/0384/0433/0280 and §Declined:
- E1/C2 — «отдельная цель для корня» had been downgraded to a question item
  → the root is seeded as its own draft goal `epics/project-location-independence`.
- F — principle wording "inadmissible/never admitted" contradicted "debt →
  item"/ADR-0384 §Alternatives/ADR-0433 → reworded to declared interim debt
  (linked platform item + kill condition); I3 no longer demands zero
  `platform-gap` rows; a probe-landed platform gap is classified and linked,
  its fix enters only by amendment.
- C1 — catalog substitutions (Sass, LightningCSS, Rollup, bcrypt) were outside
  item 3 → included (user's concern names every substituted package).
- B — item 2 `blocked_by` item 1 rested on an unevidenced masked window →
  removed; items independent, each on its own acceptance.
Advisory taken: refuse-by-name moved from I1 to §Decisions; failing-config
exit row added to item 2; `fs.ts` cite fixed; machine-gate attribution
reworded; location goal records the ADR-0280/0433 citing ADR need.
Value verdict kept: I1 real and Node-baselined, I2 real but a dead patch (not
a hidden gap), I3 user-chosen — the goal's value line now says so.

## Decisions

- tier: works — each slice replaces a silent drop or an undeclared patch with
  Node behavior/declared facts; no crash/reload or fault-injection promise
  (2026-10-15).
- 2026-10-15 — user: «записать в правила проекта как принцип. С остальными
  правилами как будто работает» — principle lands in `AGENTS.md` §Fidelity +
  `docs/process/rules/fault-classes.md` §Guest-package adaptations (process
  decision: docs + CHANGELOG, DEC-1), no ADR; no machine gate — agent reading
  of «как остальные правила»: rules are review-enforced.
- 2026-10-15 — user: «Только внутренний инвентарь» — no public compat-page
  adaptation section; I3 lives in the ADR-0384 evidence doc.
- 2026-10-15 — user: «Один эпик + отдельная цель для корня (Recommended)» —
  the root is its own goal: `epics/project-location-independence` (seeded
  `draft`, fitted later the same day — see the `amend:` lines). User, after
  the location explanation: «мы смешали надежность доказаность и дефолт платформы. Проекты
  должны уметь корректно работать где бы они не находились. … расположение
  проекта как будто и настраиваться может и это обратимое решение» — recorded
  there; this epic does not decide the location.
- 2026-10-15 — user: «В реальной системе vite же и в корне умеет работать» —
  ADR-0433 proved the isolated `normalizeResolvedIdToUrl` function, not a Vite
  server at `/` on real Node (its evidence: "No Node server or recursive
  watcher was opened at filesystem root"); the two Vite root policies are
  classified by a real-Node-at-`/` artifact (I3, evidence §Root), never by
  assumption. Result: both reproduce on real Node 24.22.0 + Vite 7.3.6 at `/`
  (phantom config restart + spurious change events; split Refresh URL
  `/@id//@react-refresh` vs `/@react-refresh`) → `upstream-edge`; `vite build`
  works at `/`, `vite dev` does not survive stock config there. A future
  `platform-gap` result classifies and links; fixing that divergence enters
  this epic only by user amendment (RDY-6).
- 2026-10-15 — agent: carriers whose release rifty cannot observe — refuse by
  name (ADR-0447 pattern) vs hold to the cap — decided in item 1's ADR at
  pickup; not an invariant.
- 2026-10-15 — agent: items 1 and 2 are independent; the hook's removal is
  proven by its own Vite lanes (probe 1 shows no masked window on `vite
  build`); a window a lane exposes routes to item 1 (REV-12).
- 2026-10-15 — agent: catalog substitutions (esbuild, LightningCSS, Sass,
  Rollup, bcrypt) are inventory rows under I3 — the user's concern names every
  substituted package.
- rejected route: realm-wide async-source census (count every pending
  promise/EventTarget) — violates Outcome clause "per-class refs on the
  existing chokepoint"; ADR-0378 §Declined.
- rejected route: keep the CAC hook as a declared `handle-mapping` adaptation —
  violates I2 (CAC's un-awaited promise holds no handle in Node either).
- rejected route: make the hook conditional on Vite version / mode — violates
  I2.
- rejected route: public compat "Adaptations" section — user decision above.
- amend: 2026-10-15 — user: «Снять патчи — быть Node-точным в `/` (сломанным)»
  and «Дефолт — home-like путь (/home/project)» — the two Vite root policies'
  kill condition is the `project-location-independence` goal (default moves
  to `/home/project`, the patches are deleted there, a `/`-rooted project
  behaves as real Node at `/`); I3 wording unchanged, inventory rows carry the
  new kill condition. user: «Как записано: platform-gap только как объявленный
  долг» — principle text confirmed. user: «окей, давай как рекомендовал
  Node-поверхность» — I1's carrier set is the Node-surface boundary incl.
  global `WebSocket` (item 1 §Decisions; the recommendation's `EventSource`
  was dropped after a probe: not a default Node 24 global).
