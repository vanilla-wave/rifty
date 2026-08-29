---
kind: epic
status: ready
title: no-COI sandbox tier — Vite 7 agent loop on a headerless page
created: 2026-08-28
value: An AI-agent platform (or docs site) without response-header control runs the full loop — create → write → npm install → vite build → extract dist → vite dev + HMR preview — on a page served with no COOP/COEP, with every unsupported surface failing loudly.
user_story: As an AI-agent platform without response-header control, I want the full Vite 7 agent loop on my own origin (GH-Pages-class), but today createSandbox throws COI_REQUIRED_MESSAGE and the real-Vite composition lives behind the workbench COI gate.
tier: works
---

## Outcome

A loud-gated no-COI tier of the sandbox SDK: single-worker topology (in-realm fs + loader,
postMessage stdio, SW preview) running real Vite 7.3.6 — proven viable by two spikes
(build 2026-08-25, dev+HMR 2026-08-28: byte-identical artifacts, HMR p50 244ms 100/100,
OPFS reload durability green; durable records: `runtime-js/reference/no-coi-degradation-probes.md` +
`distribution/reference/no-coi-hmr-spike-record.md`,
spike branches `t3code/prototype-no-coi-agent-cycle`, `t3code/prototype-hmr-agent-scenarios`).
Unlocks header-less hosting (GH Pages excluded since ADR-0002:19) and embeds on own origin.
Fidelity: every gap is a loud throw or a warned, capability-reported degradation — never a
quiet subset (`distribution/iframe-embed` fork (b) position).

## User scenario

An agent platform serves its page with NO COOP/COEP headers on its own origin:

1. `createSandbox({requireCrossOriginIsolation:false})` boots; capability report enumerates
   working / degraded(warn) / throwing surfaces (NEW additive Sandbox surface — public
   `checkCapabilities()` platform probe unchanged; ADR-0367 §1).
2. Agent writes a real Vite 7.3.6 project; `npm install` completes (react-class dep set).
3. `vite build` via `node_modules/.bin/vite`; agent reads `dist/` — artifacts byte-identical
   to the COI product.
4. `vite dev` boots; agent write + flush → HMR update visible in the SW-served preview iframe,
   no full reload.
5. Acknowledged `flush()` → full page reload → project tree survives (OPFS).
6. A wedged plugin (worker alive-but-blocked — no death event exists for this, spike-proven):
   the agent's own timeout invokes the sandbox restart primitive (terminate + reboot + iframe
   reload) and recovers dev + preview; an actual worker death additionally surfaces as an event.

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
     I8 — zero browser lanes serve without COI headers except tests/landing (no runtime). -->

1. I1. On a real no-COI Chromium page (`crossOriginIsolated===false`), `createSandbox` boots
   and its capability report enumerates working / degraded(warn) / throwing surfaces
   (ADR-0367 §1 — additive; `checkCapabilities` platform probe untouched).
2. I2. `npm install` of a real Vite 7 dependency set completes in that sandbox.
3. I3. Agent write → `vite build` (`node_modules/.bin/vite`) → `dist/` read back, artifacts
   byte-identical to the COI product for the same project.
4. I4. `vite dev` boots no-COI; agent write + flush → HMR update visible in the SW-served
   preview iframe with stable bootId (no hidden full reload).
5. I5. Acknowledged flush → full page reload → project tree survives byte-for-byte (OPFS,
   no COI — ADR-0368 supersedes the ADR-0072 COI backend-selection clause).
6. I6. The sandbox surface exposes a restart primitive (terminate + reboot + iframe reload)
   that recovers dev + preview from a wedged (alive-but-blocked) worker, and an actual worker
   death surfaces as an event; wedge DETECTION stays agent-owned (timeout) — heartbeat declined
   (ADR-0367 §2).
7. I7. Same-realm spawn child `console.*` reaches the child stdout pipe; spawn warns once;
   `execSync` stays a loud NotImplementedError; `os.cpus()`/`availableParallelism` report 1
   (ADR-0367 §3).
8. I8. A no-COI CI lane (page served with no COOP/COEP — the ADR-0369 lane) proves I1-I7 in
   real Chromium.

## Challenge

<!-- Advisory: fresh critic attacks invariants⇒value at FIT — README §Challenge. -->

