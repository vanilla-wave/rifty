---
kind: epic
status: ready
title: no-COI sandbox tier — shared-memory-free toolchains inside an existing non-COI page
created: 2026-08-28
value: An AI-agent platform whose page cannot take COOP/COEP runs the whole class of toolchains that need no shared memory — create → write → npm install → build → extract dist → dev + HMR preview — while its page stays non-COI throughout; anything that does need threaded WASM fails loudly by name.
user_story: As an AI-agent platform that cannot (or will not) put its page under COOP/COEP, I want the shared-memory-free agent loop embedded in that page unchanged, but today createSandbox throws COI_REQUIRED_MESSAGE and the real-Vite composition lives behind the workbench COI gate.
tier: works
---

## Outcome

A loud-gated no-COI tier of the sandbox SDK: single-worker topology (in-realm fs + loader,
postMessage stdio, SW preview) running real Vite 7.3.6 — proven viable by two spikes
(build 2026-08-25, dev+HMR 2026-08-28: byte-identical artifacts — 78 packages, 2180 modules,
same content hashes — HMR p50 244ms 100/100, OPFS reload durability green; durable records:
`distribution/reference/no-coi-build-spike-record.md` (install/build numbers, inlined
2026-08-31 off the rot-prone spike branch),
`distribution/reference/no-coi-hmr-spike-record.md`,
`runtime-js/reference/no-coi-degradation-probes.md`).
The build spike also shows the no-COI and COI harness lanes within noise of each other: the
measured win is the single-worker composition, NOT the absence of isolation — this epic
claims and proves only the non-COI capability, never a speed win (see that record).
Unlocks embedding in an EXISTING non-COI app on its own origin: the host document's security
posture is untouched — no COOP/COEP applied to it, no bootstrap reload, before, during or
after the loop. That constraint, not header-less hosting as such, is why the tier exists —
a route that isolates the whole page (SW-delivered COI) reaches neither this user nor this
value, however cheap (`## Decisions` rejected route; probe:
`distribution/reference/sw-coi-shim-probe.md`).
The destination is a CLASS, not a Vite version (user, 2026-08-31): everything a project can
do without multi-worker/threaded WASM runs here. Vite 7.3.6 is the representative instance —
convenient, real, and provable end to end — not the promise. A toolchain that genuinely needs
shared memory (Vite 8 / Rolldown's WASI binding, threaded-wasm guests) is OUTSIDE the class by
its own requirement and meets a loud named error: that boundary is the contract, not a decaying
value.
Audience is one persona: an EXISTING app that will not change its own headers. A site built
from scratch is not it — with no posture to preserve it should simply take real isolation (a
header-faking SW gets it: `distribution/reference/sw-coi-shim-probe.md`), so it is out of scope
here (user, 2026-08-31).
Fidelity: every gap is a loud throw or a warned, capability-reported degradation — never a
quiet subset (`distribution/iframe-embed` fork (b) position).

## User scenario

An agent platform serves its page with NO COOP/COEP headers on its own origin:

1. `createSandbox({requireCrossOriginIsolation:false})` boots; capability report enumerates
   working / degraded(warn) / throwing surfaces.
2. Agent writes a real Vite 7.3.6 project; `npm install` completes (react-class dep set).
3. `vite build` via `node_modules/.bin/vite`; agent reads `dist/` — artifacts byte-identical
   to the COI product.
4. `vite dev` boots; agent write + flush → HMR update visible in the SW-served preview iframe,
   no full reload.
5. Acknowledged `flush()` → full page reload → project tree survives (OPFS).
6. A wedged plugin (worker alive-but-blocked — no death event exists for this, spike-proven):
   the agent's own timeout invokes the sandbox restart primitive (terminate + reboot + iframe
   reload) and recovers dev + preview; an actual worker death additionally surfaces as an event.