challenge: 2026-08-28 — 5 problems
- Cheaper route unprobed yet unsequenced: map's own open question concedes a coi-serviceworker shim may deliver FULL COI (SAB, real worker children, no degradations, no new CI lane) on exactly the epic's target hosting, and since both the shim and this tier's preview require SW registration on own origin (map itself excludes third-party iframes for that reason), the audiences nearly coincide — but the hours-scale probe (map: 'minimal static page + shim + SAB probe', hosting-netlify.md:82 names the shim) gates nothing: all 5 slices can land before it settles, risking the whole 5-slice+CI-lane spend for an audience the shim already serves.
- Impact never sized against the whole and the doc admits it: goal.md records 'adopter-share unsized' as an 'accepted premise risk' — zero evidence any real platform/docs-site asked for no-COI — while active-milestone ROADMAP M11 'Standable' already funds the cheap attack on the same adoption pain (one-command scaffold emitting COOP/COEP wiring), so the epic's value is only the residual who cannot set headers at all, a share asserted by fiat, and the epic carries no M11 tag or opportunity-cost comparison against that funded route.
- Value has a hard shelf life the goal never sizes: map declares 'Vite 8 / Rolldown and any threaded-wasm guest (platform: pthread shared memory needs COI) — loud named error', so the tier is permanently capped at Vite <=7.3.6; the headline 'full Vite agent loop' value decays to a legacy-toolchain mode as the ecosystem moves to Vite 8, acknowledged only as another unsized 'accepted premise risk'.
- Declared durability hazard has no covering invariant: goal.md admits forced kill before flush leaves 5/10 trees silently crossing generations, yet I5 tests only the acknowledged-flush path and no invariant makes the mixed-generation state detectable at reboot (journal declined at works) — for the claimed user (agent platform whose end-users close tabs at will) the hazard is 'declared loudly' only in a doc while the runtime path passes quietly, which CLAUDE.md Fidelity forbids ('never hidden behind a passing path').
- I7 ships fabricated values as contract, in tension with mission text 'maximally faithful to real Node ... never approximated; gaps stay honest loud throws': os.cpus() would report 1 where the epic's own probe record calls host-12 'faithful to host' (no-coi-degradation-probes.md), and same-realm spawn (shared globals, one event loop — the very infidelity M6's open kernel/process-equals-web-worker item exists to remove) becomes a supported warned mode; the Decisions block resolves this by user fiat ('direction conflict → resolved above'), not by showing a warned approximation meets the fidelity bar CLAUDE.md defines only as throws.

<!-- Post-challenge dispositions: P1 → shim probe is a hard prerequisite of slicing the
     composition fog (map I1/I3/I8; collapsing answer = re-fit trigger). P4 → dirty-flag
     detectability = fog gate for the dev+HMR fog (user decision; journal stays declined).
     P2 (adopter share), P3 (Vite-7 shelf life) — accepted premise risks, user-owned.
     P5 — user-decided degradation shape; the report/warn surface is the honest carrier. -->

## Decisions

- tier works: wedge is non-preemptible in one event loop and pre-flush tree consistency
  needs journal/epoch machinery (HMR spike §4-5) — robust is a different-epic class; full
  sandbox re-create is ~18s, so recover-by-recreate is the honest works-tier strategy.
- Acceptance = agent headless SDK loop on own origin; third-party iframe without origin out
  (SW registration impossible there) — user decision 2026-08-25.
- OPFS in tier: boot.ts:23 gate is policy, not platform (spike-proven); reload durability
  green in HMR spike — user decision 2026-08-25/28. ADR carrier: ADR-0368 (supersedes the
  ADR-0072 `crossOriginIsolated &&` clause — recorded 2026-08-29, not postponed).
- Degradation = warn-once + capability report; execSync stays throw; console-swap mandatory
  (no silent lie at any tier); cpus→1 — user decisions 2026-08-25/28. ADR carrier: ADR-0367.
- dev+HMR in tier, build+extract slices first — user decision 2026-08-28 on HMR-spike data.
- Preview after worker death = explicit reload policy (died-event + restore primitive);
  auto-reconnect epoch/heartbeat mechanism declined — user decision 2026-08-28. ADR carrier:
  ADR-0367 §2 (public Sandbox surface today is dispose()-only; restart/died-event additive).
- Durability contract = acknowledged flush() boundary; forced kill before flush does not
  promise tree consistency (5/10 trees crossed generations silently, per-file old-or-new
  held 120/120) — declared loudly; workspace journal declined — user decision 2026-08-28.
- Resolves `kernel/process-equals-web-worker` fork FOR THIS TIER: same-realm fallback stays
  as the honest degraded mode (warned + capability-reported), never masquerading as isolated;
  retiring the fallback in the COI world remains that item's own scope.
- Draft-stage challenge (2026-08-28, 6 problems) dispositions: coi-serviceworker shim → fog
  probe (map); adopter-share unsized + Vite-7 pin + own-origin embed scope → recorded here as
  accepted premise risks; direction conflict → resolved above; stale speed claim → dropped.
- ADR carriers authored 2026-08-29 (bare-sab-guard checkpoint 4 — goal text alone cannot
  settle IRREVERSIBLE choices): ADR-0367 (capability report + restart/died-event + cpus→1 +
  degradation shape), ADR-0368 (OPFS selection drops COI clause of ADR-0072), ADR-0369
  (headerless no-COI Playwright lane).