Throughout, the page itself never becomes isolated: no step applies COOP/COEP to the host
document and no step reloads it to gain isolation — an existing app embeds rifty without
changing its own security posture.

Done when a no-COI CI lane (no COOP/COEP served) proves all of the above in real Chromium.

## Invariants

<!-- Each false on d93427b8c, evidence per statement:
     I1 — packages/rifty/src/sandbox.ts:126-131 default COI throw; no capability-report API.
     I2 — bare SharedArrayBuffer at packages/runtime-js/src/ipc/worker-realm-compat.ts:75,80
          kills the first npm install in any no-COI Node realm (spike-confirmed ReferenceError).
     I3 — real-Vite composition exists only behind workbench COI gates
          (open-workbench.ts:679, workbench-browser-owner-spawn.ts:51).
     I4 — unreachable for the same reason; HMR path never assembled outside workbench.
     I5 — packages/vfs/src/boot.ts:23 forces memory backend when !crossOriginIsolated.
     I6 — no restart primitive or worker-died event exists on the sandbox surface
          (sandbox exposes only dispose()); wedge leaves the worker alive-but-blocked,
          so death events alone cannot cover it (spike record).
     I7 — same-realm spawn drops child console.* to parent console (probe table row 3),
          spawn falls back silently (child_process.ts:342-365), os.cpus() reports host (12).
     I8 — zero browser lanes serve without COI headers except tests/landing (no runtime).
     I9 — sandbox.ts:126-131 throws on a non-COI page, so today NO loop runs with the host
          document non-COI; the only way to run rifty is to isolate the page.
     I10 — the Sandbox surface (sandbox.ts:47-70: runtime/fs/vfs/capabilities/swError/dispose)
          carries no unflushed-writes marker; kill before flush leaves 5/10 trees crossing
          generations (HMR spike) with nothing observable at the next boot. -->

1. I1. On a real no-COI Chromium page (`crossOriginIsolated===false`), `createSandbox` boots
   and its capability report enumerates working / degraded(warn) / throwing surfaces.
2. I2. `npm install` of a real Vite 7 dependency set completes in that sandbox.
3. I3. Agent write → `vite build` (`node_modules/.bin/vite`) → `dist/` read back, artifacts
   byte-identical to the COI product for the same project.
4. I4. `vite dev` boots no-COI; agent write + flush → HMR update visible in the SW-served
   preview iframe with stable bootId (no hidden full reload).
5. I5. Acknowledged flush → full page reload → project tree survives byte-for-byte (OPFS,
   no COI).
6. I6. The sandbox surface exposes a restart primitive (terminate + reboot + iframe reload)
   that recovers dev + preview from a wedged (alive-but-blocked) worker, and an actual worker
   death surfaces as an event; wedge DETECTION stays agent-owned (timeout) — heartbeat declined.
7. I7. Same-realm spawn child `console.*` reaches the child stdout pipe; spawn warns once;
   `execSync` stays a loud NotImplementedError; `os.cpus()`/`availableParallelism` report 1.
8. I8. A no-COI CI lane (page served with no COOP/COEP) proves I1-I7, I9 and I10 in real
   Chromium.
9. I9. The host document is really non-COI for the whole run: `crossOriginIsolated===false`
   in the page realm before boot, while the loop runs and after it — no COOP/COEP applied
   to that document by rifty, no bootstrap reload, `window.opener` and cross-origin
   subresource behavior unchanged.
10. I10. After a termination without an acknowledged `flush()`, the next boot reports a
    marker that writes were pending (tree may cross generations) — a signal only; no
    journal, no recovery.

## Challenge

<!-- Advisory: fresh critic attacks invariants⇒value at FIT — README §Challenge. -->

challenge: 2026-08-28 — 5 problems
- Cheaper route unprobed yet unsequenced: map's own open question concedes a coi-serviceworker shim may deliver FULL COI (SAB, real worker children, no degradations, no new CI lane) on exactly the epic's target hosting, and since both the shim and this tier's preview require SW registration on own origin (map itself excludes third-party iframes for that reason), the audiences nearly coincide — but the hours-scale probe (map: 'minimal static page + shim + SAB probe', hosting-netlify.md:82 names the shim) gates nothing: all 5 slices can land before it settles, risking the whole 5-slice+CI-lane spend for an audience the shim already serves.
- Impact never sized against the whole and the doc admits it: goal.md records 'adopter-share unsized' as an 'accepted premise risk' — zero evidence any real platform/docs-site asked for no-COI — while active-milestone ROADMAP M11 'Standable' already funds the cheap attack on the same adoption pain (one-command scaffold emitting COOP/COEP wiring), so the epic's value is only the residual who cannot set headers at all, a share asserted by fiat, and the epic carries no M11 tag or opportunity-cost comparison against that funded route.
- Value has a hard shelf life the goal never sizes: map declares 'Vite 8 / Rolldown and any threaded-wasm guest (platform: pthread shared memory needs COI) — loud named error', so the tier is permanently capped at Vite <=7.3.6; the headline 'full Vite agent loop' value decays to a legacy-toolchain mode as the ecosystem moves to Vite 8, acknowledged only as another unsized 'accepted premise risk'.
- Declared durability hazard has no covering invariant: goal.md admits forced kill before flush leaves 5/10 trees silently crossing generations, yet I5 tests only the acknowledged-flush path and no invariant makes the mixed-generation state detectable at reboot (journal declined at works) — for the claimed user (agent platform whose end-users close tabs at will) the hazard is 'declared loudly' only in a doc while the runtime path passes quietly, which CLAUDE.md Fidelity forbids ('never hidden behind a passing path').
- I7 ships fabricated values as contract, in tension with mission text 'maximally faithful to real Node ... never approximated; gaps stay honest loud throws': os.cpus() would report 1 where the epic's own probe record calls host-12 'faithful to host' (no-coi-degradation-probes.md), and same-realm spawn (shared globals, one event loop — the very infidelity M6's open kernel/process-equals-web-worker item exists to remove) becomes a supported warned mode; the Decisions block resolves this by user fiat ('direction conflict → resolved above'), not by showing a warned approximation meets the fidelity bar CLAUDE.md defines only as throws.

challenge: 2026-08-31 — 6 problems
- The "(or docs site)" half of the claimed audience (goal.md:6) is exactly the audience the rejected route serves better: the rejection reasons recorded in `distribution/reference/sw-coi-shim-probe.md` (severed `window.opener` for OAuth/payment popups, changed cross-origin subresource loading) are properties of an *existing* app's posture that a docs site does not have, and it would get full COI — SAB, real worker children, no degradations, no new CI lane — from the shim; meanwhile the docs-site persona that wants a drop-in embed (`distribution/iframe-embed.md`) is explicitly out of scope here (no own origin → no SW → no preview), so no docs site is materially better off after this epic.
- The cheaper-route rejection generalizes from a single probed header combination: the probe served `COOP: same-origin` + `COEP: credentialless`, and its decisive reason (opener severance) is a property of `same-origin`, not of isolation — the popup-preserving `COOP: restrict-properties` variant, which grants `crossOriginIsolated` while keeping `postMessage`/`closed` on cross-origin popups, is never probed or named, so "the route works but violates I9" rests on one untried configuration and only the weaker second reason (credentialless subresource behavior) survives unexamined.
- The tier's value is capped at a Vite version the product itself no longer defaults to: `packages/workbench/src/workers/vite-esbuild-runtime.ts:31` returns `skip-rolldown` for 8.x because Rolldown's WASI binding needs SAB, while the workbench default preset pins `vite: 8.0.16` (`project-definition.test.ts:265`) and `npm create vite` defaults to 8 — so the epic's own named user, an agent that scaffolds a fresh project, hits the loud named error at step 1, and the doc books this as an unsized "accepted premise risk" instead of sizing what share of agent projects can be pinned to 7.3.6.
- Impact is never sized against the whole and the repo's own policy for this persona is demand-driven: goal.md names zero adopter, `distribution/iframe-embed.md:19` says "refine when a real embedder (docs site / course platform) pulls it", ROADMAP lists no no-COI line while active M11 "Standable" funds the opposite attack (one-command scaffold emitting COOP/COEP wiring) — five slices plus a whole new browser CI lane are committed ahead of any recorded pull, with no comparison against that already-funded route.
- The epic's own evidence attributes the measured win to a different axis than the one all its invariants test: the build spike's controlled lanes (`prototype/no-coi-agent-loop/FINDINGS.md` §1 — same code, only COOP/COEP differs, every delta inside noise; "losing SAB costs the single-worker topology nothing") show the gain comes from the single-worker in-realm composition, which would pay off for COI adopters too (install 14.9 s vs product 26.6 s, warm build 2.09 s vs 4.29 s), yet I1–I9 all condition on `crossOriginIsolated===false` and the speed claim was simply "dropped", so the epic can close with the broader evidenced win neither claimed nor proven.
- The headline feasibility claim has no durable evidence: goal.md:14-18 cites two records for the build spike's "byte-identical artifacts", but `runtime-js/reference/no-coi-degradation-probes.md` carries only the degradation table (no install, no build) and `distribution/reference/no-coi-hmr-spike-record.md` says only "correct artifact 2.1 s" — the 78-package install, the identical content hashes, and the OPFS-past-the-gate run live solely on throwaway branches (`prototype/no-coi-agent-loop/FINDINGS.md`, `NO-COI-CAPABILITY-REPORT.md`) that both durable records themselves declare rot-prone and "re-verify before building on them".

<!-- Re-fit critic dispositions (2026-08-31), agent-owned ones closed in this commit:
     C2 (restrict-properties) → ANSWERED: the rejection never rested on opener severance;
     isolation of ANY flavor needs COEP on the host document plus a bootstrap reload. Probe
     record now carries a per-flavor table and names restrict-properties as unprobed.
     C5 (win attributed to the wrong axis) → ANSWERED in Outcome: the epic claims only the
     non-COI capability, never a speed win; the no-COI/COI harness lanes are within noise.
     C6 (evidence on rot-prone branches) → CLOSED: numbers inlined into
     `distribution/reference/no-coi-build-spike-record.md`.
     C1 (docs-site audience), C3 (Vite 8 default), C4 (no recorded adopter demand) are
     user-owned premise/scope calls — surfaced in the re-fit report, not decided here. -->

<!-- Post-challenge dispositions, revised at the 2026-08-31 re-fit (the first two were the
     wrong exit — both deferred a user-owned answer into the run):
     P1 → CLOSED: probed + answered by the user; route rejected, see `rejected route:` in
     ## Decisions and I9. Was: "hard PICKUP prerequisite + fog line, collapsing answer =
     re-fit trigger" — a scheduled run-stop.
     P4 → CLOSED: dirty marker is I10 (user decision 2026-08-31). Was: fog for dev-hmr pickup.
     P2 (adopter share), P3 (Vite-7 shelf life) — accepted premise risks, user-owned.
     P5 — user-decided degradation shape; the report/warn surface is the honest carrier. -->

## Decisions

- tier works: wedge is non-preemptible in one event loop and pre-flush tree consistency
  needs journal/epoch machinery (HMR spike §4-5) — robust is a different-epic class; full
  sandbox re-create is ~18s, so recover-by-recreate is the honest works-tier strategy.
- Acceptance = agent headless SDK loop on own origin; third-party iframe without origin out
  (SW registration impossible there) — user decision 2026-08-25.
- OPFS in tier: boot.ts:23 gate is policy, not platform (spike-proven); reload durability
  green in HMR spike — user decision 2026-08-25/28.
- Degradation = warn-once + capability report; execSync stays throw; console-swap mandatory
  (no silent lie at any tier); cpus→1 — user decisions 2026-08-25/28.
- dev+HMR in tier, build+extract slices first — user decision 2026-08-28 on HMR-spike data.
- Preview after worker death = explicit reload policy (died-event + restore primitive);
  auto-reconnect epoch/heartbeat mechanism declined — user decision 2026-08-28.
- Durability contract = acknowledged flush() boundary; forced kill before flush does not
  promise tree consistency (5/10 trees crossed generations silently, per-file old-or-new
  held 120/120) — declared loudly; workspace journal declined — user decision 2026-08-28.
- Resolves `kernel/process-equals-web-worker` fork FOR THIS TIER: same-realm fallback stays
  as the honest degraded mode (warned + capability-reported), never masquerading as isolated;
  retiring the fallback in the COI world remains that item's own scope.
- rejected route: SW-delivered COI (coi-serviceworker-style header-faking Service Worker, ANY
  COOP flavor incl. the unprobed popup-preserving `restrict-properties`) — violates I9.
  Probed 2026-08-31 (Chrome 151.0.7922.174, headerless origin): the SW-served document carries
  COOP same-origin + COEP credentialless, and after one reload `crossOriginIsolated===true`
  with SharedArrayBuffer constructible — the route WORKS and is cheaper. Rejected on the
  discriminator that holds for every flavor: isolation applies new policy headers to the WHOLE
  host document (COEP is required for isolation regardless of COOP value, so cross-origin
  subresource loading changes either way) and needs a bootstrap reload to install them — the
  adopter's existing app stops being the document they shipped, which is precisely what this
  epic exists to avoid (user, 2026-08-31). Durable record + per-flavor table:
  `distribution/reference/sw-coi-shim-probe.md`.
- The destination is the shared-memory-free CLASS of work, not a Vite version — user, 2026-08-31,
  answering critic problem C3 (tier capped at Vite ≤7.3.6 while the product preset pins 8.0.16).
  Vite 7.3.6 is the representative instance the invariants prove; toolchains that need threaded
  WASM are outside the class by their own requirement, and the loud named error is the correct
  boundary rather than an eroding promise. C3 is therefore answered, not accepted as risk.
- docs-site audience removed — user, 2026-08-31, answering critic problem C1: a site built from
  scratch has no posture to preserve, so real isolation (incl. the rejected SW route) serves it
  better; keeping it in `value` would have claimed a user this epic does not make better off.
- Boot marker for unflushed writes IS in the tier (I10) — user decision 2026-08-31, asked at
  re-fit instead of parked: declaring the kill-before-flush hazard in a doc while the runtime
  passes quietly is the silent lie Fidelity forbids. Marker only; journal/recovery stays
  declined (robust-class), so tier remains `works`.
- util-types.ts:27,31 closed at re-fit, not deferred: both occurrences are TYPE positions
  (`value is SharedArrayBuffer`), erased at compile time — runtime compares brand strings
  (lines 28,33), so no bare-global read exists there and the bare-sab-guard sweep has nothing
  to cover in that file.
- Re-fit 2026-08-31 (pre-run — ledger carries no pickup): the 2026-08-28 challenge's problem 1
  was routed to a probe though its deciding half ("does the value require the host page to
  stay non-COI?") was user-owned scope, answerable in one sentence; the probe then collapsed
  mid-run and stopped it. Process cause fixed in `rifty-goal` FIT 3 (owner-type before
  probe-or-fog); this re-fit records the answer as I9 + the rejected route.
- Draft-stage challenge (2026-08-28, 6 problems) dispositions: coi-serviceworker shim → fog
  probe (map); adopter-share unsized + Vite-7 pin + own-origin embed scope → recorded here as
  accepted premise risks; direction conflict → resolved above; stale speed claim → dropped.
